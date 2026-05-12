import { Router, type Request, type Response, type NextFunction } from "express";
import { z } from "zod";
import type Stripe from "stripe";
import { clerkAuth } from "../middleware/auth.js";
import { prisma } from "../lib/prisma.js";
import { deleteFile as deleteFileFromStorage } from "../lib/storage.js";
import { requireStripe } from "../lib/stripe.js";

const router: Router = Router();

// Mirrors the `isCardExpired` helper used in the portal UI: a card is
// expired once the current month has passed its (exp_month, exp_year).
// Bank accounts and PMs missing expiry data are treated as not-expired.
function isStripeCardExpired(
  pm: Stripe.PaymentMethod,
  now: Date = new Date(),
): boolean {
  const exp_month = pm.card?.exp_month ?? null;
  const exp_year = pm.card?.exp_year ?? null;
  if (!exp_month || !exp_year) return false;
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1;
  if (exp_year < currentYear) return true;
  if (exp_year === currentYear && exp_month < currentMonth) return true;
  return false;
}

router.use(...clerkAuth());

// ---------------------------------------------------------------------------
// Portal customer resolver
//
// Portal users are linked to a Customer by matching the authenticated user's
// email against customer.email within the same tenant.
// ---------------------------------------------------------------------------

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      portalCustomerId?: string;
    }
  }
}

async function resolvePortalCustomer(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const email = req.userRecord?.email;
  const tenantId = req.tenantId;
  if (!email || !tenantId) {
    res.status(403).json({ error: "Portal access requires a linked customer", code: "NO_PORTAL_CUSTOMER" });
    return;
  }

  const customer = await prisma.customer.findFirst({
    where: { tenantId, email },
    select: { id: true },
  });
  if (!customer) {
    res.status(403).json({ error: "No customer record linked to this account", code: "NO_PORTAL_CUSTOMER" });
    return;
  }

  req.portalCustomerId = customer.id;
  next();
}

router.use(resolvePortalCustomer);

// ---------------------------------------------------------------------------
// Helper — resolve tenant Stripe account ID (fallback)
// ---------------------------------------------------------------------------
async function getTenantStripeAccount(tenantId: string): Promise<string | null> {
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { stripeAccountId: true },
  });
  return tenant?.stripeAccountId ?? null;
}

// ---------------------------------------------------------------------------
// Helper — resolve Stripe account for a specific invoice
//
// Looks up invoice.locationId → location.stripeAccountId.
// Falls back to the tenant-level Stripe account when the invoice has no
// location or the location has no Stripe account connected yet.
//
// Returns:
//   stripeAccountId   — the account to use (null if nothing is configured)
//   locationConnected — false when the invoice belongs to a location whose
//                       Stripe onboarding is NOT complete; callers can use
//                       this to surface a clear error to the customer.
//   invoiceNotFound   — true when a customer-scoped lookup found no invoice;
//                       callers in portal context should return 404/403.
// ---------------------------------------------------------------------------
async function getStripeAccountForInvoice(
  invoiceId: string,
  tenantId: string,
  // When provided, restricts the invoice lookup to this customer — required in
  // portal context to prevent a portal user from supplying another customer's
  // invoiceId and influencing Stripe account routing (BOLA protection).
  customerId?: string,
): Promise<{ stripeAccountId: string | null; locationConnected: boolean; invoiceNotFound?: boolean }> {
  const invoice = await prisma.invoice.findFirst({
    where: {
      id: invoiceId,
      tenantId,
      ...(customerId ? { customerId } : {}),
    },
    select: {
      locationId: true,
      location: {
        select: {
          stripeAccountId: true,
          stripeOnboardingComplete: true,
        },
      },
    },
  });

  // When a customer-scoped lookup is performed and the invoice is not found,
  // signal this explicitly so callers can return a 404 rather than silently
  // falling back to the tenant account (which would mask authorization errors).
  if (!invoice && customerId) {
    return { stripeAccountId: null, locationConnected: false, invoiceNotFound: true };
  }

  // If the invoice has a location with a Stripe account, use it.
  if (invoice?.location?.stripeAccountId) {
    return {
      stripeAccountId: invoice.location.stripeAccountId,
      locationConnected: invoice.location.stripeOnboardingComplete,
    };
  }

  // Location exists but Stripe onboarding is incomplete — signal this clearly.
  if (invoice?.locationId && !invoice?.location?.stripeAccountId) {
    return { stripeAccountId: null, locationConnected: false };
  }

  // No location on the invoice — fall back to the tenant-level account.
  const tenantAccountId = await getTenantStripeAccount(tenantId);
  return { stripeAccountId: tenantAccountId, locationConnected: true };
}

