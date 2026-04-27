import { Router, type Request, type Response, type NextFunction } from "express";
import { z } from "zod";
import { clerkAuth, requireRole } from "../middleware/auth.js";
import { prisma } from "../lib/prisma.js";

const router: Router = Router();

router.use(...clerkAuth());

// ─── Zod Schemas ──────────────────────────────────────────────────────────────

const FuelTypeEnum = z.enum(["REGULAR", "PREMIUM", "DIESEL"]);

const UpdatePriceSchema = z.object({
  priceCentsPerGallon: z.number().int().min(0),
  costCentsPerGallon: z.number().int().min(0).optional(),
});

const RecordSaleSchema = z.object({
  customerId: z.string().uuid().optional().nullable(),
  guestName: z.string().optional().nullable(),
  fuelType: FuelTypeEnum,
  gallons: z.number().positive(),
  pumpNumber: z.number().int().optional(),
  staffId: z.string().uuid().optional(),
  paymentMethod: z.enum(["CARD", "CASH", "CHARGE_TO_SLIP"]).optional(),
});

const LogDeliverySchema = z.object({
  supplier: z.string().min(1),
  fuelType: FuelTypeEnum,
  gallons: z.number().positive(),
  costCentsPerGallon: z.number().int().min(0),
  tankLevelAfterGallons: z.number().optional(),
  notes: z.string().optional(),
});

const ListQuerySchema = z.object({
  take: z.coerce.number().int().positive().max(200).default(50),
  skip: z.coerce.number().int().min(0).default(0),
});

// ─── In-memory fuel config (prices/tank levels remain in-memory per task scope) ─

interface FuelTypeConfig {
  id: string;
  type: string;
  priceCentsPerGallon: number;
  costCentsPerGallon: number;
  tankCapacityGallons: number;
  currentLevelGallons: number;
}

const FUEL_TYPES: FuelTypeConfig[] = [
  { id: "fuel-reg", type: "REGULAR", priceCentsPerGallon: 429, costCentsPerGallon: 365, tankCapacityGallons: 5000, currentLevelGallons: 2400 },
  { id: "fuel-prem", type: "PREMIUM", priceCentsPerGallon: 479, costCentsPerGallon: 408, tankCapacityGallons: 3000, currentLevelGallons: 1800 },
  { id: "fuel-dsl", type: "DIESEL", priceCentsPerGallon: 489, costCentsPerGallon: 410, tankCapacityGallons: 4000, currentLevelGallons: 2200 },
];

// ─── GET /fuel/types ──────────────────────────────────────────────────────────

router.get("/types", async (_req: Request, res: Response) => {
  res.json({
    fuelTypes: FUEL_TYPES.map((ft) => ({
      id: ft.id,
      type: ft.type,
      priceCentsPerGallon: ft.priceCentsPerGallon,
      costCentsPerGallon: ft.costCentsPerGallon,
      marginCents: ft.priceCentsPerGallon - ft.costCentsPerGallon,
      tankCapacityGallons: ft.tankCapacityGallons,
      currentLevelGallons: ft.currentLevelGallons,
      levelPercent: Math.round((ft.currentLevelGallons / ft.tankCapacityGallons) * 100),
    })),
  });
});

// ─── PUT /fuel/types/:id/price ────────────────────────────────────────────────

router.put("/types/:id/price", requireRole("MARINA_OWNER", "TENANT_ADMIN", "MARINA_MANAGER"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = UpdatePriceSchema.parse(req.body);
    const ft = FUEL_TYPES.find((f) => f.id === req.params.id);
    if (!ft) return res.status(404).json({ error: "Fuel type not found" });

    ft.priceCentsPerGallon = body.priceCentsPerGallon;
    if (body.costCentsPerGallon !== undefined) ft.costCentsPerGallon = body.costCentsPerGallon;

    res.json({ message: "Price updated", fuelType: ft });
  } catch (err) { next(err); }
});

// ─── POST /fuel/sales ─────────────────────────────────────────────────────────

router.post("/sales", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = req.tenantId!;
    const body = RecordSaleSchema.parse(req.body);
    const ft = FUEL_TYPES.find((f) => f.type === body.fuelType);
    if (!ft) return res.status(400).json({ error: "Invalid fuel type" });

    const totalCents = Math.round(body.gallons * ft.priceCentsPerGallon);
    ft.currentLevelGallons = Math.max(0, ft.currentLevelGallons - body.gallons);

    const sale = await prisma.fuelSale.create({
      data: {
        tenantId,
        customerId: body.customerId ?? null,
        guestName: body.guestName ?? null,
        fuelType: body.fuelType,
        gallons: body.gallons,
        priceCentsPerGallon: ft.priceCentsPerGallon,
        totalCents,
        pumpNumber: body.pumpNumber ?? null,
        staffId: body.staffId ?? null,
        paymentMethod: body.paymentMethod ?? null,
      },
    });

    res.status(201).json({
      id: sale.id,
      tenantId: sale.tenantId,
      date: sale.createdAt.toISOString(),
      customerName: sale.guestName || "Walk-up",
      fuelType: sale.fuelType,
      gallons: sale.gallons,
      pricePerGallon: sale.priceCentsPerGallon,
      totalCents: sale.totalCents,
      pumpNumber: sale.pumpNumber || 1,
      staffName: "Current User",
      paymentMethod: sale.paymentMethod || "CARD",
    });
  } catch (err) { next(err); }
});

