import { IsIn, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { PageQueryDto } from '../../common/page-query.dto';

export const LOW_STOCK_STATUSES = ['all', 'zero', 'negative', 'no_stock_row'] as const;
export type LowStockStatus = (typeof LOW_STOCK_STATUSES)[number];

export class LowStockDto extends PageQueryDto {
  /** Defaults to the user's own branch; tenant-wide users may omit it to see every branch. */
  @IsOptional()
  @IsUUID()
  branch_id?: string;

  /**
   * `all` = at zero or below (zero + negative); `no_stock_row` = items that
   * never had any stock movement in the branch (needs `branch_id`).
   */
  @IsOptional()
  @IsIn(LOW_STOCK_STATUSES)
  status?: LowStockStatus;

  /** Matches SKU, name or barcode. */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;
}
