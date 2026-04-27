import { Router, type IRouter, type Request, type Response } from "express";
import { clerkAuth } from "../middleware/auth.js";
import { prisma } from "../lib/prisma.js";

const router: IRouter = Router();
router.use(...clerkAuth());

// ── Permission module definitions (canonical list) ───────────────────────────
export const PERMISSION_MODULES = [
  { key: "dashboard",     label: "Dashboard",              group: "Overview" },
  { key: "slips",         label: "Slip Management",        group: "Operations" },
  { key: "contracts",     label: "Contracts",              group: "Operations" },
  { key: "transient",     label: "Transient Bookings",     group: "Operations" },
  { key: "customers",     label: "Customers",              group: "Operations" },
  { key: "work_orders",   label: "Work Orders",            group: "Operations" },
  { key: "waitlist",      label: "Waitlist",               group: "Operations" },
  { key: "concierge",     label: "Concierge Requests",     group: "Operations" },
  { key: "invoices",      label: "Invoices",               group: "Finance" },
  { key: "payments",      label: "Payments",               group: "Finance" },
  { key: "reports",       label: "Reports & Analytics",    group: "Finance" },
  { key: "billing",       label: "Billing & Subscription", group: "Finance" },
  { key: "gl_accounts",   label: "GL / Chart of Accounts", group: "Finance" },
  { key: "rentals",       label: "Rentals",                group: "Revenue" },
  { key: "pos",           label: "Point of Sale",          group: "Revenue" },
  { key: "inventory",     label: "Inventory",              group: "Revenue" },
  { key: "announcements", label: "Announcements",          group: "Communication" },
  { key: "team",          label: "Team & Roles",           group: "Admin" },
  { key: "settings",      label: "Settings",               group: "Admin" },
  { key: "integrations",  label: "Integrations",           group: "Admin" },
] as const;

type ModuleKey = (typeof PERMISSION_MODULES)[number]["key"];

// Built-in role permission templates (used when seeding system roles)
const SYSTEM_ROLE_TEMPLATES: Record<string, Partial<Record<ModuleKey, { view: boolean; create: boolean; edit: boolean; delete: boolean }>>> = {
  "Tenant Admin": Object.fromEntries(
    PERMISSION_MODULES.map((m) => [m.key, { view: true, create: true, edit: true, delete: true }])
  ) as Partial<Record<ModuleKey, { view: boolean; create: boolean; edit: boolean; delete: boolean }>>,

  "Marina Admin": Object.fromEntries(
    PERMISSION_MODULES.map((m) => [
      m.key,
      m.key === "billing" || m.key === "integrations"
        ? { view: true, create: false, edit: false, delete: false }
        : { view: true, create: true, edit: true, delete: true },
    ])
  ) as Partial<Record<ModuleKey, { view: boolean; create: boolean; edit: boolean; delete: boolean }>>,

  "Marina Manager": {
    dashboard:     { view: true,  create: false, edit: false, delete: false },
    slips:         { view: true,  create: true,  edit: true,  delete: false },
    contracts:     { view: true,  create: true,  edit: true,  delete: false },
    transient:     { view: true,  create: true,  edit: true,  delete: false },
    customers:     { view: true,  create: true,  edit: true,  delete: false },
    work_orders:   { view: true,  create: true,  edit: true,  delete: false },
    waitlist:      { view: true,  create: true,  edit: true,  delete: false },
    concierge:     { view: true,  create: true,  edit: true,  delete: false },
    invoices:      { view: true,  create: true,  edit: true,  delete: false },
    payments:      { view: true,  create: true,  edit: false, delete: false },
    reports:       { view: true,  create: false, edit: false, delete: false },
    billing:       { view: true,  create: false, edit: false, delete: false },
    gl_accounts:   { view: true,  create: false, edit: false, delete: false },
    rentals:       { view: true,  create: true,  edit: true,  delete: false },
    pos:           { view: true,  create: true,  edit: true,  delete: false },
    inventory:     { view: true,  create: true,  edit: true,  delete: false },
    announcements: { view: true,  create: true,  edit: true,  delete: false },
    team:          { view: true,  create: false, edit: false, delete: false },
    settings:      { view: true,  create: false, edit: false, delete: false },
    integrations:  { view: false, create: false, edit: false, delete: false },
  },

  "Dock Staff": {
    dashboard:   { view: true,  create: false, edit: false, delete: false },
    slips:       { view: true,  create: false, edit: true,  delete: false },
    work_orders: { view: true,  create: true,  edit: true,  delete: false },
    transient:   { view: true,  create: true,  edit: false, delete: false },
    customers:   { view: true,  create: false, edit: false, delete: false },
    waitlist:    { view: true,  create: false, edit: false, delete: false },
    concierge:   { view: true,  create: false, edit: true,  delete: false },
  },

  "POS Cashier": {
    dashboard: { view: true,  create: false, edit: false, delete: false },
    pos:       { view: true,  create: true,  edit: false, delete: false },
    customers: { view: true,  create: false, edit: false, delete: false },
    inventory: { view: true,  create: false, edit: false, delete: false },
  },

  "Accounting": {
    dashboard:   { view: true,  create: false, edit: false, delete: false },
    invoices:    { view: true,  create: true,  edit: true,  delete: false },
    payments:    { view: true,  create: true,  edit: false, delete: false },
    reports:     { view: true,  create: false, edit: false, delete: false },
    gl_accounts: { view: true,  create: true,  edit: true,  delete: false },
    billing:     { view: true,  create: false, edit: false, delete: false },
    customers:   { view: true,  create: false, edit: false, delete: false },
  },
};

