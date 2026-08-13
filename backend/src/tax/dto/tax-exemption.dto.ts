import { Type } from 'class-transformer';
import {
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { TaxExemptionStatus } from '@prisma/client';

const STATUS_VALUES = Object.values(TaxExemptionStatus);

/**
 * BR-TAX-205 — "Tax exemption تحتاج Evidence": Customer/status/reason/
 * reference/expiry.
 *
 * `reason`, `evidence_reference` and `evidence_issued_at` are all REQUIRED and
 * non-empty. An exemption is an auditable decision; a request that cannot name
 * the certificate it rests on is rejected at the boundary rather than stored
 * as an exemption with a blank justification.
 */
export class CreateTaxExemptionDto {
  @IsUUID()
  customer_id: string;

  /** Null/absent = the exemption covers every category for this customer. */
  @IsOptional()
  @IsUUID()
  tax_category_id?: string;

  @IsString()
  @MinLength(3)
  @MaxLength(1000)
  reason: string;

  @IsString()
  @MinLength(1)
  @MaxLength(200)
  evidence_reference: string;

  @IsDateString()
  evidence_issued_at: string;

  @IsOptional()
  @IsDateString()
  expires_at?: string;
}

export class RevokeTaxExemptionDto {
  @IsString()
  @MinLength(3)
  @MaxLength(1000)
  reason: string;
}

export class ListTaxExemptionsDto {
  @IsOptional()
  @IsUUID()
  customer_id?: string;

  @IsOptional()
  @IsIn(STATUS_VALUES)
  status?: TaxExemptionStatus;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  page_size?: number;
}
