import { Router, type Request, type Response, type NextFunction } from "express";
import { z } from "zod";
import { Prisma, PosDiscountKind } from "@prisma/client";
import { clerkAuth, requireRole, filterByAllowedLocations } from "../middleware/auth.js";
import { prisma } from "../lib/prisma.js";

const router: Router = Router();

// ─── Schemas ───────────────────────────────────────────────────────────────

const KindEnum = z.nativeEnum(PosDiscountKind);

// Each discount must target EXACTLY one of (productCategoryId, productId).
// Enforced via .refine() because Postgres can't express XOR cleanly without
// a check constraint, and the route layer is the one place every write goes
// through anyway.
const TargetXor = (s: { productCategoryId?: string | null; productId?: string | null }) =>
  Boolean(s.productCategoryId) !== Boolean(s.productId);

const CreateDiscountSchema = z
  .object({
    locationId: z.string().uuid(),
    name: z.string().min(1).max(100),
    kind: KindEnum,
    // PERCENT: 1..10000 basis points (0.01% .. 100%). AMOUNT: positive cents.
    value: z.number().int().positive(),
    productCategoryId: z.string().uuid().optional().nullable(),
    productId: z.string().uuid().optional().nullable(),
    appliesToAllCustomers: z.boolean().default(false),
    eligibleCustomerIds: z.array(z.string().uuid()).default([]),
  })
  .refine(TargetXor, {
    message: "Exactly one of productCategoryId or productId is required",
    path: ["productCategoryId"],
  })
  .refine((s) => s.kind !== PosDiscountKind.PERCENT || s.value <= 10000, {
    message: "PERCENT value must be in basis points and ≤ 10000 (100%)",
    path: ["value"],
  });

const UpdateDiscountSchema = z
  .object({
    name: z.string().min(1).max(100).optional(),
    kind: KindEnum.optional(),
    value: z.number().int().positive().optional(),
    productCategoryId: z.string().uuid().optional().nullable(),
    productId: z.string().uuid().optional().nullable(),
    appliesToAllCustomers: z.boolean().optional(),
    active: z.boolean().optional(),
    eligibleCustomerIds: z.array(z.string().uuid()).optional(),
  })
  .refine(
    (s) => {
      // Only enforce XOR if either target field is being changed
      if (s.productCategoryId === undefined && s.productId === undefined) return true;
      // When changing one, both must be provided so the route knows the
      // final state (otherwise we'd have to fetch then merge, which is racy).
      if (s.productCategoryId === undefined || s.productId === undefined) return false;
      return Boolean(s.productCategoryId) !== Boolean(s.productId);
    },
    {
      message:
        "When changing the target, supply BOTH productCategoryId and productId (one as null) so exactly one is set",
      path: ["productCategoryId"],
    },
  );

const PreviewSchema = z.object({
  locationId: z.string().uuid(),
  customerId: z.string().uuid().optional().nullable(),
  lineItems: z
    .array(
      z.object({
        productId: z.string().uuid(),
        quantity: z.number().int().positive(),
        unitPriceCents: z.number().int().min(0),
      }),
    )
    .min(1),
});

// ─── Auth: every endpoint here requires marina ownership ───────────────────
// Cashiers can SEE applied discounts (via the preview endpoint) but only
// owners/managers should configure them.

router.use(clerkAuth());

// ─── GET / — list discounts for a location (or all the caller can see) ────
router.get("/", async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const tenantId = req.tenantId!;
    const locationId =
      typeof req.query.locationId === "string" ? req.query.locationId : undefined;
    const includeInactive = req.query.includeInactive === "true";

    const where: Prisma.PosDiscountWhereInput = { tenantId };
    if (locationId) where.locationId = locationId;
    if (!includeInactive) where.active = true;

    // Apply role-based location scoping: includeNull=true so tenant-wide
    // discounts (locationId=null) remain visible alongside the caller's
    // allowed location-scoped discounts.
    filterByAllowedLocations(req, where as Record<string, unknown>, {
      includeNull: true,
    });

    const discounts = await prisma.posDiscount.findMany({
      where,
      orderBy: [{ active: "desc" }, { name: "asc" }],
      include: {
        productCategory: { select: { id: true, name: true } },
        product: { select: { id: true, name: true, sku: true } },
        location: { select: { id: true, name: true } },
        _count: { select: { eligibleCustomers: true } },
      },
    });

    res.json({ data: discounts });
  } catch (err) {
    next(err);
  }
});

