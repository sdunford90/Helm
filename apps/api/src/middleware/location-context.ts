import type { Request, Response, NextFunction, RequestHandler } from "express";
import { isLocationBypassRole } from "./auth.js";

// --------------------------------------------------------------------------
// Task #339 — request location context
//
// Reads the active location from `X-Helm-Location-Id` (or the legacy
// `?locationId=` query param for backward compat with hand-rolled callers)
// and exposes it on `req.locationId` plus `req.isAllLocations`.
//
// "All locations" is communicated by the sentinel value `__ALL__` (matching
// the frontend's `ALL_LOCATIONS_SENTINEL`) and is only honored when the
// caller is allowed to see more than one location, or is a platform admin.
// Single-location users get the header silently coerced to their one
// allowed location.
//
// The middleware is intentionally permissive when the header is missing:
// it falls back to the user's first allowed location (or the first member
// of `req.allowedLocationIds`), so legacy clients keep working. Routes
// that want to *require* a single-location call can read `req.locationId`
// and 400 themselves.
// --------------------------------------------------------------------------

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      // Single active location, or null when the caller is operating in
      // All-locations mode (only set when isAllLocations is true).
      locationId?: string | null;
      // True when the caller picked All locations and is allowed to do so.
      // Routes that already use `filterByAllowedLocations` keep working
      // unchanged in this mode.
      isAllLocations?: boolean;
    }
  }
}

export const ALL_LOCATIONS_SENTINEL = "__ALL__";

/** Header used by the SPA to communicate the active location. */
export const LOCATION_HEADER = "x-helm-location-id";

function readHeader(req: Request): string | null {
  const raw = req.headers[LOCATION_HEADER];
  if (typeof raw === "string" && raw.trim()) return raw.trim();
  if (Array.isArray(raw) && raw[0]) return String(raw[0]).trim();
  // Back-compat: a number of pages still send ?locationId= in the query.
  const q = req.query.locationId;
  if (typeof q === "string" && q.trim()) return q.trim();
  return null;
}

/**
 * Attach `req.locationId` / `req.isAllLocations` to every authenticated
 * request. Must run AFTER `clerkAuth()` because it depends on
 * `req.allowedLocationIds`.
 */
export function locationContext(): RequestHandler {
  return (req: Request, res: Response, next: NextFunction): void => {
    const allowed = req.allowedLocationIds;
    const isBypass = isLocationBypassRole(req.userRole) || allowed === null;
    const requested = readHeader(req);

    if (requested === ALL_LOCATIONS_SENTINEL) {
      // Bypass roles always allowed; otherwise need >1 allowed location.
      if (isBypass || (allowed && allowed.length > 1)) {
        req.isAllLocations = true;
        req.locationId = null;
        next();
        return;
      }
      // Single-location user trying to use All locations — coerce to their
      // one location instead of erroring (the SPA already hides the choice
      // for these users; this just stops a stale header from 400ing).
      req.isAllLocations = false;
      req.locationId = allowed && allowed[0] ? allowed[0] : null;
      next();
      return;
    }

    if (requested) {
      // Non-bypass users may only target their allowed locations.
      if (!isBypass && allowed && !allowed.includes(requested)) {
        res.status(403).json({
          error: "You do not have access to this location",
          code: "LOCATION_FORBIDDEN",
        });
        return;
      }
      req.isAllLocations = false;
      req.locationId = requested;
      next();
      return;
    }

    // No header supplied. Fail-closed for non-bypass users: we never
    // silently widen scope when the picker hasn't told us where to be.
    //   - Bypass roles → All locations (they have legitimate tenant-wide
    //     access; preserves prior behavior for back-office tooling).
    //   - Single-location non-bypass users → coerce to their one
    //     location (header is implied).
    //   - Multi-location non-bypass users with no header → 400. The SPA
    //     always sends the header from ModulesContext, so this only
    //     happens when a stale tab pre-dates the deploy or a hand-rolled
    //     caller forgot. Better to surface the bug than to leak data.
    if (isBypass) {
      req.isAllLocations = true;
      req.locationId = null;
      next();
      return;
    }
    if (allowed && allowed.length === 1) {
      req.isAllLocations = false;
      req.locationId = allowed[0];
      next();
      return;
    }
    res.status(400).json({
      error:
        "Missing X-Helm-Location-Id header. Pick a location in the top-right picker (refresh the page if you don't see it).",
      code: "LOCATION_HEADER_REQUIRED",
    });
  };
}

/**
 * Build a Prisma `where` fragment that scopes a query to the active
 * location. When the caller is in All-locations mode, falls back to the
 * existing per-user allowed-locations filter (or no filter for bypass
 * roles). The returned fragment is meant to be spread onto an existing
 * `where`:
 *
 *   const where = { tenantId, ...scopedWhere(req) };
 *
 * `field` defaults to `locationId`. Set `includeNull` for tables where
 * unscoped (legacy) rows should still be visible — Customer/Boat/Lead/
 * SlipContract use this until the backfill makes the column NOT NULL.
 */
export function scopedWhere(
  req: Request,
  opts: { field?: string; includeNull?: boolean } = {},
): Record<string, unknown> {
  const field = opts.field ?? "locationId";
  const allowed = req.allowedLocationIds;
  const isBypass = isLocationBypassRole(req.userRole) || allowed === null;

  // Single-location request: filter to that exact id (plus optionally NULL).
  if (req.locationId) {
    if (opts.includeNull) {
      return { OR: [{ [field]: req.locationId }, { [field]: null }] };
    }
    return { [field]: req.locationId };
  }

  // All-locations request from a bypass role → no extra filter.
  if (isBypass) return {};

  // All-locations request from a multi-location non-bypass user.
  if (allowed && allowed.length > 0) {
    if (opts.includeNull) {
      return { OR: [{ [field]: { in: allowed } }, { [field]: null }] };
    }
    return { [field]: { in: allowed } };
  }

  // No allowed locations and no bypass — return a never-match filter so the
  // user genuinely sees nothing instead of leaking tenant-wide data.
  return { [field]: { in: [] } };
}

/**
 * For create endpoints: returns the location to stamp onto a new row.
 * Throws (caller catches as 400) when the caller is in All-locations mode
 * and an explicit override wasn't supplied — we never want to silently
 * drop a row into "no location" on create.
 */
export function requireActiveLocation(
  req: Request,
  override?: string | null,
): string {
  if (override) {
    if (
      req.allowedLocationIds &&
      !isLocationBypassRole(req.userRole) &&
      !req.allowedLocationIds.includes(override)
    ) {
      const err = new Error("You do not have access to this location") as Error & {
        statusCode: number;
        code: string;
      };
      err.statusCode = 403;
      err.code = "LOCATION_FORBIDDEN";
      throw err;
    }
    return override;
  }
  if (req.locationId) return req.locationId;
  const err = new Error(
    "Pick a single location in the top-right picker before creating this record.",
  ) as Error & { statusCode: number; code: string };
  err.statusCode = 400;
  err.code = "LOCATION_REQUIRED";
  throw err;
}
