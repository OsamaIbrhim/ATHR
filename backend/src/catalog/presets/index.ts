import type { Prisma } from '@prisma/client';
import { parseAttributeDefinitions } from '../product-type-schema';
import { parseScaleBarcodeConfig, readTenantSettings } from '../tenant-settings';
import { clothing } from './clothing';
import { electronics } from './electronics';
import { general } from './general';
import { grocery } from './grocery';
import { pharmacy } from './pharmacy';
import type { CatalogPreset } from './preset';

/** Every trade preset. To add a trade: create its file, then list it here. */
export const PRESETS: readonly CatalogPreset[] = [general, clothing, grocery, electronics, pharmacy];

export const DEFAULT_PRESET_KEY = general.key;

/** The preset a signup `business_type` selects; unknown or missing = general. */
export function presetKeyFor(businessType: string | null | undefined): string {
  const type = businessType?.trim().toLowerCase();
  const preset = PRESETS.find((p) => p.key === type || p.business_types.includes(type ?? ''));
  return (preset ?? general).key;
}

/** Throws when a preset's data is invalid (used by applyPreset and by the preset test). */
export function assertValidPreset(preset: CatalogPreset): void {
  for (const type of preset.product_types) parseAttributeDefinitions(type.attributes);
  if (preset.settings?.scale_barcode) parseScaleBarcodeConfig(preset.settings.scale_barcode);
  for (const uom of preset.uoms) {
    if (!Number.isInteger(uom.precision) || uom.precision < 0 || uom.precision > 3) {
      throw new Error(`preset ${preset.key}: uom ${uom.code} has an invalid precision`);
    }
  }
}

/**
 * Gives a tenant the product types, units and settings of a preset. Safe to
 * run again: existing types/units (matched by name/code) are left untouched.
 */
export async function applyPreset(
  tx: Prisma.TransactionClient,
  tenantId: string,
  presetKey: string,
): Promise<void> {
  const preset = PRESETS.find((p) => p.key === presetKey) ?? general;
  assertValidPreset(preset);

  await tx.productType.createMany({
    data: preset.product_types.map((type) => ({
      tenant_id: tenantId,
      name_ar: type.name_ar,
      name_en: type.name_en,
      attributes: type.attributes as unknown as Prisma.InputJsonValue,
    })),
    skipDuplicates: true,
  });
  await tx.unitOfMeasure.createMany({
    data: preset.uoms.map((uom) => ({ tenant_id: tenantId, ...uom })),
    skipDuplicates: true,
  });
  if (preset.settings?.scale_barcode) {
    const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { settings: true } });
    const current = readTenantSettings(tenant.settings);
    const scale_barcode = parseScaleBarcodeConfig({ ...current.scale_barcode, ...preset.settings.scale_barcode });
    await tx.tenant.update({
      where: { id: tenantId },
      data: { settings: { ...(tenant.settings as object), scale_barcode } as unknown as Prisma.InputJsonValue },
    });
  }
}