// ---------------------------------------------------------------------------
// GET /api/portal/me — current portal customer summary
// ---------------------------------------------------------------------------
router.get("/me", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const customer = await prisma.customer.findUnique({
      where: { id: req.portalCustomerId! },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        company: true,
        email: true,
        phone: true,
        stripeCustomerId: true,
      },
    });
    if (!customer) {
      res.status(404).json({ error: "Customer not found" });
      return;
    }
    res.json(customer);
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// GET /api/portal/invoices — list invoices for the customer
// ---------------------------------------------------------------------------
router.get("/invoices", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const invoices = await prisma.invoice.findMany({
      where: { tenantId: req.tenantId, customerId: req.portalCustomerId! },
      select: {
        id: true,
        invoiceNumber: true,
        status: true,
        issuedDate: true,
        dueDate: true,
        subtotalCents: true,
        taxCents: true,
        totalCents: true,
        balanceCents: true,
      },
      orderBy: { issuedDate: "desc" },
      take: 50,
    });
    res.json(invoices);
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// GET /api/portal/invoices/:id — single invoice with line items + payments
// ---------------------------------------------------------------------------
router.get(
  "/invoices/:id",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const invoice = await prisma.invoice.findFirst({
        where: {
          id: String(req.params.id),
          tenantId: req.tenantId,
          customerId: req.portalCustomerId!,
        },
        include: {
          lineItems: true,
          payments: {
            select: {
              id: true,
              amountCents: true,
              method: true,
              status: true,
              postedDate: true,
            },
            orderBy: { postedDate: "desc" },
          },
        },
      });
      if (!invoice) {
        res.status(404).json({ error: "Invoice not found" });
        return;
      }
      res.json(invoice);
    } catch (err) {
      next(err);
    }
  },
);

// ---------------------------------------------------------------------------
// GET /api/portal/boats — customer's boats
// ---------------------------------------------------------------------------
router.get("/boats", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const boats = await prisma.boat.findMany({
      where: { tenantId: req.tenantId, customerId: req.portalCustomerId! },
      orderBy: { name: "asc" },
    });
    res.json(boats);
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// Boat photos (portal-side) — customers can attach pictures to their own
// boats. The R2 object is uploaded directly from the browser via the existing
// /api/storage/presign-upload flow with category="boats"; these endpoints
// just manage the metadata rows after the upload completes.
// ---------------------------------------------------------------------------

const PORTAL_BOAT_PHOTO_MAX_BYTES = 10 * 1024 * 1024;
const PORTAL_BOAT_PHOTO_ALLOWED_MIME = ["image/png", "image/jpeg", "image/webp"] as const;

const PortalCreateBoatPhotoSchema = z.object({
  filename: z.string().min(1).max(255),
  contentType: z.enum(PORTAL_BOAT_PHOTO_ALLOWED_MIME),
  sizeBytes: z.number().int().nonnegative().max(PORTAL_BOAT_PHOTO_MAX_BYTES),
  storageKey: z.string().min(1).max(512),
});

async function findPortalBoat(req: Request, boatId: string) {
  return prisma.boat.findFirst({
    where: {
      id: boatId,
      tenantId: req.tenantId!,
      customerId: req.portalCustomerId!,
    },
    select: { id: true },
  });
}

router.get(
  "/boats/:boatId/photos",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const boat = await findPortalBoat(req, req.params.boatId);
      if (!boat) {
        res.status(404).json({ error: "Boat not found", code: "NOT_FOUND" });
        return;
      }
      const photos = await prisma.boatPhoto.findMany({
        where: { boatId: boat.id, tenantId: req.tenantId! },
        orderBy: { createdAt: "desc" },
      });
      res.json(photos);
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  "/boats/:boatId/photos",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const boat = await findPortalBoat(req, req.params.boatId);
      if (!boat) {
        res.status(404).json({ error: "Boat not found", code: "NOT_FOUND" });
        return;
      }

      const parsed = PortalCreateBoatPhotoSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          error: "Invalid request body",
          code: "INVALID_BODY",
          issues: parsed.error.issues,
        });
        return;
      }
      const { filename, contentType, sizeBytes, storageKey } = parsed.data;

      // Boat photos are uploaded under `${tenantId}/boats/...` via the
      // presign flow. Reject any other prefix so a client can't smuggle
      // an object signed for another category onto a boat record.
      if (!storageKey.startsWith(`${req.tenantId}/boats/`)) {
        res
          .status(400)
          .json({ error: "Invalid storage key", code: "INVALID_STORAGE_KEY" });
        return;
      }

      const photo = await prisma.boatPhoto.create({
        data: {
          tenantId: req.tenantId!,
          boatId: boat.id,
          filename,
          contentType,
          sizeBytes,
          storageKey,
          uploadedById: req.userId ?? null,
        },
      });
      res.status(201).json(photo);
    } catch (err) {
      next(err);
    }
  },
);

