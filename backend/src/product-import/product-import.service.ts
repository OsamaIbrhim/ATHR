import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { TenantContext } from '../identity/tenant-context.type';
import type { AuthenticatedUser } from '../auth/authenticated-user';
import { assertBranchAccess } from '../auth/branch-access';
import { AthrDomainError } from '../common/http/athr-exception.filter';
import { domainError, UNPROCESSABLE } from '../common/domain-error';
import { InventoryService } from '../inventory/inventory.service';
import { LimitService } from '../entitlements/limit.service';
import { TaxCodeService } from '../tax/tax-code.service';
import { loadExisting, loadProductTypes, loadUnits } from './product-import-lookups';
import { findFileDuplicates, planRows, type Lookups, type Verdict } from './product-import-plan';
import { parseImportRow, type ParsedRow, type RowIssue, type RowParse } from './product-import-row';
import { writeBatch, type BatchContext } from './product-import-write';
import type { ImportProductsDto } from './dto/product-import.dto';

/** Rows written per transaction. */
export const IMPORT_BATCH_SIZE = 200;

type Shared = {
  batch: BatchContext;
  units: Lookups['units'];
  productTypes: Lookups['productTypes'];
  fileDuplicates: Map<number, RowIssue>;
};
type Tally = { categoriesCreated: number; openingPosted: number };

const TX_OPTIONS = { maxWait: 15_000, timeout: 60_000 } as const;
/** A unique-index violation, as Prisma reports it for a model call (P2002) or for raw SQL (P2010 / 23505). */
export function isUniqueViolation(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return false;
  return error.code === 'P2002' || (error.code === 'P2010' && (error.meta as { code?: string } | undefined)?.code === '23505');
}

const hasValue = (cell: unknown) => cell !== null && cell !== undefined && String(cell).trim() !== '' && Number(cell) !== 0;

/**
 * Bulk product import: products + barcodes + selling price + cost + opening
 * quantity, from rows the admin parsed. Create-only: an existing SKU is skipped
 * and reported, never updated. One planner (product-import-plan.ts) serves the
 * dry run and the real run; the real run writes in batches of
 * IMPORT_BATCH_SIZE rows, each a fixed number of statements and one transaction.
 */
@Injectable()
export class ProductImportService {
  private readonly logger = new Logger(ProductImportService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly inventory: InventoryService,
    private readonly limits: LimitService,
    private readonly tax: TaxCodeService,
  ) {}

  async import(context: TenantContext, dto: ImportProductsDto, actor: AuthenticatedUser) {
    const parsed = dto.rows.map((raw, index) => parseImportRow(raw, index));
    const valid = parsed.filter((result): result is Extract<RowParse, { kind: 'row' }> => result.kind === 'row').map((result) => result.row);
    const invalidResults = parsed
      .filter((result): result is Extract<RowParse, { kind: 'invalid' }> => result.kind === 'invalid')
      .map((result) => this.presentInvalid(result));
    const wantsOpening =
      valid.some((row) => row.openingQty) ||
      dto.rows.some((raw, index) => parsed[index]?.kind === 'invalid' && hasValue((raw as Record<string, unknown> | null)?.opening_qty));
    this.assertPermissions(actor, wantsOpening);

    const warehouseId = wantsOpening ? await this.openingWarehouse(context, dto, actor) : null;
    const taxCategory = await this.tax.findDefaultCategory(context);
    if (!taxCategory) {
      throw new AthrDomainError('TAX_NO_ACTIVE_CODE', 'This tenant has no tax category, so products cannot be created. Create a tax category first.');
    }
    const [units, productTypes, headroom] = await Promise.all([
      loadUnits(this.prisma, context.tenantId),
      loadProductTypes(this.prisma, context.tenantId),
      this.limits.headroom(context.tenantId, 'products'),
    ]);
    const fileDuplicates = findFileDuplicates(valid);

    if (dto.dry_run) {
      const existing = await loadExisting(this.prisma, context.tenantId, valid);
      const verdicts = planRows(valid, { ...existing, units, productTypes, remaining: headroom.remaining }, fileDuplicates);
      return this.respond(true, dto, invalidResults, verdicts, headroom, { categoriesCreated: 0, openingPosted: 0 });
    }

    const priceBookId = valid.length ? await this.ensurePriceBook(context, actor) : null;
    const shared: Shared = {
      batch: { tenantId: context.tenantId, actorId: actor.sub, taxCategoryId: taxCategory.id, priceBookId, priceTaxMode: dto.price_tax_mode, warehouseId },
      units,
      productTypes,
      fileDuplicates,
    };
    const tally: Tally = { categoriesCreated: 0, openingPosted: 0 };
    const verdicts: Verdict[] = [];
    for (let start = 0; start < valid.length; start += IMPORT_BATCH_SIZE) {
      verdicts.push(...(await this.importRows(valid.slice(start, start + IMPORT_BATCH_SIZE), shared, tally)));
    }
    const after = await this.limits.headroom(context.tenantId, 'products');
    return this.respond(false, dto, invalidResults, verdicts, after, tally);
  }

