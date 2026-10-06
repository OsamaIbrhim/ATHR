import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { StockCountStatus } from '@prisma/client';
import { PageQueryDto } from '../../common/page-query.dto';
import { MAX_QUANTITY, QUANTITY_SCALE } from '../../common/quantity';

export const MAX_SCAN_ENTRIES = 100;

export class CountScopeDto {
  @IsIn(['all', 'category', 'product_type'])
  type: 'all' | 'category' | 'product_type';

  /** The category or product type id; required unless the type is `all`. */
  @ValidateIf((scope: CountScopeDto) => scope.type !== 'all')
  @IsUUID()
  id?: string;
}

export class StartCountDto {
  @IsUUID()
  branch_id: string;

  @ValidateNested()
  @Type(() => CountScopeDto)
  scope: CountScopeDto;

  /** Defaults to "جرد {branch} {date}". */
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name?: string;

  /** Optional client key: re-sending it returns the count it started. */
  @IsOptional()
  @IsString()
  @Matches(/^[A-Za-z0-9._:-]{8,100}$/, { message: 'command_id must be 8-100 letters, digits or . _ : -' })
  command_id?: string;
}

export class ScopeSizeDto {
  @IsUUID()
  branch_id: string;

  @IsIn(['all', 'category', 'product_type'])
  scope_type: 'all' | 'category' | 'product_type';

  @ValidateIf((query: ScopeSizeDto) => query.scope_type !== 'all')
  @IsUUID()
  scope_id?: string;
}

/**
 * One scan (or typed quantity) of a counter. `entry_id` is chosen by the client
 * and makes a retry harmless. Name the item by `barcode` (what a scanner sends)
 * or by `variant_id` (what a search result gives).
 *
 *  - mode `add` (default): adds `qty` (default 1, may be negative to undo; a
 *    barcode multiplies it by its pack quantity) to this counter's total.
 *  - mode `set`: makes this counter's total for the item exactly `qty` units.
 */
export class CountEntryDto {
  @IsString()
  @Matches(/^[A-Za-z0-9._:-]{8,100}$/, { message: 'entry_id must be 8-100 letters, digits or . _ : -' })
  entry_id: string;

  @ValidateIf((entry: CountEntryDto) => !entry.variant_id)
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  barcode?: string;

  @ValidateIf((entry: CountEntryDto) => !entry.barcode)
  @IsUUID()
  variant_id?: string;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: QUANTITY_SCALE, allowNaN: false, allowInfinity: false })
  @Min(-MAX_QUANTITY)
  @Max(MAX_QUANTITY)
  qty?: number;

  @IsOptional()
  @IsIn(['add', 'set'])
  mode?: 'add' | 'set';

  /** Count an item outside the scope anyway (needs inventory.adjustment.approve). */
  @IsOptional()
  @IsBoolean()
  allow_out_of_scope?: boolean;
}

export class CountEntriesDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_SCAN_ENTRIES)
  @ValidateNested({ each: true })
  @Type(() => CountEntryDto)
  entries: CountEntryDto[];
}

export class PostCountDto {
  /**
   * What happens to in-scope items nobody counted (only those with a non-zero
   * balance matter). No default: required whenever such items exist.
   */
  @IsOptional()
  @IsIn(['ignore', 'zero'])
  uncounted?: 'ignore' | 'zero';

  /** Items to count as zero although the choice is `ignore`. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(1000)
  @IsUUID('all', { each: true })
  zero_variant_ids?: string[];

  /** Items to leave alone although the choice is `zero`. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(1000)
  @IsUUID('all', { each: true })
  keep_variant_ids?: string[];

}

export class CancelCountDto {
  @IsOptional()
  @IsString()
  @MaxLength(300)
  reason?: string;
}

export class ListCountsDto extends PageQueryDto {
  @IsOptional()
  @IsEnum(StockCountStatus)
  status?: StockCountStatus;

  @IsOptional()
  @IsUUID()
  branch_id?: string;
}

export class ReviewCountDto extends PageQueryDto {
  @IsOptional()
  @IsIn(['all', 'variance', 'increase', 'decrease', 'matched', 'uncounted'])
  filter?: 'all' | 'variance' | 'increase' | 'decrease' | 'matched' | 'uncounted';

  /** Matches SKU, name or barcode. */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;
}

export class RecentEntriesDto extends PageQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;
}
