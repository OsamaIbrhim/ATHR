/**
 * Catalog codes — WP-008 Phase A (Brand, UOM/Conversion, Assortment, Item type).
 *
 * `RESOURCE_NOT_FOUND` (auth.ts) already covers every "not found or not in
 * this tenant" case for the new tables, matching the `branches`/`suppliers`
 * precedent — nothing new is registered for that. The four codes below are
 * for business-rule conflicts specific to this phase's invariants:
 * BR-UOM-102 (conversion factor immutable once created, supersede instead of
 * editing) and BR-TYP-103 (item type change blocked once transaction history
 * exists).
 */

import type { ErrorMetadata } from '../registry';

export const CATALOG_ERROR_CODES = [
  {
    // BR-CLS-103: Brand is an independent, archivable entity — not enforced
    // as globally unique, but duplicate names within a tenant are rejected
    // at write time to keep the entity meaningful.
    code: 'CATALOG_BRAND_NAME_CONFLICT',
    category: 'state_conflict',
    defaultHttpStatus: 409,
    retryable: false,
    retryMode: 'after_user_action',
    outcome: 'no_effect',
    severity: 'warning',
    auditRequired: false,
  },
  {
    code: 'CATALOG_UOM_CODE_CONFLICT',
    category: 'state_conflict',
    defaultHttpStatus: 409,
    retryable: false,
    retryMode: 'after_user_action',
    outcome: 'no_effect',
    severity: 'warning',
    auditRequired: false,
  },
  {
    // BR-UOM-102: a conversion factor is positive and historically fixed —
    // changing it never rewrites past documents; a new version is created
    // instead. There is no update path at all; this code exists for any
    // caller that still attempts a direct edit.
    code: 'CATALOG_UOM_CONVERSION_IMMUTABLE',
    category: 'state_conflict',
    defaultHttpStatus: 409,
    retryable: false,
    retryMode: 'never',
    outcome: 'no_effect',
    severity: 'error',
    auditRequired: true,
  },
  {
    // BR-TYP-103: a Variant with transaction history cannot flip between
    // stocked/non_stock/service/bundle_kit_placeholder by direct edit; a new
    // Variant or a documented migration path is required instead.
    code: 'CATALOG_ITEM_TYPE_CHANGE_RESTRICTED',
    category: 'state_conflict',
    defaultHttpStatus: 409,
    retryable: false,
    retryMode: 'never',
    outcome: 'no_effect',
    severity: 'error',
    auditRequired: true,
  },
] as const satisfies readonly ErrorMetadata[];
