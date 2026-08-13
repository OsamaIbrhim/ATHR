import { Injectable } from '@nestjs/common';
import type { Prisma, TaxExemption } from '@prisma/client';
import { AthrDomainError } from '../common/http/athr-exception.filter';
import type { TenantContext, TenantScope } from '../identity/tenant-context.type';
import { PrismaService } from '../prisma/prisma.service';
import type {
  CreateTaxExemptionDto,
  ListTaxExemptionsDto,
  RevokeTaxExemptionDto,
} from './dto/tax-exemption.dto';

/**
 * WP-008 Phase C — BR-TAX-205: "Tax exemption تحتاج Evidence".
 *
 * The evidence columns are NOT NULL in the schema, so an exemption without a
 * reason, a certificate reference and an issue date cannot physically exist.
 * This service adds the parts a column constraint cannot express: the
 * maker-checker split between applying and approving (Permission Matrix §18
 * has `tax.exemption.apply` and `tax.exemption.approve` as separate keys), and
 * expiry.
 */
@Injectable()
export class TaxExemptionService {
  constructor(private readonly prisma: PrismaService) {}

  async list(context: TenantContext, dto: ListTaxExemptionsDto = {}) {
    const page = dto.page && dto.page > 0 ? dto.page : 1;
    const pageSize = dto.page_size && dto.page_size > 0 ? Math.min(dto.page_size, 100) : 20;
    const where: Prisma.TaxExemptionWhereInput = {
      tenant_id: context.tenantId,
      ...(dto.customer_id ? { customer_id: dto.customer_id } : {}),
      ...(dto.status ? { status: dto.status } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.taxExemption.findMany({
        where,
        orderBy: [{ created_at: 'desc' }, { id: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.taxExemption.count({ where }),
    ]);
    return { items: rows, total, page, page_size: pageSize };
  }

  async findById(
    context: TenantScope,
    id: string,
    transaction?: Prisma.TransactionClient,
  ): Promise<TaxExemption | null> {
    const db = transaction ?? this.prisma;
    return db.taxExemption.findFirst({ where: { id, tenant_id: context.tenantId } });
  }

  /**
   * Records the *request*, always as `pending`. Applying an exemption and
   * approving it are separate Matrix §18 keys, so this method can never
   * produce an approved row no matter who calls it — a zero-rated line
   * requires a second, independent decision.
   */
  async apply(
    context: TenantContext,
    actorId: string,
    dto: CreateTaxExemptionDto,
  ): Promise<TaxExemption> {
    const customer = await this.prisma.customer.findFirst({
      where: { id: dto.customer_id, tenant_id: context.tenantId },
      select: { id: true },
    });
    if (!customer) {
      throw new AthrDomainError('RESOURCE_NOT_FOUND', `Customer ${dto.customer_id} not found.`);
    }
    if (dto.tax_category_id) {
      const category = await this.prisma.taxCategory.findFirst({
        where: { id: dto.tax_category_id, tenant_id: context.tenantId },
        select: { id: true },
      });
      if (!category) {
        throw new AthrDomainError(
          'RESOURCE_NOT_FOUND',
          `Tax category ${dto.tax_category_id} not found.`,
        );
      }
    }

    const expiresAt = dto.expires_at ? new Date(dto.expires_at) : null;
    const issuedAt = new Date(dto.evidence_issued_at);
    if (expiresAt && expiresAt.getTime() <= issuedAt.getTime()) {
      throw new AthrDomainError(
        'TAX_EXEMPTION_EVIDENCE_REQUIRED',
        'Exemption evidence expires on or before its issue date; the certificate dates are inconsistent.',
      );
    }

    return this.prisma.taxExemption.create({
      data: {
        tenant_id: context.tenantId,
        customer_id: dto.customer_id,
        tax_category_id: dto.tax_category_id ?? null,
        status: 'pending',
        reason: dto.reason.trim(),
        evidence_reference: dto.evidence_reference.trim(),
        evidence_issued_at: issuedAt,
        expires_at: expiresAt,
        applied_by: actorId,
      },
    });
  }

  /**
   * The independent decision. The `status: 'pending'` predicate lives inside
   * the `updateMany` (the `PriceBookRepository.transition` idiom), so two
   * concurrent approvals cannot both succeed.
   */
  async approve(context: TenantContext, actorId: string, id: string): Promise<TaxExemption> {
    const current = await this.findById(context, id);
    if (!current) {
      throw new AthrDomainError('RESOURCE_NOT_FOUND', `Tax exemption ${id} not found.`);
    }
    if (current.applied_by === actorId) {
      throw new AthrDomainError(
        'TAX_CODE_SELF_APPROVAL_FORBIDDEN',
        `Tax exemption ${id} was applied for by this user; approving an exemption requires an independent approver (Permission Matrix §18).`,
      );
    }
    const changed = await this.prisma.taxExemption.updateMany({
      where: { id, tenant_id: context.tenantId, status: 'pending' },
      data: { status: 'approved', approved_by: actorId, approved_at: new Date() },
    });
    if (changed.count !== 1) {
      throw new AthrDomainError(
        'TAX_EXEMPTION_NOT_APPLICABLE',
        `Tax exemption ${id} is "${current.status}"; only a pending exemption can be approved.`,
      );
    }
    return (await this.findById(context, id))!;
  }

  async revoke(
    context: TenantContext,
    actorId: string,
    id: string,
    dto: RevokeTaxExemptionDto,
  ): Promise<TaxExemption> {
    const changed = await this.prisma.taxExemption.updateMany({
      where: { id, tenant_id: context.tenantId, status: { in: ['pending', 'approved'] } },
      data: {
        status: 'revoked',
        revoked_by: actorId,
        revoked_at: new Date(),
        revoked_reason: dto.reason.trim(),
      },
    });
    if (changed.count !== 1) {
      const current = await this.findById(context, id);
      if (!current) {
        throw new AthrDomainError('RESOURCE_NOT_FOUND', `Tax exemption ${id} not found.`);
      }
      throw new AthrDomainError(
        'TAX_EXEMPTION_NOT_APPLICABLE',
        `Tax exemption ${id} is "${current.status}"; only a pending or approved exemption can be revoked.`,
      );
    }
    return (await this.findById(context, id))!;
  }
}
