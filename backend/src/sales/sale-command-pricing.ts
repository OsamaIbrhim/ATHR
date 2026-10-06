import type { CreateSaleItemDto } from './dto/create-sale.dto';
import { priceSaleLines, type PricingLine, type SaleDiscount, type SalePricing } from './sale-discounts';

/** What the server's price book and tax rules say one variant costs right now. */
export interface ServerQuote {
  readonly net_price: number | string | { toString(): string };
  readonly tax_amount: number | string | { toString(): string };
  readonly tax: { readonly rate_snapshot: { toString(): string }; readonly mode_snapshot: 'inclusive' | 'exclusive' };
}

export interface SaleCommandPricing {
  /** The sale as the till priced it: its unit prices and unit tax, discounts applied. What the customer paid. */
  readonly till: SalePricing;
  /**
   * The same lines and discounts at the server's own prices. Only the tax
   * snapshot uses it (the evidence of what the tax rules said); the invoice
   * keeps what the till collected.
   */
  readonly server: SalePricing;
}

const text = (value: { toString(): string } | number | string) => value.toString();

/** Prices the lines of a sale command twice: as the till sent them and at the server's quote. */
export function priceSaleCommand(
  items: readonly CreateSaleItemDto[],
  invoiceDiscount: SaleDiscount | undefined,
  quotes: ReadonlyMap<string, ServerQuote>,
): SaleCommandPricing {
  const line = (item: CreateSaleItemDto, unitPrice: string, unitTax: string): PricingLine => {
    const quote = quotes.get(item.variant_id)!;
    return {
      variantId: item.variant_id,
      qty: item.qty,
      unitPrice,
      unitTax,
      taxRate: text(quote.tax.rate_snapshot),
      taxMode: quote.tax.mode_snapshot,
      discount: item.discount,
    };
  };
  return {
    till: priceSaleLines(items.map((item) => line(item, text(item.unit_price), text(item.unit_tax))), invoiceDiscount),
    server: priceSaleLines(
      items.map((item) => {
        const quote = quotes.get(item.variant_id)!;
        return line(item, text(quote.net_price), text(quote.tax_amount));
      }),
      invoiceDiscount,
    ),
  };
}