router.delete(
  "/boats/:boatId/photos/:photoId",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const boat = await findPortalBoat(req, req.params.boatId);
      if (!boat) {
        res.status(404).json({ error: "Boat not found", code: "NOT_FOUND" });
        return;
      }
      const photo = await prisma.boatPhoto.findFirst({
        where: {
          id: req.params.photoId,
          boatId: boat.id,
          tenantId: req.tenantId!,
        },
      });
      if (!photo) {
        res.status(404).json({ error: "Photo not found", code: "NOT_FOUND" });
        return;
      }
      await prisma.boatPhoto.delete({ where: { id: photo.id } });
      // Best-effort R2 cleanup so the object doesn't outlive its metadata
      // even when the caller skips the client-side cleanup step.
      await deleteFileFromStorage(photo.storageKey).catch((err) => {
        console.warn("[portal-boat-photo] R2 cleanup failed", {
          storageKey: photo.storageKey,
          error: err instanceof Error ? err.message : err,
        });
      });
      res.json({ success: true });
    } catch (err) {
      next(err);
    }
  },
);

// ---------------------------------------------------------------------------
// GET /api/portal/dashboard — roll-up used by the portal home page
// ---------------------------------------------------------------------------
router.get(
  "/dashboard",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const customerId = req.portalCustomerId!;
      const tenantId = req.tenantId!;

      const [outstandingAgg, recentInvoices, boats, upcomingPayment] = await Promise.all([
        prisma.invoice.aggregate({
          where: {
            tenantId,
            customerId,
            status: { in: ["ISSUED", "PAST_DUE"] },
          },
          _sum: { balanceCents: true },
          _count: true,
        }),
        prisma.invoice.findMany({
          where: { tenantId, customerId },
          orderBy: { issuedDate: "desc" },
          take: 5,
          select: {
            id: true,
            invoiceNumber: true,
            status: true,
            issuedDate: true,
            dueDate: true,
            totalCents: true,
            balanceCents: true,
          },
        }),
        prisma.boat.count({ where: { tenantId, customerId } }),
        prisma.invoice.findFirst({
          where: {
            tenantId,
            customerId,
            status: "ISSUED",
            dueDate: { gte: new Date() },
          },
          orderBy: { dueDate: "asc" },
          select: {
            id: true,
            invoiceNumber: true,
            dueDate: true,
            balanceCents: true,
          },
        }),
      ]);

      res.json({
        outstandingBalanceCents: outstandingAgg._sum?.balanceCents ?? 0,
        openInvoiceCount: outstandingAgg._count ?? 0,
        recentInvoices,
        boatCount: boats,
        nextDueInvoice: upcomingPayment,
      });
    } catch (err) {
      next(err);
    }
  },
);