const SYSTEM_ROLE_COLORS: Record<string, string> = {
  "Tenant Admin":    "#7C3AED",
  "Marina Admin":    "#0A2342",
  "Marina Manager":  "#0369A1",
  "Dock Staff":      "#065F46",
  "POS Cashier":     "#92400E",
  "Accounting":      "#1E40AF",
};

// ── List roles ────────────────────────────────────────────────────────────────
router.get("/", async (req: Request, res: Response) => {
  const tenantId = req.tenantId;
  if (!tenantId) return res.status(401).json({ error: "Unauthorized" });

  const roles = await prisma.customRole.findMany({
    where: { tenantId },
    orderBy: [{ isSystem: "desc" }, { name: "asc" }],
    include: { permissions: true, _count: { select: { users: true } } },
  });

  res.json({ data: roles });
});

// ── Get available modules (for UI) ────────────────────────────────────────────
router.get("/modules", (_req: Request, res: Response) => {
  res.json({ data: PERMISSION_MODULES });
});

// ── Seed built-in system roles for a tenant ──────────────────────────────────
router.post("/seed", async (req: Request, res: Response) => {
  const tenantId = req.tenantId;
  if (!tenantId) return res.status(401).json({ error: "Unauthorized" });

  const created: string[] = [];

  for (const [name, perms] of Object.entries(SYSTEM_ROLE_TEMPLATES)) {
    const existing = await prisma.customRole.findFirst({ where: { tenantId, name } });
    if (existing) continue;

    const role = await prisma.customRole.create({
      data: {
        tenantId,
        name,
        color: SYSTEM_ROLE_COLORS[name] ?? "#64748B",
        isSystem: true,
        permissions: {
          create: Object.entries(perms).map(([module, p]) => ({
            module,
            canView:   p.view,
            canCreate: p.create,
            canEdit:   p.edit,
            canDelete: p.delete,
          })),
        },
      },
    });
    created.push(role.name);
  }

  res.json({ seeded: created });
});

// ── Create custom role ────────────────────────────────────────────────────────
router.post("/", async (req: Request, res: Response) => {
  const tenantId = req.tenantId;
  if (!tenantId) return res.status(401).json({ error: "Unauthorized" });

  const { name, description, color } = req.body as {
    name: string;
    description?: string;
    color?: string;
  };

  if (!name?.trim()) return res.status(400).json({ error: "Name is required" });

  const role = await prisma.customRole.create({
    data: {
      tenantId,
      name: name.trim(),
      description: description?.trim() ?? null,
      color: color ?? "#64748B",
      isSystem: false,
      permissions: {
        create: PERMISSION_MODULES.map((m) => ({
          module: m.key,
          canView: false, canCreate: false, canEdit: false, canDelete: false,
        })),
      },
    },
    include: { permissions: true },
  });

  res.status(201).json(role);
});

// ── Update role metadata ──────────────────────────────────────────────────────
router.patch("/:id", async (req: Request, res: Response) => {
  const tenantId = req.tenantId;
  if (!tenantId) return res.status(401).json({ error: "Unauthorized" });

  const existing = await prisma.customRole.findFirst({
    where: { id: req.params.id, tenantId },
  });
  if (!existing) return res.status(404).json({ error: "Role not found" });

  const { name, description, color } = req.body as {
    name?: string;
    description?: string;
    color?: string;
  };

  const updated = await prisma.customRole.update({
    where: { id: req.params.id },
    data: {
      ...(name && { name: name.trim() }),
      ...(description !== undefined && { description: description?.trim() ?? null }),
      ...(color && { color }),
    },
    include: { permissions: true },
  });

  res.json(updated);
});

// ── Upsert a single module permission ────────────────────────────────────────
router.put("/:id/permissions/:module", async (req: Request, res: Response) => {
  const tenantId = req.tenantId;
  if (!tenantId) return res.status(401).json({ error: "Unauthorized" });

  const existing = await prisma.customRole.findFirst({
    where: { id: req.params.id, tenantId },
  });
  if (!existing) return res.status(404).json({ error: "Role not found" });

  const { canView, canCreate, canEdit, canDelete } = req.body as {
    canView?: boolean;
    canCreate?: boolean;
    canEdit?: boolean;
    canDelete?: boolean;
  };

  const perm = await prisma.rolePermission.upsert({
    where: { roleId_module: { roleId: req.params.id, module: req.params.module } },
    create: {
      roleId: req.params.id,
      module: req.params.module,
      canView: canView ?? false,
      canCreate: canCreate ?? false,
      canEdit: canEdit ?? false,
      canDelete: canDelete ?? false,
    },
    update: {
      ...(canView !== undefined && { canView }),
      ...(canCreate !== undefined && { canCreate }),
      ...(canEdit !== undefined && { canEdit }),
      ...(canDelete !== undefined && { canDelete }),
    },
  });

  res.json(perm);
});

// ── Delete a custom role (not system roles) ────────────────────────────────────
router.delete("/:id", async (req: Request, res: Response) => {
  const tenantId = req.tenantId;
  if (!tenantId) return res.status(401).json({ error: "Unauthorized" });

  const existing = await prisma.customRole.findFirst({
    where: { id: req.params.id, tenantId },
    include: { _count: { select: { users: true } } },
  });
  if (!existing) return res.status(404).json({ error: "Role not found" });
  if (existing.isSystem) return res.status(400).json({ error: "Cannot delete a built-in system role" });
  if (existing._count.users > 0) {
    return res.status(400).json({
      error: `Cannot delete: ${existing._count.users} user(s) are assigned this role. Reassign them first.`,
    });
  }

  await prisma.customRole.delete({ where: { id: req.params.id } });
  res.json({ deleted: true });
});

export default router;
