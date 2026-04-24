import { Router, type Request, type Response, type NextFunction } from "express";
import { z } from "zod";
import { clerkAuth } from "../middleware/auth.js";
import { appError } from "../middleware/error.js";
import { prisma } from "../lib/prisma.js";
import { requireStripe } from "../lib/stripe.js";

const router = Router();

router.use(...clerkAuth());

// ---------------------------------------------------------------------------
// GET /api/chargebacks — list disputes (most recent first)
// ---------------------------------------------------------------------------

router.get("/", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = req.tenantId!;
    const rows = await prisma.chargeback.findMany({
      where: { tenantId },
      include: {
        customer: {
          select: { id: true, firstName: true, lastName: true, company: true, email: true },
        },
      },
      orderBy: { stripeDisputeId: "desc" },
    });
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// GET /api/chargebacks/:id — detail (pulls the live Stripe dispute too)
// ---------------------------------------------------------------------------

router.get("/:id", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = req.tenantId!;
    const row = await prisma.chargeback.findFirst({
      where: { id: String(req.params.id), tenantId },
      include: {
        customer: {
          select: { id: true, firstName: true, lastName: true, company: true, email: true },
        },
      },
    });
    if (!row) throw appError("Chargeback not found", 404, "NOT_FOUND");

    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { stripeAccountId: true },
    });

    let stripeDispute: unknown = null;
    if (tenant?.stripeAccountId) {
      try {
        stripeDispute = await requireStripe().disputes.retrieve(
          row.stripeDisputeId,
          undefined,
          { stripeAccount: tenant.stripeAccountId },
        );
      } catch (err) {
        // Non-fatal — surface what we have in our DB.
        console.warn(`[chargebacks] retrieve ${row.stripeDisputeId} failed:`, err);
      }
    }

    res.json({ ...row, stripeDispute });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// POST /api/chargebacks/:id/evidence — submit evidence to Stripe
//
// Accepts a subset of Stripe's evidence fields for a text-based response.
// File uploads go via stripe.files.create first; that flow isn't wired here
// yet — for MVP we stick to text fields + pre-uploaded file IDs.
// ---------------------------------------------------------------------------

const EvidenceSchema = z.object({
  productDescription: z.string().max(20_000).optional(),
  customerName: z.string().max(1_000).optional(),
  customerEmailAddress: z.string().email().optional(),
  customerPurchaseIp: z.string().max(64).optional(),
  customerSignature: z.string().max(20_000).optional(),
  billingAddress: z.string().max(1_000).optional(),
  serviceDate: z.string().max(100).optional(),
  serviceDocumentation: z.string().max(5_000).optional(),
  uncategorizedText: z.string().max(20_000).optional(),
  // Pre-uploaded Stripe file IDs (file_…) the caller obtained separately.
  receiptFileId: z.string().startsWith("file_").optional(),
  customerCommunicationFileId: z.string().startsWith("file_").optional(),
  serviceDocumentationFileId: z.string().startsWith("file_").optional(),
});

router.post(
  "/:id/evidence",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const tenantId = req.tenantId!;
      const id = String(req.params.id);
      const row = await prisma.chargeback.findFirst({
        where: { id, tenantId },
      });
      if (!row) throw appError("Chargeback not found", 404, "NOT_FOUND");

      const tenant = await prisma.tenant.findUnique({
        where: { id: tenantId },
        select: { stripeAccountId: true },
      });
      if (!tenant?.stripeAccountId) {
        throw appError(
          "Stripe is not connected for this marina",
          400,
          "STRIPE_NOT_CONFIGURED",
        );
      }

      const body = EvidenceSchema.parse(req.body);

      await requireStripe().disputes.update(
        row.stripeDisputeId,
        {
          evidence: {
            product_description: body.productDescription,
            customer_name: body.customerName,
            customer_email_address: body.customerEmailAddress,
            customer_purchase_ip: body.customerPurchaseIp,
            customer_signature: body.customerSignature,
            billing_address: body.billingAddress,
            service_date: body.serviceDate,
            service_documentation: body.serviceDocumentationFileId,
            uncategorized_text: body.uncategorizedText,
            receipt: body.receiptFileId,
            customer_communication: body.customerCommunicationFileId,
          },
          submit: true,
        },
        { stripeAccount: tenant.stripeAccountId },
      );

      const updated = await prisma.chargeback.update({
        where: { id },
        data: {
          evidenceSubmittedAt: new Date(),
          status: "EVIDENCE_SUBMITTED",
        },
      });

      await prisma.auditLog.create({
        data: {
          tenantId,
          userId: req.userId,
          recordType: "Chargeback",
          recordId: id,
          action: "DISPUTE_EVIDENCE_SUBMITTED",
          changedFieldsJson: {
            stripeDisputeId: row.stripeDisputeId,
            fields: Object.keys(body),
          },
        },
      });

      res.json(updated);
    } catch (err) {
      next(err);
    }
  },
);

export default router;
