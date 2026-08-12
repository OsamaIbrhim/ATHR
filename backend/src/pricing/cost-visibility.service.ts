import { Injectable } from '@nestjs/common';
import { Prisma, type MembershipRole } from '@prisma/client';
import { PermissionPolicyService } from '../identity/permission-policy.service';
import type { AuthenticatedUser } from '../auth/authenticated-user';
import { sameMoney } from '../common/money';
import type { MoneyInput } from '../common/money';
import type { PriceQuote } from './pricing.service';

/**
 * WP-008 Phase B — the enforcement point for Permission Matrix §17's
 * `pricing.cost.view` / `pricing.margin.view` keys (BR-CST-101: an
 * unauthorized user does not see cost; Matrix §51: a cashier gets no
 * cost/margin visibility).
 *
 * Why this exists at all: `PriceQuote.min_allowed_price` is the BR-OVP-102
 * floor, and when an entry carries no explicit `floor_price` that floor **is**
 * the variant's `cost_price`. Post-migration no entry has an explicit floor,
 * so the field is cost for the entire catalog. A cashier holds
 * `pricing.manual-override.apply`, so `POST /pricing/overrides` was returning
 * cost verbatim — and the below-floor rejection message quoted it even when
 * the override was refused.
 *
 * It is also the enforcement point for Matrix §17's `sales.sale.view-cost-
 * margin`. That key guards a different disclosure — `SalesInvoiceItem.
 * unit_cost` is the variant's cost copied verbatim, not a floor that happens to
 * resolve to cost — but it is the same question about the same actor, and
 * resolving it anywhere else would mean a second place that decides who may see
 * cost. See `canViewSaleCostMargin`.
 *
 * The masking is deliberately **unconditional on the permission**, not
 * conditional on `floor_is_cost_derived`: whether the floor is cost-derived is
 * itself an inference channel, and the two are identical in practice today
 * anyway. Internal callers (`sales`/`offers`/`sync`, and `OverridesService`'s
 * own enforcement) keep the true floor — only what crosses an HTTP boundary to
 * a specific actor is masked. The persisted `PriceOverride.floor_price` also
 * keeps the true value: audit is not disclosure.
 */
@Injectable()
export class CostVisibilityService {
  constructor(private readonly permissionPolicy: PermissionPolicyService) {}

  /**
   * Matrix §17 `sales.sale.view-cost-margin` — the same question asked of a
   * *sale line* rather than of a price quote, and deliberately a different key
   * rather than a reuse of the two above.
   *
   * `SalesInvoiceItem.unit_cost` is not cost-*derived*, it is the variant's
   * `cost_price` copied verbatim at the moment of sale, and `ReturnItem.
   * unit_cost` carries it forward — so the sales read path discloses exact cost
   * without going anywhere near a floor. The Matrix gives that disclosure its
   * own key and grants it to `tenant_owner`/`location_manager` only; `cashier`
   * holds `sales.sale.view` but not this, which is Matrix §51 ("no cost/margin
   * visibility") stated for the till. Answering with `pricing.cost.view` here
   * would silently re-grant it to every role that happens to hold the pricing
   * key and deny it to one that holds only the sales key.
   */
  async canViewSaleCostMargin(actor: Pick<AuthenticatedUser, 'membership_role'>): Promise<boolean> {
    const role: MembershipRole | null = actor.membership_role ?? null;
    if (!role) return false;
    return this.permissionPolicy.hasPermission(role, 'sales.sale.view-cost-margin');
  }

  /** Either key grants it — Matrix §17 lists them separately, both imply cost-derived visibility. */
  async canViewCostDerivedValues(actor: Pick<AuthenticatedUser, 'membership_role'>): Promise<boolean> {
    const role: MembershipRole | null = actor.membership_role ?? null;
    if (!role) return false;
    const [cost, margin] = await Promise.all([
      this.permissionPolicy.hasPermission(role, 'pricing.cost.view'),
      this.permissionPolicy.hasPermission(role, 'pricing.margin.view'),
    ]);
    return cost || margin;
  }

  /**
   * The projection `POST /pricing/calculate` returns. A caller without
   * cost/margin visibility gets the sellable numbers only — no floor, and no
   * price-source identifiers that would let them enumerate entries.
   */
  async projectQuote(
    actor: Pick<AuthenticatedUser, 'membership_role'>,
    quote: PriceQuote,
  ): Promise<PriceQuote | Omit<PriceQuote, 'min_allowed_price' | 'floor_is_cost_derived' | 'source'>> {
    if (await this.canViewCostDerivedValues(actor)) return quote;
    const { min_allowed_price: _floor, floor_is_cost_derived: _derived, source: _source, ...visible } = quote;
    return visible;
  }