// ---------------------------------------------------------------------------
// GET /api/portal/payment-methods — list saved payment methods + autopay
//
// Optional query param: ?invoiceId=<id>
// When provided the response is scoped to the Stripe account for that invoice's
// location (with fallback to the tenant account).
// ---------------------------------------------------------------------------
router.get(
  "/payment-methods",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const customerId = req.portalCustomerId!;
      const tenantId = req.tenantId!;
      const invoiceId = typeof req.query.invoiceId === "string" ? req.query.invoiceId : undefined;

      const customer = await prisma.customer.findUnique({
        where: { id: customerId },
        select: { stripeCustomerId: true },
      });

      if (!customer?.stripeCustomerId) {
        res.json({ methods: [], autopay: false, defaultMethodId: null });
        return;
      }

      let stripeAccountId: string | null;
      if (invoiceId) {
        const result = await getStripeAccountForInvoice(invoiceId, tenantId, customerId);
        if (result.invoiceNotFound) {
          res.status(404).json({ error: "Invoice not found", code: "NOT_FOUND" });
          return;
        }
        if (!result.locationConnected) {
          res.status(400).json({
            error: "Stripe payments are not yet configured for this location. Please contact the marina.",
            code: "LOCATION_STRIPE_NOT_CONFIGURED",
          });
          return;
        }
        stripeAccountId = result.stripeAccountId;
      } else {
        stripeAccountId = await getTenantStripeAccount(tenantId);
      }

      if (!stripeAccountId) {
        res.json({ methods: [], autopay: false, defaultMethodId: null });
        return;
      }

      const stripe = requireStripe();
      const stripeOpts = { stripeAccount: stripeAccountId };

      const [cardList, bankList, stripeCustomer] = await Promise.all([
        stripe.paymentMethods.list(
          { customer: customer.stripeCustomerId, type: "card" },
          stripeOpts,
        ),
        stripe.paymentMethods.list(
          { customer: customer.stripeCustomerId, type: "us_bank_account" },
          stripeOpts,
        ),
        stripe.customers.retrieve(customer.stripeCustomerId, {}, stripeOpts),
      ]);

      const sc = stripeCustomer as import("stripe").default.Customer;
      const defaultMethodId =
        (typeof sc.invoice_settings?.default_payment_method === "string"
          ? sc.invoice_settings.default_payment_method
          : null) ??
        (typeof sc.default_source === "string" ? sc.default_source : null);

      const autopay = sc.metadata?.autopay === "true";

      const methods = [
        ...cardList.data.map((pm) => ({
          id: pm.id,
          type: pm.card?.brand ?? "card",
          label: (pm.card?.brand ?? "Card").replace(/^\w/, (c) => c.toUpperCase()),
          last4: pm.card?.last4 ?? "****",
          expMonth: pm.card?.exp_month ?? null,
          expYear: pm.card?.exp_year ?? null,
          expiry: pm.card?.exp_month && pm.card?.exp_year
            ? `${String(pm.card.exp_month).padStart(2, "0")}/${String(pm.card.exp_year).slice(-2)}`
            : null,
          isDefault: pm.id === defaultMethodId,
          kind: "card" as const,
          // Per-PM "usable in POS" opt-in (Stripe metadata). Lets the customer
          // pre-authorize the marina to charge this card at the POS counter.
          usableInPos: pm.metadata?.usableInPos === "true",
        })),
        ...bankList.data.map((pm) => ({
          id: pm.id,
          type: "bank",
          label: pm.us_bank_account?.bank_name ?? "Bank Account",
          last4: pm.us_bank_account?.last4 ?? "****",
          expMonth: null,
          expYear: null,
          expiry: null,
          isDefault: pm.id === defaultMethodId,
          kind: "bank" as const,
          usableInPos: false,
        })),
      ];

      res.json({ methods, autopay, defaultMethodId });
    } catch (err) {
      next(err);
    }
  },
);

// ---------------------------------------------------------------------------
// POST /api/portal/payment-methods/setup-session
// Creates a Stripe Checkout session in setup mode so the customer can securely
// add a card or bank account via Stripe's hosted UI.
//
// Optional body field: invoiceId
// When provided the session is created in the Stripe account for that
// invoice's location (with fallback to the tenant account).
// ---------------------------------------------------------------------------
router.post(
  "/payment-methods/setup-session",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const customerId = req.portalCustomerId!;
      const tenantId = req.tenantId!;
      const { returnUrl, type = "card", invoiceId } = req.body as {
        returnUrl?: string;
        type?: "card" | "bank";
        invoiceId?: string;
      };

      const customer = await prisma.customer.findUnique({
        where: { id: customerId },
        select: { stripeCustomerId: true, email: true, firstName: true, lastName: true },
      });

      let stripeAccountId: string | null;
      if (invoiceId) {
        const result = await getStripeAccountForInvoice(invoiceId, tenantId, customerId);
        if (result.invoiceNotFound) {
          res.status(404).json({ error: "Invoice not found", code: "NOT_FOUND" });
          return;
        }
        if (!result.locationConnected) {
          res.status(400).json({
            error: "Stripe payments are not yet configured for this location. Please contact the marina.",
            code: "LOCATION_STRIPE_NOT_CONFIGURED",
          });
          return;
        }
        stripeAccountId = result.stripeAccountId;
      } else {
        stripeAccountId = await getTenantStripeAccount(tenantId);
      }

      if (!stripeAccountId) {
        res.status(400).json({ error: "Stripe not configured for this marina", code: "STRIPE_NOT_CONFIGURED" });
        return;
      }

      const stripe = requireStripe();
      const stripeOpts = { stripeAccount: stripeAccountId };

      // Ensure the customer has a Stripe customer record
      let stripeCustomerId = customer?.stripeCustomerId;
      if (!stripeCustomerId) {
        const sc = await stripe.customers.create(
          {
            email: customer?.email ?? undefined,
            name: [customer?.firstName, customer?.lastName].filter(Boolean).join(" ") || undefined,
            metadata: { helmCustomerId: customerId, tenantId },
          },
          stripeOpts,
        );
        stripeCustomerId = sc.id;
        await prisma.customer.update({
          where: { id: customerId },
          data: { stripeCustomerId },
        });
      }

      const baseUrl = returnUrl ?? "https://portal.example.com/payments";
      const successUrl = `${baseUrl}?setup=success`;
      const cancelUrl = `${baseUrl}?setup=cancelled`;

      const paymentMethodTypes =
        type === "bank" ? ["us_bank_account"] : ["card"];

      const session = await stripe.checkout.sessions.create(
        {
          mode: "setup",
          customer: stripeCustomerId,
          payment_method_types: paymentMethodTypes as ("card" | "us_bank_account")[],
          success_url: successUrl,
          cancel_url: cancelUrl,
        },
        stripeOpts,
      );

      res.json({ url: session.url });
    } catch (err) {
      next(err);
    }
  },
);

