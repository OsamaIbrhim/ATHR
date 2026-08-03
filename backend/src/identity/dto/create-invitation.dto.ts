import { IsEmail, IsIn, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { SYSTEM_ROLES } from '../system-roles';

const SCOPE_TYPES = ['tenant_wide', 'location', 'warehouse', 'terminal'] as const;

export class CreateInvitationDto {
  @IsEmail()
  email: string;

  @IsIn(SYSTEM_ROLES as string[])
  role: 'tenant_owner' | 'location_manager' | 'cashier' | 'warehouse_manager' | 'seller';

  @IsIn(SCOPE_TYPES as unknown as string[])
  scope_type: (typeof SCOPE_TYPES)[number];

  @IsOptional()
  @IsUUID()
  scope_ref_id?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  purpose?: string;
}
