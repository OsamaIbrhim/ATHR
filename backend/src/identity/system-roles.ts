import type { MembershipRole } from '@prisma/client';

/**
 * System roles are the exact, fixed `MembershipRole` enum values decided in
 * WP-005 Phase B (`backend/prisma/schema.prisma`, mapped 1:1 from the legacy
 * `Role` enum in migration `202608020003_add_membership_from_user`) — this
 * WP does not invent new role names, per ADR-0003 item 6 (system roles
 * first, custom roles deferred — `OD-TEN-004`).
 *
 * The permission catalog below is drawn verbatim from `BR-ADM-100`
 * ("العمليات التالية مستقلة الصلاحية" — the one place the Business Rules
 * document enumerates a concrete, independently-permissioned operation
 * list), translated to permission codes. It is an allow-only union per
 * ADR-0003 item 5 (`OD-TEN-005` — explicit deny deferred): a Membership's
 * effective permissions are exactly its role's grants below, nothing more.
 * Per `BR-ROL-105`, the most sensitive operations (ownership transfer,
 * tenant-wide scope grants, support access grants, full data export, tenant
 * closure) are never bundled into a broad default role — only `tenant_owner`
 * carries them.
 */
export const IDENTITY_PERMISSIONS = [
  'membership.invite',
  'membership.status.change',
  'membership.role.assign',
  'access_scope.assign_tenant_wide',
  'location.create_close',
  'warehouse.create_disable',
  'terminal.enroll_revoke',
  'ownership.transfer',
  'support_access.grant',
  'tenant_data.export_all',
  'tenant.request_closure',
] as const;

export type IdentityPermission = (typeof IDENTITY_PERMISSIONS)[number];

export const SYSTEM_ROLES: readonly MembershipRole[] = [
  'tenant_owner',
  'location_manager',
  'cashier',
  'warehouse_manager',
  'seller',
];

/** Version 1 of the versioned, snapshot-resolvable permission catalog (ADR-0005). */
export const PERMISSION_POLICY_INITIAL_VERSION = 1;

export const SYSTEM_ROLE_PERMISSIONS: Readonly<Record<MembershipRole, readonly IdentityPermission[]>> = {
  tenant_owner: [...IDENTITY_PERMISSIONS],
  location_manager: [
    'membership.invite',
    'membership.status.change',
    'membership.role.assign',
    'location.create_close',
    'warehouse.create_disable',
    'terminal.enroll_revoke',
  ],
  warehouse_manager: ['warehouse.create_disable', 'terminal.enroll_revoke'],
  cashier: [],
  seller: [],
};
