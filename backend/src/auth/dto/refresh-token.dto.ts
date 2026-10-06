import { IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

export class RefreshTokenDto {
  @IsString()
  @MinLength(32)
  @MaxLength(512)
  refresh_token: string;

  // Keeps the tenant the client is working in (refresh tokens are not tenant-bound).
  @IsOptional()
  @IsUUID()
  tenant_id?: string;
}