// ─── GET /:id — single discount with eligible customers ───────────────────
router.get("/:id", async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const tenantId = req.tenantId!;
    const discount = await prisma.posDiscount.findFirst({
      where: { id: req.params.id, tenantId },
      include: {
        productCategory: { select: { id: true, name: true } },
        product: { select: { id: true, name: true, sku: true } },
        location: { select: { id: true, name: true } },
        eligibleCustomers: {
          include: {
            customer: {
              select: { id: true, firstName: true, lastName: true, email: true, company: true },
            },
          },
        },
      },
    });
    if (!discount) {
      res.status(404).json({ error: "Discount not found" });
      return;
    }
    res.json(discount);
  } catch (err) {
    next(err);
  }
});

// ─── POST / — create a discount ────────────────────────────────────────────
router.post(
  "/",
  requireRole("MARINA_OWNER", "MARINA_MANAGER"),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId = req.tenantId!;
      const data = CreateDiscountSchema.parse(req.body);

      // Tenant-isolation check on the target location and target product/category
      // so a spoofed body can't link a discount to another tenant's data.
      const [loc, cat, prod] = await Promise.all([
        prisma.location.findFirst({
          where: { id: data.locationId, tenantId },
          select: { id: true },
        }),
        data.productCategoryId
          ? prisma.productCategory.findFirst({
              where: { id: data.productCategoryId, tenantId },
              select: { id: true },
            })
          : Promise.resolve(null),
        data.productId
          ? prisma.product.findFirst({
              where: { id: data.productId, tenantId },
              select: { id: true },
            })
          : Promise.resolve(null),
      ]);
      if (!loc) {
        res.status(404).json({ error: "Location not found" });
        return;
      }
      if (data.productCategoryId && !cat) {
        res.status(404).json({ error: "Product category not found" });
        return;
      }
      if (data.productId && !prod) {
        res.status(404).json({ error: "Product not found" });
        return;
      }

      const discount = await prisma.posDiscount.create({
        data: {
          tenantId,
          locationId: data.locationId,
          name: data.name,
          kind: data.kind,
          value: data.value,
          productCategoryId: data.productCategoryId ?? null,
          productId: data.productId ?? null,
          appliesToAllCustomers: data.appliesToAllCustomers,
          eligibleCustomers: {
            create: data.eligibleCustomerIds.map((customerId) => ({ customerId })),
          },
        },
        include: {
          productCategory: { select: { id: true, name: true } },
          product: { select: { id: true, name: true, sku: true } },
          _count: { select: { eligibleCustomers: true } },
        },
      });

      res.status(201).json(discount);
    } catch (err) {
      next(err);
    }
  },
);

