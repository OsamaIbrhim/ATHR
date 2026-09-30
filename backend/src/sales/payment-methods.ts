/** How a sale or a debt collection can be paid. `credit` puts the amount on the customer's account. */
export const PAYMENT_METHODS = ['cash', 'card', 'wallet', 'bank_transfer', 'credit', 'other'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

/** How a return can be refunded. `credit` reduces what the customer owes (or leaves store credit). */
export const REFUND_METHODS = ['cash', 'credit', 'card', 'wallet', 'other'] as const;
export type RefundMethod = (typeof REFUND_METHODS)[number];

/** Methods a tenant accepts until it says otherwise. */
export const DEFAULT_PAYMENT_METHODS: readonly PaymentMethod[] = ['cash', 'card', 'wallet', 'credit'];

export const isPaymentMethod = (value: unknown): value is PaymentMethod =>
  typeof value === 'string' && (PAYMENT_METHODS as readonly string[]).includes(value);