// ─── GET /fuel/sales ──────────────────────────────────────────────────────────

router.get("/sales", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = req.tenantId!;
    const query = ListQuerySchema.parse(req.query);

    const [sales, total] = await Promise.all([
      prisma.fuelSale.findMany({
        where: { tenantId },
        orderBy: { createdAt: "desc" },
        skip: query.skip,
        take: query.take,
      }),
      prisma.fuelSale.count({ where: { tenantId } }),
    ]);

    res.json({
      sales: sales.map((s) => ({
        id: s.id,
        date: s.createdAt.toISOString(),
        customerName: s.guestName || "Walk-up",
        fuelType: s.fuelType,
        gallons: s.gallons,
        pricePerGallon: s.priceCentsPerGallon,
        totalCents: s.totalCents,
        pumpNumber: s.pumpNumber || 1,
        staffName: "Staff",
        paymentMethod: s.paymentMethod || "CARD",
      })),
      total,
    });
  } catch (err) { next(err); }
});

// ─── POST /fuel/deliveries ────────────────────────────────────────────────────

router.post("/deliveries", requireRole("MARINA_OWNER", "TENANT_ADMIN", "MARINA_MANAGER"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = req.tenantId!;
    const body = LogDeliverySchema.parse(req.body);
    const ft = FUEL_TYPES.find((f) => f.type === body.fuelType);
    if (!ft) return res.status(400).json({ error: "Invalid fuel type" });

    const tankLevelAfter = body.tankLevelAfterGallons ?? Math.min(ft.tankCapacityGallons, ft.currentLevelGallons + body.gallons);
    ft.currentLevelGallons = tankLevelAfter;
    const totalCostCents = Math.round(body.gallons * body.costCentsPerGallon);

    const delivery = await prisma.fuelDelivery.create({
      data: {
        tenantId,
        supplier: body.supplier,
        fuelType: body.fuelType,
        gallons: body.gallons,
        costCentsPerGallon: body.costCentsPerGallon,
        totalCostCents,
        tankLevelAfterGallons: tankLevelAfter,
        notes: body.notes ?? null,
      },
    });

    res.status(201).json({
      id: delivery.id,
      date: delivery.deliveredAt.toISOString(),
      supplier: delivery.supplier,
      fuelType: delivery.fuelType,
      gallons: delivery.gallons,
      costPerGallon: delivery.costCentsPerGallon,
      totalCostCents: delivery.totalCostCents,
      tankLevelAfter: delivery.tankLevelAfterGallons,
    });
  } catch (err) { next(err); }
});

// ─── GET /fuel/deliveries ─────────────────────────────────────────────────────

router.get("/deliveries", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = req.tenantId!;
    const query = ListQuerySchema.parse(req.query);

    const [deliveries, total] = await Promise.all([
      prisma.fuelDelivery.findMany({
        where: { tenantId },
        orderBy: { deliveredAt: "desc" },
        skip: query.skip,
        take: query.take,
      }),
      prisma.fuelDelivery.count({ where: { tenantId } }),
    ]);

    res.json({
      deliveries: deliveries.map((d) => ({
        id: d.id,
        date: d.deliveredAt.toISOString(),
        supplier: d.supplier,
        fuelType: d.fuelType,
        gallons: d.gallons,
        costPerGallon: d.costCentsPerGallon,
        totalCostCents: d.totalCostCents,
        tankLevelAfter: d.tankLevelAfterGallons,
        notes: d.notes,
      })),
      total,
    });
  } catch (err) { next(err); }
});

// ─── GET /fuel/tank-levels ────────────────────────────────────────────────────

router.get("/tank-levels", async (_req: Request, res: Response) => {
  res.json({
    tanks: FUEL_TYPES.map((ft) => ({
      type: ft.type,
      capacityGallons: ft.tankCapacityGallons,
      currentGallons: ft.currentLevelGallons,
      levelPercent: Math.round((ft.currentLevelGallons / ft.tankCapacityGallons) * 100),
      estimatedDaysRemaining: Math.round(ft.currentLevelGallons / 50),
    })),
  });
});

// ─── GET /fuel/reports ────────────────────────────────────────────────────────

router.get("/reports", requireRole("MARINA_OWNER", "TENANT_ADMIN", "MARINA_MANAGER", "ACCOUNTING"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = req.tenantId!;
    const sales = await prisma.fuelSale.findMany({ where: { tenantId } });

    const totalGallons = sales.reduce((s, sale) => s + sale.gallons, 0);
    const totalRevenue = sales.reduce((s, sale) => s + sale.totalCents, 0);

    const byType = FUEL_TYPES.map((ft) => {
      const typeSales = sales.filter((s) => s.fuelType === ft.type);
      const gallons = typeSales.reduce((s, sale) => s + sale.gallons, 0);
      const revenue = typeSales.reduce((s, sale) => s + sale.totalCents, 0);
      const cost = Math.round(gallons * ft.costCentsPerGallon);
      return { type: ft.type, gallons, revenueCents: revenue, costCents: cost, marginCents: revenue - cost };
    });

    res.json({ totalGallons, totalRevenueCents: totalRevenue, byType, saleCount: sales.length });
  } catch (err) { next(err); }
});

export default router;