// ─── PUT /:id — update a discount ─────────────────────────────────────────
router.put(
  "/:id",
  requireRole("MARINA_OWNER", "MARINA_MANAGER"),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId = req.tenantId!;
      const data = UpdateDiscountSchema.parse(req.body);

      const existing = await prisma.posDiscount.findFirst({
        where: { id: req.params.id, tenantId },
        select: { id: true },
      });
      if (!existing) {
        res.status(404).json({ error: "Discount not found" });
        return;
      }

      // If the eligible-customer list is being replaced, do it in a
      // delete-all + recreate inside a single transaction so a partial
      // failure can't leave half the old set in place.
      const updated = await prisma.$transaction(async (tx) => {
        await tx.posDiscount.update({
          where: { id: existing.id },
          data: {
            ...(data.name !== undefined ? { name: data.name } : {}),
            ...(data.kind !== undefined ? { kind: data.kind } : {}),
            ...(data.value !== undefined ? { value: data.value } : {}),
            ...(data.productCategoryId !== undefined
              ? { productCategoryId: data.productCategoryId ?? null }
              : {}),
            ...(data.productId !== undefined ? { productId: data.productId ?? null } : {}),
            ...(data.appliesToAllCustomers !== undefined
              ? { appliesToAllCustomers: data.appliesToAllCustomers }
              : {}),
            ...(data.active !== undefined ? { active: data.active } : {}),
          },
        });

        if (data.eligibleCustomerIds) {
          await tx.posDiscountCustomer.deleteMany({
            where: { posDiscountId: existing.id },
          });
          if (data.eligibleCustomerIds.length) {
            await tx.posDiscountCustomer.createMany({
              data: data.eligibleCustomerIds.map((customerId) => ({
                posDiscountId: existing.id,
                customerId,
              })),
              skipDuplicates: true,
            });
          }
        }

        return tx.posDiscount.findUnique({
          where: { id: existing.id },
          include: {
            productCategory: { select: { id: true, name: true } },
            product: { select: { id: true, name: true, sku: true } },
            _count: { select: { eligibleCustomers: true } },
          },
        });
      });

      res.json(updated);
    } catch (err) {
      next(err);
    }
  },
);

// ─── DELETE /:id — soft-delete (active=false) ─────────────────────────────
router.delete(
  "/:id",
  requireRole("MARINA_OWNER", "MARINA_MANAGER"),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId = req.tenantId!;
      const existing = await prisma.posDiscount.findFirst({
        where: { id: req.params.id, tenantId },
        select: { id: true },
      });
      if (!existing) {
        res.status(404).json({ error: "Discount not found" });
        return;
      }
      await prisma.posDiscount.update({
        where: { id: existing.id },
        data: { active: false },
      });
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  },
);

// ─── POST /preview — evaluate a cart against this customer's discounts ────
// Used by the POS UI to show the cart total *before* the cashier hits
// checkout, so the customer sees the savings line-by-line. The same
// evaluation logic also runs server-side in POST /api/pos/transactions —
// the preview is an advisory mirror, NEVER trusted for money math.
router.post("/preview", async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const tenantId = req.tenantId!;
    const data = PreviewSchema.parse(req.body);

    const lines = await evaluateDiscountsForCart({
      tenantId,
      locationId: data.locationId,
      customerId: data.customerId ?? null,
      lineItems: data.lineItems,
    });

    res.json({ lineItems: lines });
  } catch (err) {
    next(err);
  }
});

// ───────────────────────────────────────────────────────────────────────────
// Discount engine — exported so the POST /transactions handler in pos.ts
// can call exactly the same evaluation. Single source of truth for which
// discount wins per line.
// ───────────────────────────────────────────────────────────────────────────

export interface DiscountEvalLine {
  productId: string;
  quantity: number;
  unitPriceCents: number;
}

export interface DiscountEvalResult {
  productId: string;
  quantity: number;
  unitPriceCents: number;
  /** Gross before discount (qty * unit). */
  grossCents: number;
  /** Cents taken off the line by the winning discount (≥ 0). */
  discountCents: number;
  /** Net of discount = grossCents - discountCents (≥ 0, never below zero). */
  netCents: number;
  appliedDiscountId: string | null;
  discountSourceLabel: string | null;
}

/**
 * Evaluate auto-applied PosDiscount rules against a cart for a given
 * (location, customer) pair. Returns one entry per input line (in order),
 * with the winning discount (largest savings) selected per line. No
 * stacking — multiple matches collapse to the single best.
 *
 * When no customer is attached, no auto-discounts apply (returns 0 for
 * each line). This matches the product spec: discounts are customer-gated.
 */
