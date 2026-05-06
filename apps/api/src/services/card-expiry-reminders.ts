import type Stripe from "stripe";
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { requireStripe } from "../lib/stripe.js";
import { getStripeAccountForCustomer } from "../lib/stripe-account.js";
import { queues } from "../lib/queue.js";

// ---------------------------------------------------------------------------
// Card-expiry proactive email reminders
//
// A scheduled job that scans every active customer's default Stripe payment
// method and emails them when the card is about to expire. We send at two
// windows: 30 days before the card stops being valid, and again at 7 days.
//
// Idempotency: persisted via the `card_expiry_reminders` table — one row
// per (tenant, payment-method, expMonth, expYear, window). Including the
// expiry month/year in the unique key means that when a customer replaces
// the card with one that has a different expiry, the next sweep treats it
// as a new card and may send fresh reminders.
// ---------------------------------------------------------------------------

export type ExpiryWindow = "30_DAY" | "7_DAY";

export interface CardExpiryReminderResult {
  scanned: number;
  remindersSent: number;
  skippedAlreadySent: number;
  skippedNoCard: number;
  skippedExpired: number;
  errors: number;
}

/**
 * Compute the moment a card stops being valid: end-of-day on the last day
 * of its expiry month, in UTC. (Card networks honour cards through the end
 * of the printed expiry month.)
 */
export function cardExpiryDate(expMonth: number, expYear: number): Date {
  // Day 0 of (expMonth + 1) === last day of expMonth. JS Date months are
  // 0-indexed, so passing `expMonth` (1-12) directly resolves to the
  // following month, and day 0 rolls back into the prior month's last day.
  return new Date(Date.UTC(expYear, expMonth, 0, 23, 59, 59, 999));
}

/**
 * Decide which reminder window (if any) applies to a card whose expiry is
 * (expMonth, expYear). Returns null when the card is already expired or
 * still more than 30 days away — we only ever send during the [30..7] day
 * window or the [7..0] day window.
 *
 * The 7-day window has priority over the 30-day window: if both happen to
 * apply (e.g. a stale row never sent the 30-day notice), the caller should
 * still send the more urgent one. Idempotency keys are per-window so this
 * doesn't conflict with a 30-day row that may have been written earlier.
 */
export function pickExpiryWindow(
  expMonth: number,
  expYear: number,
  now: Date = new Date(),
): ExpiryWindow | null {
  const end = cardExpiryDate(expMonth, expYear);
  if (end.getTime() <= now.getTime()) return null;
  const msPerDay = 86_400_000;
  const daysLeft = Math.ceil((end.getTime() - now.getTime()) / msPerDay);
  if (daysLeft <= 7) return "7_DAY";
  if (daysLeft <= 30) return "30_DAY";
  return null;
}

function buildPortalUrl(): string {
  const base =
    process.env.APP_PORTAL_URL ?? process.env.APP_URL ?? "https://gethelm.com";
  return `${base.replace(/\/+$/, "")}/payments`;
}

/**
 * Run a single tenant's card-expiry reminder sweep. Safe to rerun: any
 * card+window already represented in `card_expiry_reminders` is skipped.
 */
