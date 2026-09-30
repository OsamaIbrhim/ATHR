import type { Prisma } from '@prisma/client';
import { DEFAULT_SCALE_BARCODE_CONFIG, type ScaleBarcodeConfig } from '@athr/domain-core';
import { AthrDomainError } from '../common/http/athr-exception.filter';

/**
 * Tenant-level settings live in `Tenant.settings` (one Json column). This file
 * is the only place that knows its shape; add a setting here, not elsewhere.
 */
export interface TenantSettings {
  scale_barcode: ScaleBarcodeConfig;
}

/** Reads the stored settings, filling anything missing with the defaults. */
export function readTenantSettings(stored: Prisma.JsonValue | null | undefined): TenantSettings {
  const raw = (stored && typeof stored === 'object' && !Array.isArray(stored) ? stored : {}) as Record<string, unknown>;
  return {
    scale_barcode: { ...DEFAULT_SCALE_BARCODE_CONFIG, ...((raw.scale_barcode as object) ?? {}) },
  };
}

/** Validates a scale-barcode config coming from a client or a preset. */
export function parseScaleBarcodeConfig(input: unknown): ScaleBarcodeConfig {
  const config = { ...DEFAULT_SCALE_BARCODE_CONFIG, ...((input as object) ?? {}) } as ScaleBarcodeConfig;
  const bad = (message: string): never => {
    throw new AthrDomainError('REQUEST_FIELD_VALUE_INVALID', `scale_barcode: ${message}`);
  };
  if (typeof config.enabled !== 'boolean') bad('enabled must be true or false');
  if (!Array.isArray(config.prefixes) || !config.prefixes.every((p) => /^\d{2}$/.test(p))) {
    bad('prefixes must be two-digit strings');
  }
  if (!Number.isInteger(config.item_digits) || config.item_digits < 1 || config.item_digits > 8) {
    bad('item_digits must be between 1 and 8');
  }
  if (config.value !== 'weight' && config.value !== 'price') bad('value must be "weight" or "price"');
  if (!Number.isInteger(config.decimals) || config.decimals < 0 || config.decimals > 4) {
    bad('decimals must be between 0 and 4');
  }
  if (typeof config.price_includes_tax !== 'boolean') bad('price_includes_tax must be true or false');
  return config;
}
