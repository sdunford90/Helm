import { Router, type Request, type Response, type NextFunction } from "express";
import { z } from "zod";
import { clerkAuth } from "../middleware/auth.js";
import { prisma, tenantStore } from "../lib/prisma.js";

const router: Router = Router();

// ─── Zod Schemas ─────────────────────────────────────────────────────────────

const FormTypeEnum = z.enum([
  "slip_inquiry",
  "rental_inquiry",
  "waitlist_signup",
  "general_contact",
]);

const CreateFormSchema = z.object({
  formType: FormTypeEnum,
  name: z.string().min(1),
  fieldsJson: z.record(z.unknown()),
  locationId: z.string().uuid().optional().nullable(),
});

const UpdateFormSchema = z.object({
  name: z.string().min(1).optional(),
  formType: FormTypeEnum.optional(),
  fieldsJson: z.record(z.unknown()).optional(),
  active: z.boolean().optional(),
  locationId: z.string().uuid().optional().nullable(),
});

const FormSubmissionSchema = z.object({
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  email: z.string().email().optional(),
  phone: z.string().optional(),
  boatLength: z.number().positive().optional(),
  slipType: z.string().optional(),
  notes: z.string().optional(),
  // Source attribution
  sourceUrl: z.string().optional(),
  utmSource: z.string().optional(),
  utmMedium: z.string().optional(),
  referralCode: z.string().optional(),
  // reCAPTCHA token
  recaptchaToken: z.string().optional(),
  // Additional custom field data
  customFields: z.record(z.unknown()).optional(),
});

// ─── Helpers ────────────────────────────────────────────────────────────────

function appError(message: string, statusCode: number, code: string): Error {
  const err = new Error(message) as Error & {
    statusCode: number;
    code: string;
  };
  err.statusCode = statusCode;
  err.code = code;
  return err;
}

/**
 * Lightweight reCAPTCHA verification.
 * In production this calls Google's siteverify API; here we accept the token if
 * the env var RECAPTCHA_SECRET_KEY is set and the token is non-empty.
 * If RECAPTCHA_SECRET_KEY is not configured we skip validation.
 */
async function verifyRecaptcha(token: string | undefined): Promise<boolean> {
  const secret = process.env.RECAPTCHA_SECRET_KEY;
  if (!secret) return true; // reCAPTCHA not configured — allow

  if (!token) return false;

  try {
    const response = await fetch(
      "https://www.google.com/recaptcha/api/siteverify",
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: `secret=${encodeURIComponent(secret)}&response=${encodeURIComponent(token)}`,
      },
    );
    const data = (await response.json()) as { success: boolean };
    return data.success === true;
  } catch {
    return false;
  }
}

// ─── Authenticated routes ───────────────────────────────────────────────────

// All management endpoints require auth
const authedRouter = Router();
authedRouter.use(...clerkAuth());

// ─── GET / — List forms ─────────────────────────────────────────────────────

authedRouter.get(
  "/",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId = req.tenantId!;

      const forms = await prisma.leadForm.findMany({
        where: { tenantId },
        orderBy: { name: "asc" },
      });

      res.json({ data: forms });
    } catch (err) {
      next(err);
    }
  },
);

// ─── GET /:id — Get form config ─────────────────────────────────────────────

authedRouter.get(
  "/:id",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId = req.tenantId!;

      const form = await prisma.leadForm.findFirst({
        where: { id: req.params.id, tenantId },
      });

      if (!form) {
        throw appError("Lead form not found", 404, "NOT_FOUND");
      }

      res.json(form);
    } catch (err) {
      next(err);
    }
  },
);

// ─── POST / — Create form ──────────────────────────────────────────────────

authedRouter.post(
  "/",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId = req.tenantId!;
      const data = CreateFormSchema.parse(req.body);

      const form = await prisma.leadForm.create({
        data: {
          tenantId,
          formType: data.formType,
          name: data.name,
          fieldsJson: data.fieldsJson,
          locationId: data.locationId ?? undefined,
        },
      });

      res.status(201).json(form);
    } catch (err) {
      next(err);
    }
  },
);