export async function runCardExpiryReminders(
  tenantId: string,
  now: Date = new Date(),
): Promise<CardExpiryReminderResult> {
  const result: CardExpiryReminderResult = {
    scanned: 0,
    remindersSent: 0,
    skippedAlreadySent: 0,
    skippedNoCard: 0,
    skippedExpired: 0,
    errors: 0,
  };

  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { id: true, name: true, subdomain: true },
  });
  if (!tenant) return result;

  const customers = await prisma.customer.findMany({
    where: {
      tenantId,
      status: "ACTIVE",
      stripeCustomerId: { not: null },
    },
    select: {
      id: true,
      email: true,
      firstName: true,
      lastName: true,
      stripeCustomerId: true,
    },
  });

  const stripe = requireStripe();
  const portalUrl = buildPortalUrl();

  for (const customer of customers) {
    result.scanned += 1;

    if (!customer.email || !customer.stripeCustomerId) {
      result.skippedNoCard += 1;
      continue;
    }

    try {
      const { stripeAccountId } = await getStripeAccountForCustomer(
        customer.id,
        tenantId,
      );
      if (!stripeAccountId) {
        result.skippedNoCard += 1;
        continue;
      }

      const stripeOpts = { stripeAccount: stripeAccountId };

      const sc = (await stripe.customers.retrieve(
        customer.stripeCustomerId,
        {},
        stripeOpts,
      )) as Stripe.Customer;

      // Only consider PaymentMethod-based defaults. Legacy `default_source`
      // (e.g. `card_...` IDs) belongs to the old Sources API and can't be
      // looked up via `paymentMethods.retrieve`; the rest of the platform
      // already requires PaymentMethods, so a customer without one is
      // genuinely "no card on file" for our purposes.
      const defaultPmId =
        typeof sc.invoice_settings?.default_payment_method === "string"
          ? sc.invoice_settings.default_payment_method
          : null;

      if (!defaultPmId) {
        result.skippedNoCard += 1;
        continue;
      }

      const pm = await stripe.paymentMethods.retrieve(
        defaultPmId,
        {},
        stripeOpts,
      );

      if (
        pm.type !== "card" ||
        !pm.card?.exp_month ||
        !pm.card?.exp_year
      ) {
        result.skippedNoCard += 1;
        continue;
      }

      const expMonth = pm.card.exp_month;
      const expYear = pm.card.exp_year;

      // Already-expired cards are handled elsewhere (loud in-app warning +
      // autopay block) — no email here.
      if (cardExpiryDate(expMonth, expYear).getTime() <= now.getTime()) {
        result.skippedExpired += 1;
        continue;
      }

      const window = pickExpiryWindow(expMonth, expYear, now);
      if (!window) continue;

      // ── Atomic reservation w/ lease-based takeover ──────────────────────
      // Step 1: try INSERT. The unique index on
      // (tenantId, stripePaymentMethodId, expMonth, expYear, window) makes
      // exactly one concurrent inserter win — losers get P2002.
      //
      // Step 2 (on P2002): look up the existing row.
      //   • status=SENT       → already delivered, skip.
      //   • PENDING & fresh   → another sweep is in flight; skip (DO NOT
      //                          adopt — that's the race that causes
      //                          duplicate enqueues).
      //   • PENDING & stale   → previous run reserved and never finished
      //                          (likely crashed). Try to atomically take
      //                          over the lease via updateMany with the
      //                          staleness predicate. Only one runner wins
      //                          the takeover; the rest see count=0.
      //
      // Lease window is intentionally generous (1 hour) so a slow but
      // healthy run is never mistaken for a crash. The cron only fires
      // once per day, so stale rows always get cleared on the next run.
      const RESERVATION_LEASE_MS = 60 * 60 * 1000;
      const leaseCutoff = new Date(now.getTime() - RESERVATION_LEASE_MS);

      let reservation: { id: string } | null = null;
      try {
        reservation = await prisma.cardExpiryReminder.create({
          data: {
            tenantId,
            customerId: customer.id,
            stripePaymentMethodId: pm.id,
            stripeAccountId,
            brand: pm.card.brand ?? null,
            last4: pm.card.last4 ?? null,
            expMonth,
            expYear,
            window,
            status: "PENDING",
            reservedAt: now,
          },
        });
      } catch (err) {
        if (
          err instanceof Prisma.PrismaClientKnownRequestError &&
          err.code === "P2002"
        ) {
          const existing = await prisma.cardExpiryReminder.findUnique({
            where: {
              tenant_pm_expiry_window: {
                tenantId,
                stripePaymentMethodId: pm.id,
                expMonth,
                expYear,
                window,
              },
            },
          });
          if (!existing || existing.status === "SENT") {
            result.skippedAlreadySent += 1;
            continue;
          }
          // PENDING — only adopt if the reservation has gone stale AND we
          // win the conditional updateMany. Postgres row-locking serialises
          // the WHERE evaluation, so concurrent takeovers can never both
          // succeed: the first one bumps reservedAt; the second sees a
          // fresh reservedAt and gets count=0.
          if (existing.reservedAt > leaseCutoff) {
            // Fresh PENDING owned by another live runner → skip without
            // enqueuing. We don't bump skippedAlreadySent because the
            // reminder will go out (just from the other runner).
            result.skippedAlreadySent += 1;
            continue;
          }
          const taken = await prisma.cardExpiryReminder.updateMany({
            where: {
              id: existing.id,
              status: "PENDING",
              reservedAt: { lt: leaseCutoff },
            },
            data: { reservedAt: now },
          });
          if (taken.count === 0) {
            // Lost the takeover race to another runner → skip.
            result.skippedAlreadySent += 1;
            continue;
          }
          reservation = { id: existing.id };
        } else {
          throw err;
        }
      }

      if (!reservation) {
        // Defensive: should be unreachable.
        continue;
      }

      const customerName =
        [customer.firstName, customer.lastName]
          .filter(Boolean)
          .join(" ") || "Customer";
      const brandRaw = pm.card.brand ?? "card";
      const brand = brandRaw.replace(/^\w/, (c) => c.toUpperCase());
      const last4 = pm.card.last4 ?? "****";
      const expiryLabel = `${String(expMonth).padStart(2, "0")}/${expYear}`;

      await queues.email.add("send", {
        type: "card_expiry_reminder",
        to: customer.email,
        // marinaDomain remains as legacy fallback when no per-tenant
        // emailFromDomain override is configured (resolveEmailSender()
        // handles that lookup at send time).
        marinaDomain: tenant.subdomain ?? undefined,
        tenantId,
        data: {
          customerName,
          brand,
          last4,
          expiryLabel,
          window,
          marinaName: tenant.name,
          portalUrl,
        },
      });

      // Flip the reservation to SENT. If this update fails we leave the
      // PENDING row in place; the next sweep will adopt it and re-enqueue
      // (which is preferable to silently losing the reminder).
      await prisma.cardExpiryReminder.update({
        where: { id: reservation.id },
        data: { status: "SENT", sentAt: new Date() },
      });

      result.remindersSent += 1;
    } catch (err) {
      result.errors += 1;
      console.error(
        `[card-expiry-reminders] tenant=${tenantId} customer=${customer.id} failed:`,
        err instanceof Error ? err.message : err,
      );
    }
  }

  return result;
}

/**
 * Run the sweep for every active tenant. Used by the daily cron.
 */
export async function runCardExpiryRemindersForAllTenants(
  now: Date = new Date(),
): Promise<{ tenants: number; totalSent: number; totalErrors: number }> {
  const tenants = await prisma.tenant.findMany({
    where: { status: "ACTIVE" },
    select: { id: true },
  });
  let totalSent = 0;
  let totalErrors = 0;
  for (const t of tenants) {
    try {
      const r = await runCardExpiryReminders(t.id, now);
      totalSent += r.remindersSent;
      totalErrors += r.errors;
    } catch (err) {
      totalErrors += 1;
      console.error(
        `[card-expiry-reminders] tenant=${t.id} sweep failed:`,
        err instanceof Error ? err.message : err,
      );
    }
  }
  return { tenants: tenants.length, totalSent, totalErrors };
}
