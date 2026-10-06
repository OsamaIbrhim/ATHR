import { BadRequestException } from '@nestjs/common';
import { cumulativeShare, lineAmount } from '@athr/domain-core';
import { Prisma } from '@prisma/client';

/** The parts of a sold line a refund is worked out from. */
export interface SoldLine {
  readonly qty: Prisma.Decimal;
  readonly unit_price: Prisma.Decimal;
  /** Tax-exclusive discount of the whole line. */
  readonly discount_amount: Prisma.Decimal;
  /** Tax of the whole line, after the discount. */
  readonly tax_amount: Prisma.Decimal;
}

export interface LineRefund {
  readonly net: Prisma.Decimal;
  readonly tax: Prisma.Decimal;
}

/**
 * What returning `returning` units of a line refunds: that share of what was
 * paid for the line (its net after discount, and its tax), never more. The
 * share is taken cumulatively over the units returned before, so a line
 * returned in several goes refunds exactly what it cost, to the cent.
 */
export function refundForLine(line: SoldLine, returnedBefore: Prisma.Decimal, returning: Prisma.Decimal): LineRefund {
  const lineNet = new Prisma.Decimal(lineAmount(line.unit_price.toString(), line.qty.toString())).minus(line.discount_amount);
  const share = (amount: Prisma.Decimal) =>
    new Prisma.Decimal(cumulativeShare(amount.toString(), line.qty.toString(), returnedBefore.toString(), returning.toString()));
  return { net: share(lineNet), tax: share(line.tax_amount) };
}

/**
 * A sale can be returned for `windowDays` days after it was made (the tenant's
 * `sales.return_window_days`); 0 means returns are not accepted at all.
 */
export function assertWithinReturnWindow(soldAt: Date, windowDays: number, now: Date = new Date()): void {
  if (windowDays <= 0) {
    throw new BadRequestException({
      code: 'RETURNS_NOT_ACCEPTED',
      message_ar: 'المرتجعات غير مفعّلة لهذا الحساب.',
      message: 'Returns are switched off for this tenant (sales.return_window_days = 0)',
    });
  }
  const ageDays = (now.getTime() - soldAt.getTime()) / 86_400_000;
  if (ageDays > windowDays) {
    throw new BadRequestException({
      code: 'RETURN_WINDOW_EXPIRED',
      message_ar: `انتهت مهلة المرتجع (${windowDays} يومًا).`,
      message: `Return window expired (${windowDays} days)`,
      return_window_days: windowDays,
    });
  }
}
