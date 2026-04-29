import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { verifyImpersonationToken } from "../lib/impersonation-token.js";

const router: Router = Router();

// --------------------------------------------------------------------------
// POST /api/impersonation/verify
// Public endpoint: tenant-facing apps call this with the URL-fragment token
// they receive from the admin "Log in as Tenant" handoff. We validate the
// HMAC, ensure it has not expired, log a VERIFIED event tied to the token
// id (proving the handoff completed), and return the safe-to-render context.
// --------------------------------------------------------------------------
router.post("/verify", async (req, res, next) => {
  try {
    const { token } = req.body ?? {};
    const result = verifyImpersonationToken(token);
    if (!result.ok) {
      res.status(401).json({ error: `impersonation token ${result.reason}` });
      return;
    }
    const p = result.payload;

    try {
      await prisma.adminAuditEvent.create({
        data: {
          tenantId: p.tenantId,
          adminUserId: p.impersonatedBy,
          adminEmail: p.adminEmail,
          action: "IMPERSONATION_VERIFIED",
          ipAddress: req.ip ?? null,
          metadataJson: {
            tokenId: p.jti,
            asUserId: p.sub,
            asUserEmail: p.email,
            userAgent: req.get("user-agent") ?? null,
          } as never,
        },
      });
    } catch {
      /* audit failure must not block the handoff */
    }

    res.json({
      tokenId: p.jti,
      tenantId: p.tenantId,
      tenantName: p.tenantName,
      tenantSubdomain: p.tenantSubdomain,
      asUser: { id: p.sub, email: p.email, role: p.role },
      adminEmail: p.adminEmail,
      expiresAt: new Date(p.exp * 1000).toISOString(),
    });
  } catch (err) {
    next(err);
  }
});

// --------------------------------------------------------------------------
// POST /api/impersonation/end
// Public endpoint: banner "Exit" button calls this with the same token to
// record an IMPERSONATION_ENDED event in the audit trail.
// --------------------------------------------------------------------------
router.post("/end", async (req, res, next) => {
  try {
    const { token } = req.body ?? {};
    const result = verifyImpersonationToken(token);
    if (!result.ok) {
      // Even if expired, allow ending; only reject malformed/bad signature.
      if (result.reason !== "expired") {
        res.status(401).json({ error: `impersonation token ${result.reason}` });
        return;
      }
    }
    const p = result.ok ? result.payload : null;
    if (p) {
      try {
        await prisma.adminAuditEvent.create({
          data: {
            tenantId: p.tenantId,
            adminUserId: p.impersonatedBy,
            adminEmail: p.adminEmail,
            action: "IMPERSONATION_ENDED",
            ipAddress: req.ip ?? null,
            metadataJson: { tokenId: p.jti, asUserId: p.sub } as never,
          },
        });
      } catch { /* noop */ }
    }
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

export default router;
