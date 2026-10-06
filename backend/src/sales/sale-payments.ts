import type { Prisma } from '@prisma/client';
import { money, sameMoney, sumMoney } from '../common/money';
import type { SalePaymentDto } from './dto/sale-payment.dto';
import type { PaymentMethod } from './payment-methods';

export interface PaymentRow {
  sequence: number;
  method: PaymentMethod;
  amount: Prisma.Decimal;
  tendered: Prisma.Decimal | null;
  reference: string | null;
}

export interface PaymentPlan {
  rows: PaymentRow[];
  /** Cash that stays in the till: what the shift's expected cash grows by. */
  cash: Prisma.Decimal;
  /** The part of the total that goes on the customer's account. */
  credit: Prisma.Decimal;
  warnings: string[];
}

/**
 * The payment rows of a sale and what is worth flagging about them. Nothing
 * here refuses a sale (spec §0): payments that do not add up to the total, or a
 * method the tenant has switched off, are recorded and reported as warnings.
 */
export function planPayments(
  payments: readonly SalePaymentDto[],
  total: Prisma.Decimal,
  enabledMethods: readonly PaymentMethod[],
): PaymentPlan {
  const rows = payments.map((payment, index): PaymentRow => ({
    sequence: index + 1,
    method: payment.method as PaymentMethod,
    amount: money(payment.amount),
    tendered: payment.tendered === undefined ? null : money(payment.tendered),
    reference: payment.reference?.trim() || null,
  }));
  const sumOf = (method: PaymentMethod) => sumMoney(rows.filter((row) => row.method === method).map((row) => row.amount));

  const warnings: string[] = [];
  if (!sameMoney(sumMoney(rows.map((row) => row.amount)), total)) warnings.push('PAYMENT_TOTAL_MISMATCH');
  if (rows.some((row) => !enabledMethods.includes(row.method))) warnings.push('PAYMENT_METHOD_DISABLED');
  return { rows, cash: sumOf('cash'), credit: sumOf('credit'), warnings };
}

/** The canonical form of the payments inside the sale command fingerprint (order matters). */
export function paymentsFingerprint(payments: readonly SalePaymentDto[]) {
  return payments.map((payment) => ({
    method: payment.method,
    amount: money(payment.amount).toFixed(2),
    tendered: payment.tendered === undefined ? null : money(payment.tendered).toFixed(2),
    reference: payment.reference?.trim() || null,
  }));
}