  /** Strips `floor_price` from a persisted override/list row before it leaves the API. */
  async maskFloor<T extends { floor_price?: unknown }>(
    actor: Pick<AuthenticatedUser, 'membership_role'>,
    row: T,
  ): Promise<T | Omit<T, 'floor_price'>> {
    if (await this.canViewCostDerivedValues(actor)) return row;
    const { floor_price: _floor, ...visible } = row;
    return visible;
  }

  async maskFloors<T extends { floor_price?: unknown }>(
    actor: Pick<AuthenticatedUser, 'membership_role'>,
    rows: readonly T[],
  ): Promise<(T | Omit<T, 'floor_price'>)[]> {
    if (await this.canViewCostDerivedValues(actor)) return [...rows];
    return rows.map(({ floor_price: _floor, ...visible }) => visible);
  }

  /**
   * The same floor under its other persisted name: `OfferSuggestion` stores the
   * quote's `min_allowed_price` verbatim, so a row of that table carries cost
   * for every migrated entry exactly as `PriceOverride.floor_price` does.
   *
   * `suggested_price` is the second disclosure on the same row. It is
   * `max(floor, current_price × 0.90)`, so on the clamped branch it *equals*
   * the floor and discloses cost just as directly — and `suggested_price ==
   * min_allowed_price` is precisely that branch (if the floor loses, the max is
   * strictly greater than it). On the `× 0.90` branch the number derives from
   * `current_price` alone, which the caller already holds; it stays visible
   * because there is nothing to hide there and masking it would empty the
   * endpoint for no gain.
   *
   * Residual, accepted rather than closed: an actor without the permission
   * still learns `cost ≥ current_price × 0.90` from the field's *absence*, and
   * `cost < current_price × 0.90` from its presence. That is a bound, not the
   * value — the exact-cost channel is what this closes. Note this makes the
   * mask value-conditional, unlike `projectQuote`'s deliberately unconditional
   * one above; the tradeoff is that the alternative removes the endpoint's only
   * actionable output.
   *
   * Unlike the override paths this is hardening, not a live leak: the only
   * roles that clear `GET /offers/suggestions` today (`tenant_owner`,
   * `location_manager`) both hold `pricing.cost.view`, so a freshly-seeded
   * environment masks nothing. It is worth routing through the gate anyway —
   * grants are read from the `PermissionPolicySnapshot` row rather than from
   * the catalog constant, and nothing but this call ties the offers read path
   * to cost visibility if a later phase narrows either role.
   */
  async maskOfferSuggestion<T extends CostDisclosingSuggestion>(
    actor: Pick<AuthenticatedUser, 'membership_role'>,
    row: T,
  ): Promise<MaskedSuggestion<T>> {
    if (await this.canViewCostDerivedValues(actor)) return row;
    return stripSuggestionCostFields(row);
  }

  /** The permission is resolved once for the whole page, not once per row. */
  async maskOfferSuggestions<T extends CostDisclosingSuggestion>(
    actor: Pick<AuthenticatedUser, 'membership_role'>,
    rows: readonly T[],
  ): Promise<MaskedSuggestion<T>[]> {
    if (await this.canViewCostDerivedValues(actor)) return [...rows];
    return rows.map((row) => stripSuggestionCostFields(row));
  }
}

type CostDisclosingSuggestion = { min_allowed_price?: unknown; suggested_price?: unknown };

/**
 * Three outcomes, narrowing left to right: the full row, the row without the
 * floor, and the row without either cost-disclosing field. The last is written
 * as a nested `Omit` because that is literally how it is destructured below —
 * TypeScript does not accept the flattened `Omit<T, 'a' | 'b'>` as equivalent
 * for a generic `T`.
 */
type MaskedSuggestion<T extends CostDisclosingSuggestion> =
  | T
  | Omit<T, 'min_allowed_price'>
  | Omit<Omit<T, 'min_allowed_price'>, 'suggested_price'>;

function isMoney(value: unknown): value is MoneyInput {
  return typeof value === 'number' || typeof value === 'string' || Prisma.Decimal.isDecimal(value);
}

/**
 * Both fields are stripped in one pass on purpose: the `suggested_price` test
 * reads `min_allowed_price`, so masking the floor first would silently degrade
 * the clamp check to "never mask".
 */
function stripSuggestionCostFields<T extends CostDisclosingSuggestion>(row: T): MaskedSuggestion<T> {
  const { min_allowed_price: floor, ...visible } = row;
  // Value-equality, not `===`: these are `Prisma.Decimal` instances on a real
  // database and plain numbers in unit fixtures. A tie (floor exactly equal to
  // `current_price × 0.90`) masks — the disclosed value is the floor either way.
  const clampedToFloor =
    isMoney(floor) && isMoney(visible.suggested_price) && sameMoney(floor, visible.suggested_price);
  if (!clampedToFloor) return visible;
  const { suggested_price: _clamped, ...withoutSuggested } = visible;
  return withoutSuggested;
}
