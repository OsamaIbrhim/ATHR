// WP-009 Phase A: warehouse_id is nullable only until PR2's InventoryStock
// primary-key swap makes it NOT NULL. Every fixture/smoke script that
// creates an InventoryStock/InventoryMovement row for a real branch needs
// that branch's real default Warehouse, not a placeholder -- resolving it
// here means new call sites can't reintroduce the gap by hand-rolling their
// own (possibly wrong) Location/Warehouse creation.
//
// Mirrors prisma/seed.ts's own resolution: reuse the branch's existing
// default Warehouse if one already exists (the normal case -- every branch
// the development seed creates has one), otherwise create a Location +
// default Warehouse for it, reusing the tenant's existing primary
// LegalEntity if there is one.
export async function resolveDefaultWarehouse(client, tenantId, branch) {
  const existing = await client.warehouse.findFirst({
    where: { tenant_id: tenantId, location_id: branch.id, is_default: true },
  });
  if (existing) {
    return existing;
  }

  const location =
    (await client.location.findUnique({ where: { id: branch.id } })) ??
    (await client.location.create({
      data: {
        id: branch.id,
        tenantId,
        legal_entity_id: (
          (await client.legalEntity.findFirst({ where: { tenant_id: tenantId, is_primary: true } })) ??
          (await client.legalEntity.create({
            data: { tenant_id: tenantId, legal_name: 'Default legal entity', is_primary: true },
          }))
        ).id,
        code: branch.code,
        name_ar: branch.name_ar,
        name_en: branch.name_en,
        address: branch.address,
        phone: branch.phone,
      },
    }));

  return client.warehouse.create({
    data: {
      tenant_id: tenantId,
      location_id: location.id,
      name: `${branch.name_ar ?? branch.code} — Default Warehouse`,
      is_default: true,
    },
  });
}
