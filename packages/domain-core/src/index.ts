declare const opaqueIdBrand: unique symbol;

export type OpaqueId<TEntity extends string> = string & {
  readonly [opaqueIdBrand]: TEntity;
};

export function parseOpaqueId<TEntity extends string>(
  value: string,
  entity: TEntity,
): OpaqueId<TEntity> {
  const normalized = value.trim();

  if (normalized.length === 0) {
    throw new Error(`${entity} ID must not be empty.`);
  }

  return normalized as OpaqueId<TEntity>;
}
