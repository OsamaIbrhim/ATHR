import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsIn, IsOptional, IsUUID } from 'class-validator';
import { MAX_IMPORT_ROWS } from '../product-import-row';

/**
 * A chunk of a product import file, already parsed by the admin. Rows are plain
 * objects whose cells may be numbers or text; each row is validated on its own
 * and reported per row, so one bad cell never fails the request.
 *
 * Row fields: `row_ref` (your own row number, echoed back), `sku`, `name`,
 * `name_ar`, `barcode` / `barcodes` (a list, or text separated by `;` `,`),
 * `price`, `cost`, `opening_qty`, `unit`, `category`, `product_type`.
 */
export class ImportProductsDto {
  /** Validate and report only; nothing is written. */
  @IsOptional()
  @IsBoolean()
  dry_run?: boolean;

  /** What to do with a row whose SKU already exists. Only `skip` (report it, change nothing) exists today. */
  @IsOptional()
  @IsIn(['skip'])
  on_existing_sku?: 'skip';

  /** Whether the `price` column includes tax. Explicit, because a wrong guess misprices every sale. */
  @IsIn(['inclusive', 'exclusive'])
  price_tax_mode: 'inclusive' | 'exclusive';

  /** The branch whose warehouse receives the opening quantities; required when any row has one. */
  @IsOptional()
  @IsUUID()
  branch_id?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_IMPORT_ROWS)
  rows: unknown[];
}