// ---------------------------------------------------------------------------
// DELETE /api/portal/payment-methods/:id — detach a payment method
//
// Optional query param: ?invoiceId=<id>
// Use this when the payment method lives in a location-specific Stripe account.
// ---------------------------------------------------------------------------
router.delete(
  "/payment-methods/:id",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const customerId = req.portalCustomerId!;
      const tenantId = req.tenantId!;
      const pmId = req.params.id;
      const invoiceId = typeof req.query.invoiceId === "string" ? req.query.invoiceId : undefined;

      const customer = await prisma.customer.findUnique({
        where: { id: customerId },
        select: { stripeCustomerId: true },
      });
      if (!customer?.stripeCustomerId) {
        res.status(404).json({ error: "No Stripe customer found" });
        return;
      }

      let stripeAccountId: string | null;
      if (invoiceId) {
        const result = await getStripeAccountForInvoice(invoiceId, tenantId, customerId);
        if (result.invoiceNotFound) {
          res.status(404).json({ error: "Invoice not found", code: "NOT_FOUND" });
          return;
        }
        if (!result.locationConnected) {
          res.status(400).json({
            error: "Stripe payments are not yet configured for this location. Please contact the marina.",
            code: "LOCATION_STRIPE_NOT_CONFIGURED",
          });
          return;
        }
        stripeAccountId = result.stripeAccountId;
      } else {
        stripeAccountId = await getTenantStripeAccount(tenantId);
      }

      if (!stripeAccountId) {
        res.status(400).json({ error: "Stripe not configured" });
        return;
      }

      const stripe = requireStripe();
      const stripeOpts = { stripeAccount: stripeAccountId };

      // Verify the payment method belongs to this customer before detaching
      const pm = await stripe.paymentMethods.retrieve(pmId, {}, stripeOpts);
      if (pm.customer !== customer.stripeCustomerId) {
        res.status(403).json({ error: "Payment method does not belong to this customer" });
        return;
      }

      await stripe.paymentMethods.detach(pmId, {}, stripeOpts);
      res.json({ success: true });
    } catch (err) {
      next(err);
    }
  },
);

// ---------------------------------------------------------------------------
// PATCH /api/portal/payment-methods/:id/usable-in-pos
// Customer-facing toggle: opt this saved card in/out of being charged at the
// marina's POS counter. Cards only.
router.patch(
  "/payment-methods/:id/usable-in-pos",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const customerId = req.portalCustomerId!;
      const tenantId = req.tenantId!;
      const pmId = req.params.id;
      const { usableInPos } = req.body as { usableInPos?: boolean };
      if (typeof usableInPos !== "boolean") {
        res.status(400).json({ error: "usableInPos (boolean) is required", code: "VALIDATION" });
        return;
      }

      const customer = await prisma.customer.findUnique({
        where: { id: customerId },
        select: { stripeCustomerId: true },
      });
      if (!customer?.stripeCustomerId) {
        res.status(400).json({ error: "No saved payment methods", code: "NO_STRIPE_CUSTOMER" });
        return;
      }

      const stripeAccountId = await getTenantStripeAccount(tenantId);
      if (!stripeAccountId) {
        res.status(400).json({ error: "Stripe not configured", code: "STRIPE_NOT_CONFIGURED" });
        return;
      }

      const stripe = requireStripe();
      const stripeOpts = { stripeAccount: stripeAccountId };

      const pm = await stripe.paymentMethods.retrieve(pmId, {}, stripeOpts);
      if (pm.customer !== customer.stripeCustomerId) {
        res.status(403).json({ error: "Payment method does not belong to this customer", code: "FORBIDDEN" });
        return;
      }
      if (pm.type !== "card") {
        res.status(400).json({ error: "Only cards can be marked usable in POS", code: "PM_NOT_CARD" });
        return;
      }

      await stripe.paymentMethods.update(
        pmId,
        { metadata: { usableInPos: usableInPos ? "true" : "" } },
        stripeOpts,
      );

      res.json({ success: true, usableInPos });
    } catch (err) {
      next(err);
    }
  },
);

