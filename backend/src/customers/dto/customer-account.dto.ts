import { Type } from 'class-transformer';
import { IsIn, IsNumber, IsOptional, IsString, IsUUID, Length, MaxLength, Min, ValidateIf } from 'class-validator';
import { PAYMENT_METHODS } from '../../sales/payment-methods';

/** Methods a debt can be paid with: everything except putting it back on the account. */
export const COLLECTION_METHODS = PAYMENT_METHODS.filter((method) => method !== 'credit');

export class CollectPaymentDto {
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  amount: number;

  @IsIn(COLLECTION_METHODS)
  method: string;

  /** The caller's own key for this collection: sending it twice records it once. */
  @IsString()
  @Length(8, 191)
  idempotency_key: string;

  /** The open shift a till takes the money in: cash collected there is part of its expected cash. */
  @IsOptional()
  @IsUUID()
  shift_id?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  note?: string;
}

export class SetCreditLimitDto {
  /** `null` removes the limit. */
  @ValidateIf((_object, value) => value !== null)
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  credit_limit: number | null;
}
