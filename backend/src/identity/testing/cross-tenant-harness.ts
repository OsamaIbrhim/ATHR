import { randomUUID } from 'crypto';
import { parseTenantId } from '@athr/domain-core';
import type { TenantContext } from '../tenant-context.type';

/**
 * Shared harness for the WP-007 Phase A cross-tenant isolation tests
 * (§A.3.6, Multi-tenancy Blueprint §119/§120/§122).
 *
 * The point of these tests is behavioural, not structural: it is not enough
 * to assert that a repository *mentions* `tenant_id`. `FakeTable` actually
 * evaluates the `where` clause the repository builds — so a repository that
 * forgets the tenant predicate will genuinely return tenant B's row and the
 * test will genuinely fail. That is Blueprint §120 ("Query includes tenant
 * predicate", "Update/delete cannot affect other tenant") proved rather than
 * asserted.
 *
 * Everything is in memory; no test here opens a database connection, matching
 * the house pattern set by `identity.integration.spec.ts`.
 */

export const TENANT_A = randomUUID();
export const TENANT_B = randomUUID();

export function contextFor(tenantId: string, overrides: Partial<TenantContext> = {}): TenantContext {
  return {
    tenantId: parseTenantId(tenantId),
    membershipId: null,
    servicePrincipalId: null,
    authenticatedIdentityId: randomUUID(),
    tenantAccessMode: 'active',
    entitlementSnapshotVersion: null,
    permissionPolicyVersion: 2,
    scopeSet: [{ scopeType: 'tenant_wide', scopeRefId: null }],
    selectedLocationId: null,
    selectedWarehouseId: null,
    terminalId: null,
    supportGrantId: null,
    requestId: 'test-request',
    correlationId: 'test-correlation',
    actorType: 'human',
    ...overrides,
  };
}

type Row = Record<string, any>;

function matchesCondition(value: any, condition: any): boolean {
  if (condition === null) return value === null || value === undefined;
  if (typeof condition !== 'object' || condition instanceof Date) return value === condition;

  if ('equals' in condition) return value === condition.equals;
  if ('not' in condition) return !matchesCondition(value, condition.not);
  if ('in' in condition) return (condition.in ?? []).includes(value);
  if ('notIn' in condition) return !(condition.notIn ?? []).includes(value);
  if ('contains' in condition) {
    if (value === null || value === undefined) return false;
    const haystack = condition.mode === 'insensitive' ? String(value).toLowerCase() : String(value);
    const needle =
      condition.mode === 'insensitive' ? String(condition.contains).toLowerCase() : String(condition.contains);
    return haystack.includes(needle);
  }
  if ('gt' in condition) return value > condition.gt;
  if ('gte' in condition) return value >= condition.gte;
  if ('lt' in condition) return value < condition.lt;
  if ('lte' in condition) return value <= condition.lte;
  return value === condition;
}

/**
 * Describes a to-one relation so a nested `where` clause such as
 * `product: { tenant_id }` can actually be evaluated. Without this, a nested
 * tenant predicate would be silently unverifiable — the exact thing these
 * tests exist to check.
 */
export interface RelationSpec {
  readonly table: string;
  readonly localKey: string;
  readonly foreignKey?: string;
}

type RelationMap = Record<string, Record<string, RelationSpec>>;

const OPERATOR_KEYS = new Set([
  'equals', 'not', 'in', 'notIn', 'contains', 'gt', 'gte', 'lt', 'lte', 'has', 'mode',
  'startsWith', 'endsWith', 'some', 'every', 'none',
]);

function isRelationFilter(condition: any): boolean {
  return (
    typeof condition === 'object' &&
    condition !== null &&
    !(condition instanceof Date) &&
    !Array.isArray(condition) &&
    Object.keys(condition).every((key) => !OPERATOR_KEYS.has(key))
  );
}

export function matchesWhere(
  row: Row,
  where: Row | undefined,
  context?: { prisma: any; relations: Record<string, RelationSpec> },
): boolean {
  if (!where) return true;
  return Object.entries(where).every(([key, condition]) => {
    if (key === 'AND') {
      return (condition as Row[]).every((clause) => matchesWhere(row, clause, context));
    }
    if (key === 'OR') {
      return (condition as Row[]).some((clause) => matchesWhere(row, clause, context));
    }
    if (key === 'NOT') {
      return !matchesWhere(row, condition as Row, context);
    }

    const relation = context?.relations?.[key];
    if (relation && isRelationFilter(condition)) {
      const related =
        row[key] ??
        context!.prisma[relation.table]?.rows.find(
          (candidate: Row) => candidate[relation.foreignKey ?? 'id'] === row[relation.localKey],
        );
      if (!related) return false;
      return matchesWhere(related, condition as Row);
    }

    if (typeof condition === 'object' && condition !== null && 'has' in condition) {
      return Array.isArray(row[key]) && row[key].includes(condition.has);
    }

    return matchesCondition(row[key], condition);
  });
}

/** A minimal in-memory stand-in for one Prisma model delegate. */
export class FakeTable {
  private prisma: any;
  private relations: Record<string, RelationSpec> = {};

  constructor(public rows: Row[] = []) {}

  bind(prisma: any, relations: Record<string, RelationSpec> = {}) {
    this.prisma = prisma;
    this.relations = relations;
    return this;
  }

  private match = (row: Row, where: Row | undefined) =>
    matchesWhere(row, where, { prisma: this.prisma, relations: this.relations });

  private sort(rows: Row[], orderBy: any): Row[] {
    if (!orderBy) return rows;
    const clauses = Array.isArray(orderBy) ? orderBy : [orderBy];
    return [...rows].sort((left, right) => {
      for (const clause of clauses) {
        const [field, direction] = Object.entries(clause)[0] as [string, 'asc' | 'desc'];
        const a = left[field];
        const b = right[field];
        if (a === b) continue;
        const comparison = a > b ? 1 : -1;
        return direction === 'desc' ? -comparison : comparison;
      }
      return 0;
    });
  }

