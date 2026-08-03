import { IsIn } from 'class-validator';
import { SYSTEM_ROLES } from '../system-roles';

export class ChangeMembershipRoleDto {
  @IsIn(SYSTEM_ROLES as string[])
  role: 'tenant_owner' | 'location_manager' | 'cashier' | 'warehouse_manager' | 'seller';
}
