import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const INITIAL_TENANT_NAME = 'Initial ATHR Demo Tenant';

// WP-005 Phase B (MT-MIG-001, Multi-tenancy Blueprint §115): seeds exactly one
// Tenant + its OrganizationProfile + its primary LegalEntity. Idempotent per
// BR-TPR-100 — safe to re-run; never creates a second Tenant of this name.
//
// The 202608020001_add_tenant_foundation migration already performs this
// same idempotent seed directly in SQL (so a single unattended
// `prisma migrate deploy` run applying all of MT-MIG-001-004 back to back
// does not need a manual step in between). This script is a no-op once that
// migration has run; it exists as a standalone operational tool and for
// building test fixtures against a schema-only (pre-seed) database state.
async function main() {
  const existing = await prisma.tenant.findFirst({
    where: { name: INITIAL_TENANT_NAME },
    include: { organization_profile: true, legal_entities: true },
  });

  if (existing) {
    console.log(`Initial tenant already exists: ${existing.id}`);
    return existing;
  }

  const tenant = await prisma.$transaction(async (tx) => {
    const created = await tx.tenant.create({
      data: {
        name: INITIAL_TENANT_NAME,
        organization_profile: {
          create: { display_name: INITIAL_TENANT_NAME },
        },
        legal_entities: {
          create: { legal_name: INITIAL_TENANT_NAME, is_primary: true },
        },
      },
      include: { organization_profile: true, legal_entities: true },
    });

    return created;
  });

  console.log(`Created initial tenant: ${tenant.id}`);
  return tenant;
}

if (require.main === module) {
  main()
    .then(async () => {
      await prisma.$disconnect();
    })
    .catch(async (e) => {
      console.error(e);
      await prisma.$disconnect();
      process.exit(1);
    });
}

export { main as seedInitialTenant, INITIAL_TENANT_NAME };
