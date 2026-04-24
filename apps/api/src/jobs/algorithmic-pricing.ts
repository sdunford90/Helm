import { prisma } from '../lib/prisma.js';
import { queues } from '../lib/queue.js';

// --------------------------------------------------------------------------
// Types
// --------------------------------------------------------------------------

interface BookingPattern {
  productId: string;
  date: string;
  dayOfWeek: number;
  bookingLeadDays: number;
  occupancyRate: number;
  actualPriceCents: number;
  wasBooked: boolean;
}

interface DayOfWeekStats {
  totalBookings: number;
  totalWeeks: number;
  bookingRate: number;
  avgLeadDays: number;
  avgPriceCents: number;
}

// --------------------------------------------------------------------------
// Main pricing analysis function
// --------------------------------------------------------------------------

export async function runAlgorithmicPricing(tenantId: string): Promise<{ suggestionsCreated: number }> {
  // 1. Fetch all active rental products for this tenant
  const products = await prisma.rentalProduct.findMany({
    where: { tenantId, active: true },
  });

  let suggestionsCreated = 0;
  const ninetyDaysAgo = new Date(Date.now() - 90 * 86_400_000);
  const weeksInWindow = 13; // ~90 days / 7

  for (const product of products) {
    // 2. Fetch last 90 days of reservations for this product
    const reservations = await prisma.reservation.findMany({
      where: {
        rentalProductId: product.id,
        startDt: { gte: ninetyDaysAgo },
      },
      orderBy: { startDt: 'asc' },
    });

    // Need a minimum data threshold to produce meaningful suggestions
    if (reservations.length < 20) continue;

    // 3. Analyze patterns by day of week
    const dayStats: Record<number, DayOfWeekStats> = {};
    for (let dow = 0; dow < 7; dow++) {
      dayStats[dow] = {
        totalBookings: 0,
        totalWeeks: weeksInWindow,
        bookingRate: 0,
        avgLeadDays: 0,
        avgPriceCents: 0,
      };
    }

    // Accumulate booking data per day of week
    const leadDaysByDow: Record<number, number[]> = { 0: [], 1: [], 2: [], 3: [], 4: [], 5: [], 6: [] };
    const pricesByDow: Record<number, number[]> = { 0: [], 1: [], 2: [], 3: [], 4: [], 5: [], 6: [] };

    for (const res of reservations) {
      const startDate = new Date(res.startDt);
      const dow = startDate.getDay();
      dayStats[dow].totalBookings++;

      // Calculate lead time: days between creation and rental start
      const createdAt = new Date(res.createdAt);
      const leadDays = Math.max(0, Math.floor((startDate.getTime() - createdAt.getTime()) / 86_400_000));
      leadDaysByDow[dow].push(leadDays);

      // Track actual price paid (if available)
      if (res.totalCents) {
        pricesByDow[dow].push(res.totalCents);
      }
    }

    // Compute final stats per day of week
    for (let dow = 0; dow < 7; dow++) {
      const stats = dayStats[dow];
      stats.bookingRate = stats.totalBookings / weeksInWindow;

      const leads = leadDaysByDow[dow];
      stats.avgLeadDays = leads.length > 0
        ? leads.reduce((a, b) => a + b, 0) / leads.length
        : 0;

      const prices = pricesByDow[dow];
      stats.avgPriceCents = prices.length > 0
        ? Math.round(prices.reduce((a, b) => a + b, 0) / prices.length)
        : product.basePriceCents;
    }

    // 4. For each day in the next 30 days, calculate suggested price
    for (let dayOffset = 1; dayOffset <= 30; dayOffset++) {
      const targetDate = new Date(Date.now() + dayOffset * 86_400_000);
      const dayOfWeek = targetDate.getDay();
      const stats = dayStats[dayOfWeek];

      // Start from base rate
      let suggestedPrice = product.basePriceCents;

      // Apply demand multiplier based on historical booking rate
      if (stats.bookingRate > 0.85) {
        // Very high demand — premium markup
        suggestedPrice = Math.round(suggestedPrice * 1.20);
      } else if (stats.bookingRate > 0.65) {
        // High demand — moderate markup
        suggestedPrice = Math.round(suggestedPrice * 1.15);
      } else if (stats.bookingRate > 0.45) {
        // Moderate demand — slight markup
        suggestedPrice = Math.round(suggestedPrice * 1.05);
      } else if (stats.bookingRate < 0.2) {
        // Very low demand — deeper discount
        suggestedPrice = Math.round(suggestedPrice * 0.85);
      } else if (stats.bookingRate < 0.35) {
        // Low demand — discount to drive bookings
        suggestedPrice = Math.round(suggestedPrice * 0.90);
      }

      // Apply lead-time factor: if bookings typically happen last-minute,
      // apply a slight premium for advance bookings (scarcity signal)
      if (stats.avgLeadDays < 3 && stats.bookingRate > 0.5) {
        // Short lead time + decent demand = last-minute pricing opportunity
        suggestedPrice = Math.round(suggestedPrice * 1.05);
      } else if (stats.avgLeadDays > 14 && stats.bookingRate < 0.4) {
        // Long lead time + low demand = encourage early booking with discount
        suggestedPrice = Math.round(suggestedPrice * 0.95);
      }

      // Clamp to floor and ceiling
      suggestedPrice = Math.max(
        product.floorPriceCents ?? 0,
        Math.min(product.ceilingPriceCents ?? Infinity, suggestedPrice),
      );

      // 5. Only create suggestion if price differs from base by more than 10%
      const diff = Math.abs(suggestedPrice - product.basePriceCents) / product.basePriceCents;
      if (diff > 0.10) {
        // Build a human-readable reason
        let reason: string;
        if (suggestedPrice > product.basePriceCents) {
          reason = `High historical demand for ${getDayName(dayOfWeek)}s (${(stats.bookingRate * 100).toFixed(0)}% booking rate over 90 days)`;
        } else {
          reason = `Low historical demand for ${getDayName(dayOfWeek)}s (${(stats.bookingRate * 100).toFixed(0)}% booking rate) — suggest discount to drive bookings`;
        }

        // 6. Persist the suggestion
        await prisma.algorithmicSuggestion.create({
          data: {
            rentalProductId: product.id,
            suggestedDate: targetDate,
            rulePriceCents: product.basePriceCents,
            suggestedPriceCents: suggestedPrice,
            reason,
            status: 'PENDING',
          },
        });
        suggestionsCreated++;
      }
    }
  }

  return { suggestionsCreated };
}

// --------------------------------------------------------------------------
// Helper
// --------------------------------------------------------------------------

function getDayName(dow: number): string {
  return ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][dow];
}

// --------------------------------------------------------------------------
// BullMQ recurring schedule (runs every Sunday at midnight)
// --------------------------------------------------------------------------

export function scheduleAlgorithmicPricing(): void {
  queues.automation.add('algorithmic-pricing', {}, {
    repeat: { pattern: '0 0 * * 0' }, // Every Sunday at midnight
    removeOnComplete: 10,
    removeOnFail: 5,
  });
}
