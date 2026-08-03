import { IsArray, IsBoolean, IsDateString, IsIn, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

const SUPPORT_ACCESS_MODES = ['metadata_only', 'read_only_diagnostic', 'assisted_operation', 'break_glass'] as const;

export class CreateSupportAccessGrantDto {
  @IsUUID()
  operator_identity_id: string;

  @IsIn(SUPPORT_ACCESS_MODES as unknown as string[])
  mode: (typeof SUPPORT_ACCESS_MODES)[number];

  @IsString()
  @MaxLength(300)
  purpose: string;

  @IsArray()
  @IsString({ each: true })
  scopes: string[];

  @IsString()
  @MaxLength(1000)
  reason: string;

  @IsDateString()
  expires_at: string;

  @IsOptional()
  @IsBoolean()
  read_only?: boolean;

  @IsOptional()
  @IsUUID()
  approved_by_identity_id?: string;

  @IsOptional()
  @IsBoolean()
  consent_obtained?: boolean;
}
