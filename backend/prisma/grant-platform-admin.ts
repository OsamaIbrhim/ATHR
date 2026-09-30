import { PrismaClient } from '@prisma/client';

/**
 * Grants or revokes the platform-console flag for one existing user:
 *   npm run platform:admin -- <email-or-phone> [--revoke]
 * The flag gives access to the platform console only; it never grants tenant
 * membership or tenant data (ADR-0006).
 */
async function main() {
  const [identifier, flag] = process.argv.slice(2);
  if (!identifier) throw new Error('Usage: npm run platform:admin -- <email-or-phone> [--revoke]');
  const prisma = new PrismaClient();
  try {
    const user = await prisma.user.findFirst({
      where: { OR: [{ email: identifier }, { phone: identifier }] },
      select: { id: true },
    });
    if (!user) throw new Error(`No user found for ${identifier}`);
    const isPlatformAdmin = flag !== '--revoke';
    await prisma.user.update({ where: { id: user.id }, data: { is_platform_admin: isPlatformAdmin } });
    console.log(JSON.stringify({ event: 'platform_admin_updated', user_id: user.id, is_platform_admin: isPlatformAdmin }));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