// ─── PUT /:id — Update form ────────────────────────────────────────────────

authedRouter.put(
  "/:id",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId = req.tenantId!;
      const data = UpdateFormSchema.parse(req.body);

      const existing = await prisma.leadForm.findFirst({
        where: { id: req.params.id, tenantId },
      });
      if (!existing) {
        throw appError("Lead form not found", 404, "NOT_FOUND");
      }

      const updated = await prisma.leadForm.update({
        where: { id: req.params.id },
        data,
      });

      res.json(updated);
    } catch (err) {
      next(err);
    }
  },
);

// ─── DELETE /:id — Deactivate form ──────────────────────────────────────────

authedRouter.delete(
  "/:id",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId = req.tenantId!;

      const existing = await prisma.leadForm.findFirst({
        where: { id: req.params.id, tenantId },
      });
      if (!existing) {
        throw appError("Lead form not found", 404, "NOT_FOUND");
      }

      const deactivated = await prisma.leadForm.update({
        where: { id: req.params.id },
        data: { active: false },
      });

      res.json(deactivated);
    } catch (err) {
      next(err);
    }
  },
);

// Mount authed routes
router.use("/", authedRouter);

// ─── PUBLIC route: form submission ──────────────────────────────────────────
// POST /:embedKey/submit — no auth required; identified by embed key

router.post(
  "/:embedKey/submit",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const body = FormSubmissionSchema.parse(req.body);

      // Verify reCAPTCHA
      const captchaValid = await verifyRecaptcha(body.recaptchaToken);
      if (!captchaValid) {
        throw appError("reCAPTCHA verification failed", 400, "CAPTCHA_FAILED");
      }

      // Look up form by embed key (not tenant-scoped — the embed key is globally unique)
      const form = await prisma.leadForm.findUnique({
        where: { embedKey: req.params.embedKey },
      });

      if (!form) {
        throw appError("Form not found", 404, "NOT_FOUND");
      }

      if (!form.active) {
        throw appError("This form is no longer accepting submissions", 400, "FORM_INACTIVE");
      }

      // Create lead scoped to the form's tenant. We need to use tenantStore
      // because the public endpoint may not have gone through tenant middleware
      // with the correct tenant (the embed could be on a third-party site).
      const lead = await new Promise<Record<string, unknown>>((resolve, reject) => {
        tenantStore.run({ tenantId: form.tenantId }, async () => {
          try {
            const created = await prisma.lead.create({
              data: {
                tenantId: form.tenantId,
                locationId: form.locationId,
                firstName: body.firstName,
                lastName: body.lastName,
                email: body.email,
                phone: body.phone,
                boatLength: body.boatLength,
                slipType: body.slipType,
                notes: body.notes
                  ? body.customFields
                    ? `${body.notes}\n\nCustom fields: ${JSON.stringify(body.customFields)}`
                    : body.notes
                  : body.customFields
                    ? `Custom fields: ${JSON.stringify(body.customFields)}`
                    : undefined,
                sourceFormId: form.id,
                sourceUrl: body.sourceUrl,
                utmSource: body.utmSource,
                utmMedium: body.utmMedium,
                referralCode: body.referralCode,
                stage: "NEW",
              },
            });
            resolve(created as unknown as Record<string, unknown>);
          } catch (err) {
            reject(err);
          }
        });
      });

      // Update referral partner stats if referralCode was provided
      if (body.referralCode) {
        try {
          await prisma.referralPartner.updateMany({
            where: { code: body.referralCode },
            data: { leadsCount: { increment: 1 } },
          });
        } catch {
          // Non-critical — don't fail the submission
        }
      }

      res.status(201).json({
        success: true,
        message: "Your inquiry has been submitted successfully.",
        leadId: (lead as Record<string, unknown>).id,
      });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
