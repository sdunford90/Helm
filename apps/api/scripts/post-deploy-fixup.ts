import { PrismaClient } from '@prisma/client';

/**
 * Post-deploy idempotent fixups for production.
 *
 * Runs after `prisma migrate deploy` and after `prisma db seed` (which
 * is a no-op once production has data). Lets operators surgically nudge
 * specific seeded values via env vars without needing to wipe the DB.
 *
 * All updates are conditional on env vars being set AND the current DB
 * value being either the seed default OR already matching the target.
 * This means the script is safe to leave in the deploy pipeline forever:
 * once applied, it becomes a no-op; if the env vars are unset, it does
 * nothing.
 *
 * Env vars consumed:
 *   HELM_PLATFORM_ADMIN_EMAIL       → rename platform admin's email
 *   HELM_PLATFORM_ADMIN_FIRST_NAME  → update first name
 *   HELM_PLATFORM_ADMIN_LAST_NAME   → update last name
 *   HELM_PLATFORM_ADMIN_CLERK_ID    → wire to a real Clerk user id
 *   HELM_DEMO_TENANT_CUSTOM_DOMAIN  → swap demo tenant customDomain
 *
 * The platform admin update targets the SINGLE PLATFORM_ADMIN row (we
 * intentionally only support one — multi-admin is out of scope here).
 * The demo tenant update targets the tenant whose subdomain is "demo".
 */
async function main() {
  const prisma = new PrismaClient();
  let changed = 0;
  try {
    changed += await fixupPlatformAdmin(prisma);
    changed += await fixupDemoTenantDomain(prisma);
    if (changed === 0) {
      console.log('[post-deploy-fixup] no changes needed');
    } else {
      console.log(`[post-deploy-fixup] applied ${changed} change(s)`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

async function fixupPlatformAdmin(prisma: PrismaClient): Promise<number> {
  const targetEmail = process.env.HELM_PLATFORM_ADMIN_EMAIL?.trim();
  const targetFirst = process.env.HELM_PLATFORM_ADMIN_FIRST_NAME?.trim();
  const targetLast = process.env.HELM_PLATFORM_ADMIN_LAST_NAME?.trim();
  const targetClerk = process.env.HELM_PLATFORM_ADMIN_CLERK_ID?.trim();

  if (!targetEmail && !targetFirst && !targetLast && !targetClerk) {
    return 0;
  }

  const admins = await prisma.user.findMany({
    where: { role: 'PLATFORM_ADMIN' },
    orderBy: { createdAt: 'asc' },
  });

  if (admins.length === 0) {
    console.log('[post-deploy-fixup] no PLATFORM_ADMIN row found — skipping admin fixup');
    return 0;
  }
  if (admins.length > 1) {
    console.log(
      `[post-deploy-fixup] WARNING: found ${admins.length} PLATFORM_ADMIN rows — applying fixup only to oldest (${admins[0].email})`,
    );
  }

  const admin = admins[0];
  const data: {
    email?: string;
    firstName?: string;
    lastName?: string;
    clerkUserId?: string;
  } = {};

  if (targetEmail && targetEmail !== admin.email) {
    data.email = targetEmail;
  }
  if (targetFirst && targetFirst !== admin.firstName) {
    data.firstName = targetFirst;
  }
  if (targetLast && targetLast !== admin.lastName) {
    data.lastName = targetLast;
  }
  if (targetClerk && targetClerk !== admin.clerkUserId) {
    data.clerkUserId = targetClerk;
  }

  if (Object.keys(data).length === 0) {
    return 0;
  }

  await prisma.user.update({ where: { id: admin.id }, data });
  console.log(
    `[post-deploy-fixup] updated platform admin (id=${admin.id}) fields: ${Object.keys(data).join(', ')}`,
  );
  return 1;
}

async function fixupDemoTenantDomain(prisma: PrismaClient): Promise<number> {
  const target = process.env.HELM_DEMO_TENANT_CUSTOM_DOMAIN?.trim();
  if (!target) return 0;

  const tenant = await prisma.tenant.findFirst({ where: { subdomain: 'demo' } });
  if (!tenant) {
    console.log('[post-deploy-fixup] no tenant with subdomain="demo" — skipping domain fixup');
    return 0;
  }
  if (tenant.customDomain === target) {
    return 0;
  }

  await prisma.tenant.update({
    where: { id: tenant.id },
    data: { customDomain: target },
  });
  console.log(
    `[post-deploy-fixup] updated demo tenant customDomain: "${tenant.customDomain}" → "${target}"`,
  );
  return 1;
}

main().catch((err) => {
  console.error('[post-deploy-fixup] FAILED:', err);
  process.exitCode = 1;
});
