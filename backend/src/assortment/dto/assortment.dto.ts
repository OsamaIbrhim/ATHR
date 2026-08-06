import { IsBoolean, IsOptional, IsUUID } from 'class-validator';

export class UpsertAssortmentDto {
  @IsUUID()
  branch_id: string;

  @IsUUID()
  variant_id: string;

  @IsOptional()
  @IsBoolean()
  is_sellable?: boolean;

  @IsOptional()
  @IsBoolean()
  is_purchasable?: boolean;

  @IsOptional()
  @IsBoolean()
  is_displayable?: boolean;
}

export class ListAssortmentDto {
  @IsOptional()
  @IsUUID()
  branch_id?: string;

  @IsOptional()
  @IsUUID()
  variant_id?: string;
}
