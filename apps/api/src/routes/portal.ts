import { Router, type Request, type Response, type NextFunction } from "express";
import { clerkAuth } from "../middleware/auth.js";
import { prisma } from "../lib/prisma.js";
import { requireStripe } from "../lib/stripe.js";

const router: Router = Router();

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

