// Card-expiry date math for the portal. Mirrors `pickExpiryWindow` in
// `apps/api/src/services/card-expiry-reminders.ts` so the in-app banner
// and the proactive email pipeline always agree on which cards are in
// the 30-day or 7-day warning window.

export type ExpiryWindow = '30_DAY' | '7_DAY';

export interface ExpirableCard {
  kind: 'card' | 'bank';
  expMonth: number | null;
  expYear: number | null;
}

/**
 * The moment a card stops being valid: end-of-day (UTC) on the last day
 * of its expiry month. Card networks honour cards through the end of the
 * printed expiry month, so this is the same cutoff the API uses.
 */
export function cardExpiryDate(expMonth: number, expYear: number): Date {
  // Day 0 of month (expMonth + 1) === last day of expMonth, because JS
  // Date months are 0-indexed and day 0 rolls back into the prior month.
  return new Date(Date.UTC(expYear, expMonth, 0, 23, 59, 59, 999));
}

/**
 * True when the card's expiry month has fully passed. Uses the same
 * cutoff as the API, so a card is "expired" only after the last day of
 * its printed expiry month — not the moment that month begins.
 */
export function isCardExpired(method: ExpirableCard, now: Date = new Date()): boolean {
  if (method.kind !== 'card') return false;
  if (!method.expMonth || !method.expYear) return false;
  return cardExpiryDate(method.expMonth, method.expYear).getTime() <= now.getTime();
}

/**
 * Which reminder window (if any) applies to a card. Matches the API's
 * `pickExpiryWindow` exactly: returns `'7_DAY'` when ≤7 days remain,
 * `'30_DAY'` when ≤30 days remain, and `null` otherwise (including for
 * already-expired cards, which are handled by the louder expired-card
 * warnings instead).
 */
export function getExpiryWindow(
  expMonth: number,
  expYear: number,
  now: Date = new Date(),
): ExpiryWindow | null {
  const end = cardExpiryDate(expMonth, expYear);
  if (end.getTime() <= now.getTime()) return null;
  const msPerDay = 86_400_000;
  const daysLeft = Math.ceil((end.getTime() - now.getTime()) / msPerDay);
  if (daysLeft <= 7) return '7_DAY';
  if (daysLeft <= 30) return '30_DAY';
  return null;
}
