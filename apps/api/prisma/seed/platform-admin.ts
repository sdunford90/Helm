import type { PrismaClient } from '@prisma/client';

/**
 * Bootstrap a single PLATFORM_ADMIN user so the admin panel is signable
 * into in any environment (dev or prod).
 *
 * Identity is driven by env vars so prod can target a real human Clerk
 * account, while dev gets a sensible placeholder:
 *
 *   HELM_PLATFORM_ADMIN_EMAIL      (default: admin@helm.local)
 *   HELM_PLATFORM_ADMIN_FIRST_NAME (default: Platform)
 *   HELM_PLATFORM_ADMIN_LAST_NAME  (default: Admin)
 *   HELM_PLATFORM_ADMIN_CLERK_ID   (optional — set in prod to map this row
 *                                   to the real Clerk user that signs in)
 *
 * The admin is created under the demo tenant (passed in) because every
 * User row currently requires a tenantId. The admin's role of
 * PLATFORM_ADMIN means they bypass tenant scoping at the middleware
 * layer (`requirePlatformAdmin`), so the parent tenant is purely a
 * foreign-key host.
 *
 * Idempotent: re-running upserts on email so existing admin rows keep
 * their adminRole/clerkUserId, just refreshing the human-readable name.
 */
export async function seedPlatformAdmin(
  prisma: PrismaClient,
  hostTenantId: string,
) {
  const email = (process.env.HELM_PLATFORM_ADMIN_EMAIL ?? 'admin@helm.local').trim();
  const firstName = (process.env.HELM_PLATFORM_ADMIN_FIRST_NAME ?? 'Platform').trim();
  const lastName = (process.env.HELM_PLATFORM_ADMIN_LAST_NAME ?? 'Admin').trim();
  const clerkUserId = process.env.HELM_PLATFORM_ADMIN_CLERK_ID?.trim() || null;

  // Look up by email first so we can preserve any existing clerkUserId
  // that has already been wired to a real Clerk account.
  const existing = await prisma.user.findFirst({
    where: { email, role: 'PLATFORM_ADMIN' },
  });

  if (existing) {
    return prisma.user.update({
      where: { id: existing.id },
      data: {
        firstName,
        lastName,
        adminRole: existing.adminRole ?? 'SUPERUSER',
        active: true,
        // Only overwrite clerkUserId if the env var is set — otherwise
        // keep whatever is already mapped.
        ...(clerkUserId ? { clerkUserId } : {}),
      },
    });
  }

  return prisma.user.create({
    data: {
      tenantId: hostTenantId,
      email,
      firstName,
      lastName,
      role: 'PLATFORM_ADMIN',
      adminRole: 'SUPERUSER',
      active: true,
      clerkUserId,
    },
  });
}
