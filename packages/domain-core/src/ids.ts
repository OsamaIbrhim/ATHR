declare const opaqueIdBrand: unique symbol;

export type OpaqueId<Brand extends string> = string & {
  readonly [opaqueIdBrand]: Brand;
};

export function parseOpaqueId<Brand extends string>(
  value: string,
  brand: Brand,
): OpaqueId<Brand> {
  const normalized = value.trim();

  if (normalized.length === 0) {
    throw new Error(`${brand} ID must not be empty.`);
  }

  return normalized as OpaqueId<Brand>;
}

export type TenantId = OpaqueId<'Tenant'>;
export function parseTenantId(value: string): TenantId {
  return parseOpaqueId(value, 'Tenant');
}

export type MembershipId = OpaqueId<'Membership'>;
export function parseMembershipId(value: string): MembershipId {
  return parseOpaqueId(value, 'Membership');
}

export type InvitationId = OpaqueId<'Invitation'>;
export function parseInvitationId(value: string): InvitationId {
  return parseOpaqueId(value, 'Invitation');
}

export type IdempotencyKey = OpaqueId<'IdempotencyKey'>;
export function parseIdempotencyKey(value: string): IdempotencyKey {
  return parseOpaqueId(value, 'IdempotencyKey');
}

export type ClientOperationId = OpaqueId<'ClientOperationId'>;
export function parseClientOperationId(value: string): ClientOperationId {
  return parseOpaqueId(value, 'ClientOperationId');
}

export type CorrelationId = OpaqueId<'CorrelationId'>;
export function parseCorrelationId(value: string): CorrelationId {
  return parseOpaqueId(value, 'CorrelationId');
}

export type CausationId = OpaqueId<'CausationId'>;
export function parseCausationId(value: string): CausationId {
  return parseOpaqueId(value, 'CausationId');
}

declare const aggregateVersionBrand: unique symbol;

export type AggregateVersion = number & {
  readonly [aggregateVersionBrand]: true;
};

export function parseAggregateVersion(value: number): AggregateVersion {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new RangeError(
      `AggregateVersion must be a positive safe integer, got: ${value}`,
    );
  }

  return value as AggregateVersion;
}