export async function evaluateDiscountsForCart(args: {
  tenantId: string;
  locationId: string | null;
  customerId: string | null;
  lineItems: DiscountEvalLine[];
}): Promise<DiscountEvalResult[]> {
  const { tenantId, locationId, customerId, lineItems } = args;

  // Anonymous walk-in or no location → no auto-discounts.
  if (!customerId || !locationId || lineItems.length === 0) {
    return lineItems.map((li) => {
      const gross = li.unitPriceCents * li.quantity;
      return {
        productId: li.productId,
        quantity: li.quantity,
        unitPriceCents: li.unitPriceCents,
        grossCents: gross,
        discountCents: 0,
        netCents: gross,
        appliedDiscountId: null,
        discountSourceLabel: null,
      };
    });
  }

  // Pull every active discount for the location that EITHER applies to all
  // customers OR is explicitly linked to this customer. One query covers
  // all lines — we'll bucket per-line in JS.
  const discounts = await prisma.posDiscount.findMany({
    where: {
      tenantId,
      locationId,
      active: true,
      OR: [
        { appliesToAllCustomers: true },
        { eligibleCustomers: { some: { customerId } } },
      ],
    },
    select: {
      id: true,
      name: true,
      kind: true,
      value: true,
      productCategoryId: true,
      productId: true,
    },
  });

  if (discounts.length === 0) {
    return lineItems.map((li) => {
      const gross = li.unitPriceCents * li.quantity;
      return {
        productId: li.productId,
        quantity: li.quantity,
        unitPriceCents: li.unitPriceCents,
        grossCents: gross,
        discountCents: 0,
        netCents: gross,
        appliedDiscountId: null,
        discountSourceLabel: null,
      };
    });
  }

  // Resolve productCategoryId for every line product so category-level
  // discounts can match. One round-trip for the whole cart.
  const productIds = Array.from(new Set(lineItems.map((li) => li.productId)));
  const products = await prisma.product.findMany({
    where: { id: { in: productIds }, tenantId },
    select: { id: true, productCategoryId: true },
  });
  const productCategoryById = new Map(products.map((p) => [p.id, p.productCategoryId]));

  return lineItems.map((li) => {
    const grossCents = li.unitPriceCents * li.quantity;
    const categoryId = productCategoryById.get(li.productId) ?? null;

    // Candidate = any discount whose target matches this line.
    const candidates = discounts.filter((d) => {
      if (d.productId && d.productId === li.productId) return true;
      if (d.productCategoryId && categoryId && d.productCategoryId === categoryId) return true;
      return false;
    });

    if (candidates.length === 0) {
      return {
        productId: li.productId,
        quantity: li.quantity,
        unitPriceCents: li.unitPriceCents,
        grossCents,
        discountCents: 0,
        netCents: grossCents,
        appliedDiscountId: null,
        discountSourceLabel: null,
      };
    }

    // Compute savings for each candidate and pick the largest. Floor to
    // cents and clamp so the net never goes below zero (a 100% discount on
    // a $10 line saves exactly $10, not more).
    let bestDiscountCents = 0;
    let bestId: string | null = null;
    let bestLabel: string | null = null;
    for (const d of candidates) {
      let saving: number;
      if (d.kind === PosDiscountKind.PERCENT) {
        // value is basis points: savings = floor(gross * value / 10000)
        saving = Math.floor((grossCents * d.value) / 10000);
      } else {
        // AMOUNT: cents off the line (capped at gross)
        saving = d.value;
      }
      if (saving > grossCents) saving = grossCents;
      if (saving < 0) saving = 0;
      if (saving > bestDiscountCents) {
        bestDiscountCents = saving;
        bestId = d.id;
        bestLabel = formatDiscountLabel(d);
      }
    }

    return {
      productId: li.productId,
      quantity: li.quantity,
      unitPriceCents: li.unitPriceCents,
      grossCents,
      discountCents: bestDiscountCents,
      netCents: grossCents - bestDiscountCents,
      appliedDiscountId: bestId,
      discountSourceLabel: bestLabel,
    };
  });
}

function formatDiscountLabel(d: {
  name: string;
  kind: PosDiscountKind;
  value: number;
}): string {
  if (d.kind === PosDiscountKind.PERCENT) {
    // Render basis points as a friendly percent: 1000 → "10%", 1250 → "12.5%"
    const pct = d.value / 100;
    const display = Number.isInteger(pct) ? pct.toFixed(0) : pct.toFixed(2).replace(/0$/, "");
    return `${d.name} (${display}% off)`;
  }
  return `${d.name} ($${(d.value / 100).toFixed(2)} off)`;
}

export default router;
