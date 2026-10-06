import { AthrDomainError } from '../common/http/athr-exception.filter';

/**
 * The ONE definition and validator of product-type attributes. A product type
 * is a list of these; a variant stores the values keyed by `key`. The axis
 * attributes are the ones that distinguish the variants of one product
 * (size, colour ...) and make up the variant label.
 */
export type AttributeKind = 'text' | 'number' | 'select';

export interface AttributeDefinition {
  readonly key: string;
  readonly label_ar: string;
  readonly label_en: string;
  readonly kind: AttributeKind;
  readonly options?: readonly string[];
  readonly axis: boolean;
}

export type AttributeValues = Readonly<Record<string, string | number>>;

const KINDS: readonly AttributeKind[] = ['text', 'number', 'select'];
const KEY_PATTERN = /^[a-z][a-z0-9_]{0,39}$/;
const LABEL_SEPARATOR = ' · ';
const MAX_ATTRIBUTES = 20;
const MAX_TEXT_LENGTH = 100;

function invalid(message: string): never {
  throw new AthrDomainError('REQUEST_FIELD_VALUE_INVALID', message);
}

const isText = (value: unknown, max = MAX_TEXT_LENGTH): value is string =>
  typeof value === 'string' && value.trim().length > 0 && value.length <= max;

/** Validates a product type's attribute list and returns it normalised. */
export function parseAttributeDefinitions(input: unknown): AttributeDefinition[] {
  if (!Array.isArray(input) || input.length > MAX_ATTRIBUTES) {
    invalid(`attributes must be an array of at most ${MAX_ATTRIBUTES} definitions`);
  }
  const seen = new Set<string>();
  return input.map((raw, index): AttributeDefinition => {
    const at = `attributes[${index}]`;
    if (!raw || typeof raw !== 'object') invalid(`${at} must be an object`);
    const { key, label_ar, label_en, kind, options, axis } = raw as Record<string, unknown>;
    if (typeof key !== 'string' || !KEY_PATTERN.test(key)) invalid(`${at}.key must match ${KEY_PATTERN}`);
    if (seen.has(key)) invalid(`${at}.key "${key}" is duplicated`);
    seen.add(key);
    if (!isText(label_ar) || !isText(label_en)) invalid(`${at} needs label_ar and label_en`);
    if (!KINDS.includes(kind as AttributeKind)) invalid(`${at}.kind must be one of ${KINDS.join(', ')}`);
    if (typeof axis !== 'boolean') invalid(`${at}.axis must be true or false`);
    if (kind === 'select') {
      if (!Array.isArray(options) || !options.length || !options.every((o) => isText(o))) {
        invalid(`${at}.options must be a non-empty list of texts for a select attribute`);
      }
      return { key, label_ar, label_en, kind, options: options as string[], axis };
    }
    if (options !== undefined) invalid(`${at}.options is only allowed for a select attribute`);
    return { key, label_ar, label_en, kind: kind as AttributeKind, axis };
  });
}

/**
 * Validates a variant's attribute values against its product type (no type =
 * no definitions = no values) and returns the normalised values. Every axis
 * attribute is required; the others are optional.
 */
export function parseVariantAttributes(
  definitions: readonly AttributeDefinition[],
  input: unknown,
): AttributeValues {
  const values = input ?? {};
  if (typeof values !== 'object' || Array.isArray(values)) invalid('attributes must be an object');
  const record = values as Record<string, unknown>;
  const known = new Set(definitions.map((d) => d.key));
  for (const key of Object.keys(record)) {
    if (!known.has(key)) invalid(`attribute "${key}" is not defined by the product type`);
  }
  const result: Record<string, string | number> = {};
  for (const def of definitions) {
    const value = record[def.key];
    if (value === undefined || value === null || value === '') {
      if (def.axis) invalid(`attribute "${def.key}" is required`);
      continue;
    }
    if (def.kind === 'number') {
      if (typeof value !== 'number' || !Number.isFinite(value)) invalid(`attribute "${def.key}" must be a number`);
      result[def.key] = value;
    } else {
      if (!isText(value)) invalid(`attribute "${def.key}" must be a non-empty text`);
      if (def.kind === 'select' && !def.options!.includes(value)) {
        invalid(`attribute "${def.key}" must be one of: ${def.options!.join(', ')}`);
      }
      result[def.key] = value.trim();
    }
  }
  return result;
}

/** "L · أسود": the axis values in the type's attribute order ("" for a simple product). */
export function variantLabel(
  definitions: readonly AttributeDefinition[],
  values: AttributeValues,
): string {
  return definitions
    .filter((def) => def.axis && values[def.key] !== undefined)
    .map((def) => String(values[def.key]))
    .join(LABEL_SEPARATOR);
}
