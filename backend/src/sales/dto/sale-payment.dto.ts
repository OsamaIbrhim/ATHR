import { Type } from 'class-transformer';
import { IsIn, IsNumber, IsOptional, IsString, MaxLength, Min } from 'class-validator';
import { PAYMENT_METHODS } from '../payment-methods';

/** One tender of a sale. A split payment is several of these. */
export class SalePaymentDto {
  @IsIn(PAYMENT_METHODS)
  method: string;

  /** What stays in the till (cash: the net amount, without the change). */
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  amount: number;

  /** Cash handed over, for the receipt only. */
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  tendered?: number;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  reference?: string;
}
