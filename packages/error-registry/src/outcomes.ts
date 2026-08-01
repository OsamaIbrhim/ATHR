/** Outcome certainty — Error Catalog v1.0 §6. Exhaustive. */
export const OUTCOME_CERTAINTIES = [
  'no_effect',
  'committed',
  'pending',
  'partial',
  'unknown',
  'not_applicable',
] as const;

export type OutcomeCertainty = (typeof OUTCOME_CERTAINTIES)[number];