// PUT /api/portal/payment-methods/:id/default — set default payment method
//
// Optional query param: ?invoiceId=<id>
// Use this when the payment method lives in a location-specific Stripe account.
// ---------------------------------------------------------------------------
router.put(
  "/payment-methods/:id/default",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const customerId = req.portalCustomerId!;
      const tenantId = req.tenantId!;
      const pmId = req.params.id;
      const invoiceId = typeof req.query.invoiceId === "string" ? req.query.invoiceId : undefined;

      const customer = await prisma.customer.findUnique({
        where: { id: customerId },
        select: { stripeCustomerId: true },
      });
      if (!customer?.stripeCustomerId) {
        res.status(404).json({ error: "No Stripe customer found" });
        return;
      }

      let stripeAccountId: string | null;
      if (invoiceId) {
        const result = await getStripeAccountForInvoice(invoiceId, tenantId, customerId);
        if (result.invoiceNotFound) {
          res.status(404).json({ error: "Invoice not found", code: "NOT_FOUND" });
          return;
        }
        if (!result.locationConnected) {
          res.status(400).json({
            error: "Stripe payments are not yet configured for this location. Please contact the marina.",
            code: "LOCATION_STRIPE_NOT_CONFIGURED",
          });
          return;
        }
        stripeAccountId = result.stripeAccountId;
      } else {
        stripeAccountId = await getTenantStripeAccount(tenantId);
      }

      if (!stripeAccountId) {
        res.status(400).json({ error: "Stripe not configured" });
        return;
      }

      const stripe = requireStripe();
      const stripeOpts = { stripeAccount: stripeAccountId };

      await stripe.customers.update(
        customer.stripeCustomerId,
        { invoice_settings: { default_payment_method: pmId } },
        stripeOpts,
      );

      res.json({ success: true });
    } catch (err) {
      next(err);
    }
  },
);

// ---------------------------------------------------------------------------
// GET /api/portal/autopay — get autopay status
//
// Optional query param: ?invoiceId=<id>
// Scopes the lookup to the correct Stripe account for the invoice's location.
// ---------------------------------------------------------------------------
router.get(
  "/autopay",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const customerId = req.portalCustomerId!;
      const tenantId = req.tenantId!;
      const invoiceId = typeof req.query.invoiceId === "string" ? req.query.invoiceId : undefined;

      const customer = await prisma.customer.findUnique({
        where: { id: customerId },
        select: { stripeCustomerId: true },
      });

      if (!customer?.stripeCustomerId) {
        res.json({ autopay: false });
        return;
      }

      let stripeAccountId: string | null;
      if (invoiceId) {
        const result = await getStripeAccountForInvoice(invoiceId, tenantId, customerId);
        if (result.invoiceNotFound) {
          res.status(404).json({ error: "Invoice not found", code: "NOT_FOUND" });
          return;
        }
        if (!result.locationConnected) {
          res.json({ autopay: false });
          return;
        }
        stripeAccountId = result.stripeAccountId;
      } else {
        stripeAccountId = await getTenantStripeAccount(tenantId);
      }

      if (!stripeAccountId) {
        res.json({ autopay: false });
        return;
      }

      const stripe = requireStripe();
      const sc = await stripe.customers.retrieve(customer.stripeCustomerId, {}, {
        stripeAccount: stripeAccountId,
      }) as import("stripe").default.Customer;

      res.json({ autopay: sc.metadata?.autopay === "true" });
    } catch (err) {
      next(err);
    }
  },
);

