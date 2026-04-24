import { Router, type Request, type Response, type NextFunction } from "express";
import { clerkAuth } from "../middleware/auth.js";
import { prisma } from "../lib/prisma.js";

const router = Router();

router.use(...clerkAuth());

// ---------------------------------------------------------------------------
// Portal customer resolver
//
// Portal users are linked to a Customer by matching the authenticated user's
// email against customer.email within the same tenant. This is good enough
// for MVP — a proper User.customerId FK is on the schema-change shortlist.
// If no match, every downstream route 403s so portal tokens can't leak data
// from customers the user isn't associated with.
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

export default router;