  // --- a batch ----------------------------------------------------------------

  /**
   * One batch in one transaction. If it hits a unique violation the plan could not
   * see (a concurrent writer took a SKU or barcode), it was rolled back whole: split
   * it in halves and retry, so only the row at fault fails. Any other error (a
   * timeout, a lost connection, a bug) is rethrown: the chunk is idempotent, so the
   * client simply sends it again and the rows already created come back as skipped.
   */
  private async importRows(rows: ParsedRow[], shared: Shared, tally: Tally): Promise<Verdict[]> {
    if (!rows.length) return [];
    try {
      const done = await this.prisma.$transaction((tx) => this.importInTransaction(tx, rows, shared), TX_OPTIONS);
      tally.categoriesCreated += done.categoriesCreated;
      tally.openingPosted += done.openingPosted;
      return done.verdicts;
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      if (rows.length > 1) {
        const half = Math.ceil(rows.length / 2);
        return [...(await this.importRows(rows.slice(0, half), shared, tally)), ...(await this.importRows(rows.slice(half), shared, tally))];
      }
      const row = rows[0] as ParsedRow;
      this.logger.error(`Import row ${row.index} failed: ${error instanceof Error ? error.message : String(error)}`);
      return [this.failed(row, 'IMPORT_ROW_FAILED', 'The row could not be saved', 'تعذّر حفظ هذا الصف. أعد المحاولة.')];
    }
  }

  private async importInTransaction(tx: Prisma.TransactionClient, rows: ParsedRow[], shared: Shared) {
    const tenantId = shared.batch.tenantId;
    // Concurrent imports of one tenant take turns, so the plan limit cannot be overshot.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`product-limit:${tenantId}`}, 0))`;
    const { remaining } = await this.limits.headroom(tenantId, 'products', tx);
    const existing = await loadExisting(tx, tenantId, rows);
    const verdicts = planRows(rows, { ...existing, units: shared.units, productTypes: shared.productTypes, remaining }, shared.fileDuplicates);
    const ready = verdicts.filter((verdict) => verdict.status === 'ready');
    if (!ready.length) return { verdicts, categoriesCreated: 0, openingPosted: 0 };

    const written = await writeBatch(this.inventory, tx, shared.batch, ready);
    return {
      verdicts: verdicts.map((verdict) => (verdict.status === 'ready' ? { ...verdict, variantId: written.variantIds.get(verdict.index) } : verdict)),
      categoriesCreated: written.categoriesCreated,
      openingPosted: written.openingPosted,
    };
  }

  // --- request level ------------------------------------------------------------

  /** Prices go live in the default price book and opening quantities move stock: each needs its own authority. */
  private assertPermissions(actor: AuthenticatedUser, wantsOpening: boolean) {
    const needed = ['pricing.price-entry.manage', 'pricing.price-book.activate', ...(wantsOpening ? ['inventory.adjustment.post'] : [])];
    const missing = needed.find((key) => !actor.permissions.has(key as never));
    if (missing) throw new AthrDomainError('PERMISSION_DENIED', `Importing ${missing.startsWith('inventory') ? 'opening quantities' : 'prices'} needs "${missing}".`);
  }

