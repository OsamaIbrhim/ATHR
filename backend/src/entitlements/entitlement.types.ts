import type { LimitKey } from './catalog';

/** What a tenant may currently do: full/grace = normal use, read_only = GET only, suspended = nothing. */
export type AccessMode = 'full' | 'grace' | 'read_only' | 'suspended';

export type PlanLimits = Readonly<Partial<Record<LimitKey, number | null>>>;

export interface EntitlementAccess {
  readonly mode: AccessMode;
  /** `null` when the tenant has no subscription at all. */
  readonly planCode: string | null;
  readonly planName: { readonly ar: string; readonly en: string } | null;
  readonly features: ReadonlySet<string>;
  readonly limits: PlanLimits;
  readonly status: string | null;
  readonly trialEndsAt: Date | null;
  readonly periodEnd: Date | null;
  /** `grace` only: the last moment of full-plus-grace access. */
  readonly graceUntil: Date | null;
  /** `read_only`/`suspended` only: since when the tenant is restricted. */
  readonly restrictedSince: Date | null;
  /** Changes whenever the subscription or its plan changes. */
  readonly snapshotVersion: number;
}
