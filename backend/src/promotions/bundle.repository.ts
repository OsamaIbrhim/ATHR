import { Injectable } from '@nestjs/common';
import type { Bundle, BundleComponent, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AthrDomainError } from '../common/http/athr-exception.filter';
import type { TenantScope } from '../identity/tenant-context.type';

export type BundleWithComponents = Bundle & { components: BundleComponent[] };

export interface BundleFilters {
  readonly status?: Bundle['status'];
  readonly page?: number;
  readonly pageSize?: number;
}

/**
 * WP-008 Phase D — tenant-scoped repository for `Bundle`/`BundleComponent`.
 *
 * Versioned like `TaxCodeRepository` (`supersedes_id` chain, `draftNextVersion`
 * leaves the live version untouched — BR-BND-101: "تغيير التركيبة لا يغير
 * Sales سابقة"), but simpler: `Bundle` carries no partial "only one active"
 * unique index (unlike `TaxCode`), so `activate()` needs no demote-before-
 * promote statement ordering — multiple bundles may be `active`
 * simultaneously, each independently sellable.
 */
@Injectable()
export class BundleRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Deliberately two explicit queries rather than a Prisma `include` —
   * identical result against real Postgres, but also exercisable against
   * `fakePrisma`, whose `findFirst`/`findMany` do not hydrate relations
   * (only `upsert` does, per `cross-tenant-harness.ts`). Composing the
   * result by hand keeps this repository testable with the same fixture
   * harness every other tenant-scoped repository in this codebase uses.
   */
  async findById(context: TenantScope, id: string): Promise<BundleWithComponents | null> {
    const bundle = await this.prisma.bundle.findFirst({ where: { id, tenant_id: context.tenantId } });
    if (!bundle) return null;
    const components = await this.prisma.bundleComponent.findMany({
      where: { bundle_id: id, tenant_id: context.tenantId },
    });
    return { ...bundle, components };
  }

  async assertInTenant(context: TenantScope, id: string): Promise<BundleWithComponents> {
    const bundle = await this.findById(context, id);
    if (!bundle) throw new AthrDomainError('RESOURCE_NOT_FOUND', `Bundle ${id} not found.`);
    return bundle;
  }

  async list(
    context: TenantScope,
    filters: BundleFilters = {},
  ): Promise<{ rows: BundleWithComponents[]; total: number }> {
    const page = filters.page && filters.page > 0 ? filters.page : 1;
    const pageSize = filters.pageSize && filters.pageSize > 0 ? Math.min(filters.pageSize, 100) : 20;
    const where: Prisma.BundleWhereInput = {
      tenant_id: context.tenantId,
      ...(filters.status ? { status: filters.status } : {}),
    };
    const [bundles, total] = await Promise.all([
      this.prisma.bundle.findMany({
        where,
        orderBy: [{ created_at: 'desc' }, { id: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.bundle.count({ where }),
    ]);
    // One query for every bundle's components (bounded by page size, at most
    // 100), not one per bundle — CLAUDE.md §3.1.
    const allComponents = await this.prisma.bundleComponent.findMany({
      where: { tenant_id: context.tenantId, bundle_id: { in: bundles.map((bundle) => bundle.id) } },
    });
    const componentsByBundle = new Map<string, BundleComponent[]>();
    for (const component of allComponents) {
      const bucket = componentsByBundle.get(component.bundle_id);
      if (bucket) bucket.push(component);
      else componentsByBundle.set(component.bundle_id, [component]);
    }
    const rows = bundles.map((bundle) => ({
      ...bundle,
      components: componentsByBundle.get(bundle.id) ?? [],
    }));
    return { rows, total };
  }

  /** Two explicit writes, not a nested `components: { create: [...] } }` — see `findById`'s comment. */
  async create(
    context: TenantScope,
    data: {
      name: string;
      returnPolicy: Bundle['return_policy'];
      version: number;
      supersedesId: string | null;
      createdBy: string;
      components: readonly { variantId: string; qty: Prisma.Decimal.Value }[];
    },
  ): Promise<BundleWithComponents> {
    const bundle = await this.prisma.bundle.create({
      data: {
        tenant_id: context.tenantId,
        name: data.name,
        return_policy: data.returnPolicy,
        version: data.version,
        supersedes_id: data.supersedesId,
        created_by: data.createdBy,
        status: 'draft',
      },
    });
    await this.prisma.bundleComponent.createMany({
      data: data.components.map((component) => ({
        tenant_id: context.tenantId,
        bundle_id: bundle.id,
        variant_id: component.variantId,
        qty: component.qty,
      })),
    });
    return this.assertInTenant(context, bundle.id);
  }

  /** BR-BND-101: components/return_policy are mutable ONLY while `draft`. */
  async updateDraft(
    context: TenantScope,
    id: string,
    data: {
      name?: string;
      returnPolicy?: Bundle['return_policy'];
      components?: readonly { variantId: string; qty: Prisma.Decimal.Value }[];
    },
  ): Promise<BundleWithComponents> {
    const current = await this.assertInTenant(context, id);
    if (current.status !== 'draft') {
      throw new AthrDomainError(
        'BUNDLE_NOT_DRAFT',
        `Bundle ${id} is "${current.status}"; only a "draft" may be edited (BR-BND-101).`,
      );
    }
    await this.prisma.$transaction(async (tx) => {
      const changed = await tx.bundle.updateMany({
        where: { id, tenant_id: context.tenantId, status: 'draft' },
        data: {
          ...(data.name !== undefined ? { name: data.name } : {}),
          ...(data.returnPolicy !== undefined ? { return_policy: data.returnPolicy } : {}),
        },
      });
      if (changed.count !== 1) {
        throw new AthrDomainError('BUNDLE_NOT_DRAFT', `Bundle ${id} was changed concurrently.`);
      }
      if (data.components) {
        // Full replace — simplest correct semantics for a component set that
        // is only ever edited pre-activation (no partial-return history to
        // preserve yet at this version).
        await tx.bundleComponent.deleteMany({ where: { bundle_id: id, tenant_id: context.tenantId } });
        await tx.bundleComponent.createMany({
          data: data.components.map((component) => ({
            tenant_id: context.tenantId,
            bundle_id: id,
            variant_id: component.variantId,
            qty: component.qty,
          })),
        });
      }
    });
    return this.assertInTenant(context, id);
  }

  async transition(
    context: TenantScope,
    id: string,
    fromStatuses: readonly Bundle['status'][],
    toStatus: Bundle['status'],
    data: Prisma.BundleUpdateManyMutationInput = {},
  ): Promise<BundleWithComponents> {
    const changed = await this.prisma.bundle.updateMany({
      where: { id, tenant_id: context.tenantId, status: { in: [...fromStatuses] } },
      data: { ...data, status: toStatus },
    });
    if (changed.count !== 1) {
      const current = await this.findById(context, id);
      if (!current) throw new AthrDomainError('RESOURCE_NOT_FOUND', `Bundle ${id} not found.`);
      throw new AthrDomainError(
        'BUNDLE_NOT_DRAFT',
        `Bundle ${id} is "${current.status}"; expected one of [${fromStatuses.join(', ')}] to move to "${toStatus}".`,
      );
    }
    return this.assertInTenant(context, id);
  }

  /** BR-BND-101: creates the next DRAFT version; the live version keeps selling until the successor activates. */
  async draftNextVersion(
    context: TenantScope,
    previousId: string,
    data: {
      returnPolicy: Bundle['return_policy'];
      createdBy: string;
      components: readonly { variantId: string; qty: Prisma.Decimal.Value }[];
    },
  ): Promise<BundleWithComponents> {
    const previous = await this.assertInTenant(context, previousId);
    if (previous.status !== 'active') {
      throw new AthrDomainError(
        'BUNDLE_NOT_DRAFT',
        `Bundle ${previousId} is "${previous.status}"; only an active version may be superseded.`,
      );
    }
    return this.create(context, {
      name: previous.name,
      returnPolicy: data.returnPolicy,
      version: previous.version + 1,
      supersedesId: previous.id,
      createdBy: data.createdBy,
      components: data.components,
    });
  }
}