  private async openingWarehouse(context: TenantContext, dto: ImportProductsDto, actor: AuthenticatedUser) {
    if (!dto.branch_id) {
      throw domainError(UNPROCESSABLE, 'IMPORT_BRANCH_REQUIRED', 'Choose the branch that receives the opening quantities', 'اختر الفرع الذي تُسجَّل فيه الكميات.');
    }
    assertBranchAccess(actor, dto.branch_id);
    const branch = await this.prisma.branch.findFirst({ where: { id: dto.branch_id, tenant_id: context.tenantId, is_active: true }, select: { id: true } });
    if (!branch) throw new NotFoundException('Branch not found');
    return this.inventory.defaultWarehouseId(this.prisma, context.tenantId, dto.branch_id);
  }

  /** The tenant's live default price book, created the first time (a new shop has none). */
  private async ensurePriceBook(context: TenantContext, actor: AuthenticatedUser): Promise<string> {
    const tenant = await this.prisma.tenant.findUniqueOrThrow({ where: { id: context.tenantId }, select: { default_currency: true } });
    const where = { tenant_id: context.tenantId, currency: tenant.default_currency, scope: 'tenant_default' as const, scope_ref_id: null, is_default: true, status: 'active' as const };
    const existing = await this.prisma.priceBook.findFirst({ where, select: { id: true } });
    if (existing) return existing.id;
    try {
      const created = await this.prisma.priceBook.create({
        data: { ...where, name: 'Default Price Book', created_by: actor.sub, activated_by: actor.sub, activated_at: new Date() },
        select: { id: true },
      });
      return created.id;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const raced = await this.prisma.priceBook.findFirst({ where, select: { id: true } });
        if (raced) return raced.id;
      }
      throw error;
    }
  }

  // --- response -----------------------------------------------------------------

  private failed(row: ParsedRow, code: string, message: string, message_ar: string): Verdict {
    return {
      index: row.index, rowRef: row.rowRef, sku: row.sku, status: 'failed', row, unitId: null, unitPrecision: 0, productTypeId: null,
      errors: [{ code, message, message_ar }], warnings: [],
    };
  }

  private presentInvalid(result: { index: number; rowRef: string | number | null; sku: string | null; errors: RowIssue[] }) {
    return { index: result.index, row_ref: result.rowRef, sku: result.sku, status: 'failed' as const, errors: result.errors, warnings: [] as RowIssue[] };
  }

  private respond(
    dryRun: boolean,
    dto: ImportProductsDto,
    invalid: ReturnType<ProductImportService['presentInvalid']>[],
    verdicts: Verdict[],
    headroom: { limit: number | null; current: number; remaining: number | null },
    tally: Tally,
  ) {
    const good = dryRun ? 'ready' : 'created';
    const rows = [
      ...invalid,
      ...verdicts.map((verdict) => ({
        index: verdict.index,
        row_ref: verdict.rowRef,
        sku: verdict.sku,
        status: verdict.status === 'ready' ? good : verdict.status,
        ...(verdict.variantId ? { variant_id: verdict.variantId } : {}),
        errors: verdict.errors,
        warnings: verdict.warnings,
      })),
    ].sort((a, b) => a.index - b.index);
    const count = (status: string) => rows.filter((row) => row.status === status).length;
    return {
      dry_run: dryRun,
      on_existing_sku: dto.on_existing_sku ?? 'skip',
      summary: {
        total: rows.length,
        [good]: count(good),
        skipped: count('skipped'),
        failed: count('failed'),
        out_of_plan: rows.filter((row) => row.errors.some((error) => error.code === 'ENTITLEMENT_LIMIT_REACHED')).length,
        categories_created: tally.categoriesCreated,
        opening_quantities: tally.openingPosted,
      },
      plan_limit: { limit: headroom.limit, current: headroom.current, remaining: headroom.remaining },
      rows,
    };
  }
}
