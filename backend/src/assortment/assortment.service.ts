import { Injectable } from '@nestjs/common';
import { AssortmentRepository } from './assortment.repository';
import { BranchesRepository } from '../branches/branches.repository';
import { ProductsRepository } from '../products/products.repository';
import { AthrDomainError } from '../common/http/athr-exception.filter';
import { ListAssortmentDto, UpsertAssortmentDto } from './dto/assortment.dto';
import type { TenantContext } from '../identity/tenant-context.type';

/**
 * WP-008 Phase A (BR-AST-1xx): per-Branch sellability/purchasability/
 * displayability, distinct from `Product.is_active`. Validates the Branch
 * and Variant references through their own modules' repository contracts
 * rather than reaching into Prisma directly (CLAUDE.md §2.2 modular
 * independence).
 */
@Injectable()
export class AssortmentService {
  constructor(
    private readonly repository: AssortmentRepository,
    private readonly branches: BranchesRepository,
    private readonly products: ProductsRepository,
  ) {}

  list(context: TenantContext, dto: ListAssortmentDto) {
    return this.repository.list(context, { branchId: dto.branch_id, variantId: dto.variant_id });
  }

  async upsert(context: TenantContext, dto: UpsertAssortmentDto) {
    await this.branches.assertInTenant(context, dto.branch_id);
    const variant = await this.products.findVariantById(context, dto.variant_id);
    if (!variant) {
      throw new AthrDomainError('RESOURCE_NOT_FOUND', `Variant ${dto.variant_id} not found.`);
    }
    return this.repository.save(context, dto.branch_id, dto.variant_id, {
      isSellable: dto.is_sellable,
      isPurchasable: dto.is_purchasable,
      isDisplayable: dto.is_displayable,
    });
  }
}