  findFirst = async ({ where, orderBy }: any = {}) =>
    this.sort(this.rows.filter((row) => this.match(row, where)), orderBy)[0] ?? null;

  findUnique = async ({ where }: any) => {
    // Compound-key lookups arrive as a single nested object.
    const flattened = Object.values(where).some((value) => typeof value === 'object' && value !== null)
      ? Object.assign({}, ...Object.values(where).map((value) => (typeof value === 'object' ? value : {})), where)
      : where;
    return this.rows.find((row) => this.match(row, flattened)) ?? null;
  };

  findMany = async ({ where, orderBy, take, skip }: any = {}) => {
    let result = this.sort(this.rows.filter((row) => this.match(row, where)), orderBy);
    if (skip) result = result.slice(skip);
    if (take) result = result.slice(0, take);
    return result;
  };

  count = async ({ where }: any = {}) => this.rows.filter((row) => this.match(row, where)).length;

  create = async ({ data }: any) => {
    const row = { id: data.id ?? randomUUID(), created_at: new Date(), ...data };
    this.rows.push(row);
    return row;
  };

  createMany = async ({ data }: any) => {
    const items = Array.isArray(data) ? data : [data];
    for (const item of items) await this.create({ data: item });
    return { count: items.length };
  };

  upsert = async ({ where, create, update, include }: any) => {
    const existing = this.rows.find((row) => this.match(row, where));
    if (existing) {
      Object.assign(existing, update);
      return this.hydrate(existing, include);
    }
    const created = await this.create({ data: { ...where, ...create } });
    return this.hydrate(created, include);
  };

  /** Resolves declared to-one relations for an `include`, so callers see them. */
  private hydrate(row: Row, include?: Row) {
    if (!include) return row;
    const hydrated: Row = { ...row };
    for (const key of Object.keys(include)) {
      if (hydrated[key] !== undefined) continue;
      const relation = this.relations[key];
      if (!relation) continue;
      hydrated[key] = this.prisma[relation.table]?.rows.find(
        (candidate: Row) => candidate[relation.foreignKey ?? 'id'] === row[relation.localKey],
      ) ?? null;
    }
    return hydrated;
  }

  update = async ({ where, data }: any) => {
    const row = this.rows.find((candidate) => this.match(candidate, where));
    if (!row) throw new Error(`FakeTable.update: no row matching ${JSON.stringify(where)}`);
    Object.assign(row, data);
    return row;
  };

  updateMany = async ({ where, data }: any) => {
    const rows = this.rows.filter((row) => this.match(row, where));
    for (const row of rows) Object.assign(row, data);
    return { count: rows.length };
  };

  delete = async ({ where }: any) => {
    const index = this.rows.findIndex((row) => this.match(row, where));
    if (index === -1) throw new Error(`FakeTable.delete: no row matching ${JSON.stringify(where)}`);
    return this.rows.splice(index, 1)[0];
  };

  deleteMany = async ({ where }: any = {}) => {
    const kept = this.rows.filter((row) => !this.match(row, where));
    const removed = this.rows.length - kept.length;
    this.rows = kept;
    return { count: removed };
  };

  aggregate = async ({ where, _sum, _count, _max, _min }: any = {}) => {
    const rows = this.rows.filter((row) => this.match(row, where));
    const sum: Row = {};
    for (const field of Object.keys(_sum ?? {})) {
      sum[field] = rows.reduce((total, row) => total + Number(row[field] ?? 0), 0);
    }
    const pick = (fields: Row | undefined, reducer: (a: any, b: any) => any) => {
      const result: Row = {};
      for (const field of Object.keys(fields ?? {})) {
        const values = rows.map((row) => row[field]).filter((value) => value !== null && value !== undefined);
        result[field] = values.length ? values.reduce(reducer) : null;
      }
      return result;
    };
    return {
      _sum: sum,
      _count: _count ? rows.length : undefined,
      _max: pick(_max, (a, b) => (b > a ? b : a)),
      _min: pick(_min, (a, b) => (b < a ? b : a)),
    };
  };

  groupBy = async ({ by, where }: any) => {
    const rows = this.rows.filter((row) => this.match(row, where));
    const buckets = new Map<string, Row[]>();
    for (const row of rows) {
      const key = by.map((field: string) => row[field]).join(' ');
      buckets.set(key, [...(buckets.get(key) ?? []), row]);
    }
    return [...buckets.entries()].map(([key, bucket]) => {
      const grouped: Row = {};
      by.forEach((field: string, index: number) => {
        grouped[field] = key.split(' ')[index];
      });
      return { ...grouped, _count: bucket.length };
    });
  };
}

/**
 * Builds a fake `PrismaService` exposing the named model delegates.
 *
 * `relations` declares to-one relations so nested `where` clauses like
 * `product: { tenant_id }` are genuinely evaluated rather than silently
 * ignored — e.g.
 * `{ productVariant: { product: { table: 'product', localKey: 'product_id' } } }`.
 */
export function fakePrisma(models: Record<string, Row[]>, relations: RelationMap = {}): any {
  const prisma: any = {
    $transaction: async (arg: any) =>
      typeof arg === 'function' ? arg(prisma) : Promise.all(arg),
    $queryRaw: async () => [],
    $executeRaw: async () => 0,
  };
  for (const [name, rows] of Object.entries(models)) {
    prisma[name] = new FakeTable(rows);
  }
  for (const [name, table] of Object.entries(prisma)) {
    if (table instanceof FakeTable) table.bind(prisma, relations[name] ?? {});
  }
  return prisma;
}