// ---------------------------------------------------------------------------
// PUT /api/portal/autopay — toggle autopay on/off
//
// Optional body field: invoiceId
// Scopes the update to the correct Stripe account for the invoice's location.
// ---------------------------------------------------------------------------
router.put(
  "/autopay",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const customerId = req.portalCustomerId!;
      const tenantId = req.tenantId!;
      const { autopay, invoiceId } = req.body as { autopay: boolean; invoiceId?: string };

      const customer = await prisma.customer.findUnique({
        where: { id: customerId },
        select: { stripeCustomerId: true, email: true, firstName: true, lastName: true },
      });

      let stripeAccountId: string | null;
      if (invoiceId) {
        const result = await getStripeAccountForInvoice(invoiceId, tenantId, customerId);
        if (result.invoiceNotFound) {
          res.status(404).json({ error: "Invoice not found", code: "NOT_FOUND" });
          return;
        }
        if (!result.locationConnected) {
          res.status(400).json({
            error: "Stripe payments are not yet configured for this location. Please contact the marina.",
            code: "LOCATION_STRIPE_NOT_CONFIGURED",
          });
          return;
        }
        stripeAccountId = result.stripeAccountId;
      } else {
        stripeAccountId = await getTenantStripeAccount(tenantId);
      }

      if (!stripeAccountId) {
        res.status(400).json({ error: "Stripe not configured" });
        return;
      }

      const stripe = requireStripe();
      const stripeOpts = { stripeAccount: stripeAccountId };

      let stripeCustomerId = customer?.stripeCustomerId;
      if (!stripeCustomerId) {
        const sc = await stripe.customers.create(
          {
            email: customer?.email ?? undefined,
            name: [customer?.firstName, customer?.lastName].filter(Boolean).join(" ") || undefined,
            metadata: { helmCustomerId: customerId, tenantId, autopay: String(autopay) },
          },
          stripeOpts,
        );
        stripeCustomerId = sc.id;
        await prisma.customer.update({
          where: { id: customerId },
          data: { stripeCustomerId },
        });
      } else {
        // Block "turn ON" when the customer's default payment method is an
        // expired card — Stripe would decline the next off-session charge.
        // The portal UI also disables the toggle in this state; this is the
        // server-side belt to the UI suspenders. Disabling autopay is always
        // allowed so the customer can quiet warnings while fixing the card.
        if (autopay) {
          const [cards, stripeCustomer] = await Promise.all([
            stripe.paymentMethods.list(
              { customer: stripeCustomerId, type: "card" },
              stripeOpts,
            ),
            stripe.customers.retrieve(stripeCustomerId, {}, stripeOpts),
          ]);
          const sc = stripeCustomer as Stripe.Customer;
          const defaultPmId =
            (typeof sc.invoice_settings?.default_payment_method === "string"
              ? sc.invoice_settings.default_payment_method
              : null) ??
            (typeof sc.default_source === "string" ? sc.default_source : null);
          const defaultCard = defaultPmId
            ? cards.data.find((c) => c.id === defaultPmId)
            : null;
          if (defaultCard && isStripeCardExpired(defaultCard)) {
            res.status(400).json({
              error:
                "Your default card is expired. Choose a different default payment method or add a new card before enabling auto-pay.",
              code: "DEFAULT_CARD_EXPIRED",
            });
            return;
          }
        }
        await stripe.customers.update(
          stripeCustomerId,
          { metadata: { autopay: String(autopay) } },
          stripeOpts,
        );
      }

      res.json({ autopay });
    } catch (err) {
      next(err);
    }
  },
);

// ---------------------------------------------------------------------------
// GET /api/portal/insurance — list customer's insurance records
// ---------------------------------------------------------------------------
router.get(
  "/insurance",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const customerId = req.portalCustomerId!;
      const tenantId = req.tenantId!;

      const records = await prisma.insuranceRecord.findMany({
        where: { tenantId, customerId },
        include: {
          boat: { select: { id: true, name: true } },
        },
        orderBy: { startDate: "desc" },
      });

      // Also pull boats with upcoming expirations to surface alerts
      const boats = await prisma.boat.findMany({
        where: { tenantId, customerId },
        select: {
          id: true,
          name: true,
          registrationExpiry: true,
        },
      });

      res.json({ records, boats });
    } catch (err) {
      next(err);
    }
  },
);

// ---------------------------------------------------------------------------
// POST /api/portal/insurance — record a newly uploaded insurance document
// ---------------------------------------------------------------------------
router.post(
  "/insurance",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const customerId = req.portalCustomerId!;
      const tenantId = req.tenantId!;
      const {
        documentUrl,
        boatId,
        insurer,
        policyNumber,
        startDate,
        expiryDate,
      } = req.body as {
        documentUrl?: string;
        boatId?: string;
        insurer?: string;
        policyNumber?: string;
        startDate?: string;
        expiryDate?: string;
      };

      // If a boatId is provided, verify it belongs to this customer
      if (boatId) {
        const boat = await prisma.boat.findFirst({
          where: { id: boatId, tenantId, customerId },
          select: { id: true },
        });
        if (!boat) {
          res.status(400).json({ error: "Boat not found" });
          return;
        }
      }

      const record = await prisma.insuranceRecord.create({
        data: {
          tenantId,
          customerId,
          boatId: boatId ?? null,
          documentUrl: documentUrl ?? null,
          insurer: insurer ?? null,
          policyNumber: policyNumber ?? null,
          startDate: startDate ? new Date(startDate) : null,
          expiryDate: expiryDate ? new Date(expiryDate) : null,
          status: "PENDING_REVIEW",
        },
        include: { boat: { select: { id: true, name: true } } },
      });

      res.status(201).json(record);
    } catch (err) {
      next(err);
    }
  },
);

