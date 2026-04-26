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
// Helper — resolve tenant Stripe account ID
// ---------------------------------------------------------------------------
async function getTenantStripeAccount(tenantId: string): Promise<string | null> {
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { stripeAccountId: true },
  });
  return tenant?.stripeAccountId ?? null;
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
// ---------------------------------------------------------------------------
router.get(
  "/payment-methods",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const customerId = req.portalCustomerId!;
      const tenantId = req.tenantId!;

      const customer = await prisma.customer.findUnique({
        where: { id: customerId },
        select: { stripeCustomerId: true },
      });

      if (!customer?.stripeCustomerId) {
        res.json({ methods: [], autopay: false, defaultMethodId: null });
        return;
      }

      const stripeAccountId = await getTenantStripeAccount(tenantId);
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
        stripe.customers.retrieve(customer.stripeCustomerId, stripeOpts),
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
// ---------------------------------------------------------------------------
router.post(
  "/payment-methods/setup-session",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const customerId = req.portalCustomerId!;
      const tenantId = req.tenantId!;
      const { returnUrl, type = "card" } = req.body as {
        returnUrl?: string;
        type?: "card" | "bank";
      };

      const customer = await prisma.customer.findUnique({
        where: { id: customerId },
        select: { stripeCustomerId: true, email: true, firstName: true, lastName: true },
      });

      const stripeAccountId = await getTenantStripeAccount(tenantId);
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
// ---------------------------------------------------------------------------
router.delete(
  "/payment-methods/:id",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const customerId = req.portalCustomerId!;
      const tenantId = req.tenantId!;
      const pmId = req.params.id;

      const customer = await prisma.customer.findUnique({
        where: { id: customerId },
        select: { stripeCustomerId: true },
      });
      if (!customer?.stripeCustomerId) {
        res.status(404).json({ error: "No Stripe customer found" });
        return;
      }

      const stripeAccountId = await getTenantStripeAccount(tenantId);
      if (!stripeAccountId) {
        res.status(400).json({ error: "Stripe not configured" });
        return;
      }

      const stripe = requireStripe();
      const stripeOpts = { stripeAccount: stripeAccountId };

      // Verify the payment method belongs to this customer before detaching
      const pm = await stripe.paymentMethods.retrieve(pmId, stripeOpts);
      if (pm.customer !== customer.stripeCustomerId) {
        res.status(403).json({ error: "Payment method does not belong to this customer" });
        return;
      }

      await stripe.paymentMethods.detach(pmId, stripeOpts);
      res.json({ success: true });
    } catch (err) {
      next(err);
    }
  },
);

// ---------------------------------------------------------------------------
// PUT /api/portal/payment-methods/:id/default — set default payment method
// ---------------------------------------------------------------------------
router.put(
  "/payment-methods/:id/default",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const customerId = req.portalCustomerId!;
      const tenantId = req.tenantId!;
      const pmId = req.params.id;

      const customer = await prisma.customer.findUnique({
        where: { id: customerId },
        select: { stripeCustomerId: true },
      });
      if (!customer?.stripeCustomerId) {
        res.status(404).json({ error: "No Stripe customer found" });
        return;
      }

      const stripeAccountId = await getTenantStripeAccount(tenantId);
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
// ---------------------------------------------------------------------------
router.get(
  "/autopay",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const customerId = req.portalCustomerId!;
      const tenantId = req.tenantId!;

      const customer = await prisma.customer.findUnique({
        where: { id: customerId },
        select: { stripeCustomerId: true },
      });

      if (!customer?.stripeCustomerId) {
        res.json({ autopay: false });
        return;
      }

      const stripeAccountId = await getTenantStripeAccount(tenantId);
      if (!stripeAccountId) {
        res.json({ autopay: false });
        return;
      }

      const stripe = requireStripe();
      const sc = await stripe.customers.retrieve(customer.stripeCustomerId, {
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
// ---------------------------------------------------------------------------
router.put(
  "/autopay",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const customerId = req.portalCustomerId!;
      const tenantId = req.tenantId!;
      const { autopay } = req.body as { autopay: boolean };

      const customer = await prisma.customer.findUnique({
        where: { id: customerId },
        select: { stripeCustomerId: true, email: true, firstName: true, lastName: true },
      });

      const stripeAccountId = await getTenantStripeAccount(tenantId);
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

export default router;
