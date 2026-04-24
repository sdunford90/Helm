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

// ─── In-memory fuel config (would be DB-backed in production) ─────────────────

interface FuelType {
  id: string;
  type: string;
  priceCentsPerGallon: number;
  costCentsPerGallon: number;
  tankCapacityGallons: number;
  currentLevelGallons: number;
}

const FUEL_TYPES: FuelType[] = [
  { id: "fuel-reg", type: "REGULAR", priceCentsPerGallon: 429, costCentsPerGallon: 365, tankCapacityGallons: 5000, currentLevelGallons: 2400 },
  { id: "fuel-prem", type: "PREMIUM", priceCentsPerGallon: 479, costCentsPerGallon: 408, tankCapacityGallons: 3000, currentLevelGallons: 1800 },
  { id: "fuel-dsl", type: "DIESEL", priceCentsPerGallon: 489, costCentsPerGallon: 410, tankCapacityGallons: 4000, currentLevelGallons: 2200 },
];

interface FuelSale {
  id: string;
  tenantId: string;
  date: string;
  customerName: string;
  fuelType: string;
  gallons: number;
  pricePerGallon: number;
  totalCents: number;
  pumpNumber: number;
  staffName: string;
  paymentMethod: string;
}

interface FuelDelivery {
  id: string;
  tenantId: string;
  date: string;
  supplier: string;
  fuelType: string;
  gallons: number;
  costPerGallon: number;
  totalCostCents: number;
  tankLevelAfter: number;
}

const SALES: FuelSale[] = [];
const DELIVERIES: FuelDelivery[] = [];

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

router.put("/types/:id/price", requireRole("admin", "manager"), async (req: Request, res: Response, next: NextFunction) => {
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
    const body = RecordSaleSchema.parse(req.body);
    const ft = FUEL_TYPES.find((f) => f.type === body.fuelType);
    if (!ft) return res.status(400).json({ error: "Invalid fuel type" });

    const totalCents = Math.round(body.gallons * ft.priceCentsPerGallon);
    ft.currentLevelGallons = Math.max(0, ft.currentLevelGallons - body.gallons);

    const sale: FuelSale = {
      id: `fs-${Date.now()}`,
      tenantId: (req as any).tenantId,
      date: new Date().toISOString(),
      customerName: body.guestName || "Walk-up",
      fuelType: body.fuelType,
      gallons: body.gallons,
      pricePerGallon: ft.priceCentsPerGallon,
      totalCents,
      pumpNumber: body.pumpNumber || 1,
      staffName: "Current User",
      paymentMethod: body.paymentMethod || "CARD",
    };
    SALES.push(sale);

    res.status(201).json(sale);
  } catch (err) { next(err); }
});

// ─── GET /fuel/sales ──────────────────────────────────────────────────────────

router.get("/sales", async (req: Request, res: Response) => {
  const tenantId = (req as any).tenantId;
  const sales = SALES.filter((s) => s.tenantId === tenantId);
  res.json({ sales, count: sales.length });
});

// ─── POST /fuel/deliveries ────────────────────────────────────────────────────

router.post("/deliveries", requireRole("admin", "manager"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = LogDeliverySchema.parse(req.body);
    const ft = FUEL_TYPES.find((f) => f.type === body.fuelType);
    if (!ft) return res.status(400).json({ error: "Invalid fuel type" });

    ft.currentLevelGallons = body.tankLevelAfterGallons || (ft.currentLevelGallons + body.gallons);
    const totalCostCents = Math.round(body.gallons * body.costCentsPerGallon);

    const delivery: FuelDelivery = {
      id: `fd-${Date.now()}`,
      tenantId: (req as any).tenantId,
      date: new Date().toISOString(),
      supplier: body.supplier,
      fuelType: body.fuelType,
      gallons: body.gallons,
      costPerGallon: body.costCentsPerGallon,
      totalCostCents,
      tankLevelAfter: ft.currentLevelGallons,
    };
    DELIVERIES.push(delivery);

    res.status(201).json(delivery);
  } catch (err) { next(err); }
});

// ─── GET /fuel/deliveries ─────────────────────────────────────────────────────

router.get("/deliveries", async (req: Request, res: Response) => {
  const tenantId = (req as any).tenantId;
  res.json({ deliveries: DELIVERIES.filter((d) => d.tenantId === tenantId) });
});

// ─── GET /fuel/tank-levels ────────────────────────────────────────────────────

router.get("/tank-levels", async (_req: Request, res: Response) => {
  res.json({
    tanks: FUEL_TYPES.map((ft) => ({
      type: ft.type,
      capacityGallons: ft.tankCapacityGallons,
      currentGallons: ft.currentLevelGallons,
      levelPercent: Math.round((ft.currentLevelGallons / ft.tankCapacityGallons) * 100),
      estimatedDaysRemaining: Math.round(ft.currentLevelGallons / 50), // Rough estimate
    })),
  });
});

// ─── GET /fuel/reports ────────────────────────────────────────────────────────

router.get("/reports", requireRole("admin", "manager", "accounting"), async (req: Request, res: Response) => {
  const tenantId = (req as any).tenantId;
  const sales = SALES.filter((s) => s.tenantId === tenantId);

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
});

export default router;