// ---------------------------------------------------------------------------
// GET /api/portal/announcements — tenant announcements visible to this customer
// ---------------------------------------------------------------------------
router.get(
  "/announcements",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const tenantId = req.tenantId!;
      const announcements = await prisma.announcement.findMany({
        where: { tenantId, sentAt: { not: null } },
        orderBy: { sentAt: "desc" },
        take: 50,
        select: {
          id: true,
          subject: true,
          body: true,
          isEmergency: true,
          channels: true,
          sentAt: true,
          deliveries: {
            where: { customerId: req.portalCustomerId! },
            select: { status: true, openedAt: true },
            take: 1,
          },
        },
      });

      const result = announcements.map((a) => {
        const delivery = a.deliveries[0];
        return {
          id: a.id,
          title: a.subject,
          body: a.body,
          date: a.sentAt!.toISOString().split("T")[0],
          category: a.isEmergency ? "Emergency" : "Operations",
          urgent: a.isEmergency,
          unread: !delivery || delivery.status === "PENDING",
        };
      });

      res.json(result);
    } catch (err) {
      next(err);
    }
  },
);

// ---------------------------------------------------------------------------
// GET /api/portal/concierge — customer's concierge requests
// ---------------------------------------------------------------------------
router.get(
  "/concierge",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const requests = await prisma.conciergeRequest.findMany({
        where: { customerId: req.portalCustomerId!, tenantId: req.tenantId! },
        orderBy: { createdAt: "desc" },
        take: 50,
      });
      res.json(requests);
    } catch (err) {
      next(err);
    }
  },
);

// ---------------------------------------------------------------------------
// POST /api/portal/concierge — submit a new concierge request
// ---------------------------------------------------------------------------
router.post(
  "/concierge",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { serviceType, preferredDate, notes } = req.body as {
        serviceType?: string;
        preferredDate?: string;
        notes?: string;
      };
      if (!serviceType) {
        res.status(400).json({ error: "serviceType is required" });
        return;
      }
      const request = await prisma.conciergeRequest.create({
        data: {
          tenantId: req.tenantId!,
          customerId: req.portalCustomerId!,
          serviceType,
          preferredDate: preferredDate ? new Date(preferredDate) : null,
          notes: notes ?? null,
          status: "SUBMITTED",
        },
      });
      res.status(201).json(request);
    } catch (err) {
      next(err);
    }
  },
);

// ---------------------------------------------------------------------------
// GET /api/portal/waitlist — customer's waitlist entries
// ---------------------------------------------------------------------------
router.get(
  "/waitlist",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const entries = await prisma.waitlistEntry.findMany({
        where: { customerId: req.portalCustomerId!, tenantId: req.tenantId! },
        orderBy: { createdAt: "asc" },
      });
      res.json(entries);
    } catch (err) {
      next(err);
    }
  },
);

// ---------------------------------------------------------------------------
// GET /api/portal/messages — thread for this customer
// POST /api/portal/messages — send a new message
// ---------------------------------------------------------------------------
router.get(
  "/messages",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const messages = await prisma.portalMessage.findMany({
        where: { customerId: req.portalCustomerId!, tenantId: req.tenantId! },
        orderBy: { createdAt: "asc" },
      });
      // Mark unread customer-visible messages as read
      await prisma.portalMessage.updateMany({
        where: {
          customerId: req.portalCustomerId!,
          tenantId: req.tenantId!,
          sender: "staff",
          read: false,
        },
        data: { read: true },
      });
      res.json(messages);
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  "/messages",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { content } = req.body as { content?: string };
      if (!content || !content.trim()) {
        res.status(400).json({ error: "content is required" });
        return;
      }
      const message = await prisma.portalMessage.create({
        data: {
          tenantId: req.tenantId!,
          customerId: req.portalCustomerId!,
          sender: "customer",
          content: content.trim(),
          read: false,
        },
      });
      res.status(201).json(message);
    } catch (err) {
      next(err);
    }
  },
);

export default router;

