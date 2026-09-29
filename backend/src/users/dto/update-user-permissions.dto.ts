import { ArrayUnique, IsArray, IsIn, IsString } from 'class-validator';
import { ALL_PERMISSIONS } from '../../identity/permission-catalog';

/** Per-user overrides on top of the role's default permissions. */
export class UpdateUserPermissionsDto {
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  @IsIn(ALL_PERMISSIONS, { each: true })
  granted_permissions: string[];

  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  @IsIn(ALL_PERMISSIONS, { each: true })
  revoked_permissions: string[];
}
