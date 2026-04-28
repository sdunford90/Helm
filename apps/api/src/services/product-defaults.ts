import { prisma } from "../lib/prisma.js";

// ---------------------------------------------------------------------------
// Product effective-value resolution
//
// A Product can belong to a ProductCategory which carries default GL accounts
// (revenue, COGS, inventory asset) and a default tax category + taxable flag.
// The per-product columns (revenueGlAccountId, etc.) act as overrides.
//
// At create/update time the API copies the category's defaults onto the
// per-product columns whenever the caller leaves the field blank, so
// downstream readers (QBO sync, reports, journals) keep using the same
// per-product fields without any change. This module provides the precedence
// rule in one place so it stays consistent everywhere.
// ---------------------------------------------------------------------------

export interface CategoryDefaults {
  defaultRevenueGlAccountId: string | null;
  defaultCogsGlAccountId: string | null;
  defaultInventoryAssetGlAccountId: string | null;
  defaultTaxCategory: string | null;
  taxable: boolean;
}

export interface EffectiveProductValues {
  revenueGlAccountId: string | null;
  cogsGlAccountId: string | null;
  inventoryAssetGlAccountId: string | null;
  taxCategory: string | null;
  taxable: boolean;
}

const DEFAULT_TAX_CATEGORY = "general";

// The product modal historically stored exempt status as the literal string
// "Exempt"; the new categories form writes "Tax Exempt". Treat both (and any
// case variant) as the same exempt sentinel so legacy products keep behaving
// as expected.
const TAX_EXEMPT_LABELS = new Set(["tax exempt", "exempt"]);
export function isTaxExempt(taxClass: string | null | undefined): boolean {
  return !!taxClass && TAX_EXEMPT_LABELS.has(taxClass.trim().toLowerCase());
}

/**
 * Merge per-product overrides onto a category's defaults. Per-product values
 * win when present (non-null). When no category is supplied the per-product
 * columns are used directly. `taxable` defaults to true when neither a
 * category nor an explicit override has been set.
 */
export function resolveEffectiveValues(opts: {
  override: {
    revenueGlAccountId?: string | null;
    cogsGlAccountId?: string | null;
    inventoryAssetGlAccountId?: string | null;
    taxClass?: string | null;
  };
  category?: CategoryDefaults | null;
}): EffectiveProductValues {
  const cat = opts.category ?? null;
  const ov = opts.override;
  const exempt = isTaxExempt(ov.taxClass);
  return {
    revenueGlAccountId:
      ov.revenueGlAccountId ?? cat?.defaultRevenueGlAccountId ?? null,
    cogsGlAccountId:
      ov.cogsGlAccountId ?? cat?.defaultCogsGlAccountId ?? null,
    inventoryAssetGlAccountId:
      ov.inventoryAssetGlAccountId ??
      cat?.defaultInventoryAssetGlAccountId ??
      null,
    // Per-product taxClass takes precedence; fall back to the category's
    // defaultTaxCategory; final fallback to the engine's "general" bucket.
    taxCategory:
      (ov.taxClass && !exempt ? ov.taxClass : null) ??
      cat?.defaultTaxCategory ??
      DEFAULT_TAX_CATEGORY,
    // The category's taxable flag wins when set; an explicit per-product
    // taxClass of "Tax Exempt"/"Exempt" forces non-taxable.
    taxable: exempt ? false : cat ? cat.taxable : true,
  };
}

/**
 * Pre-write helper: when the caller supplies a productCategoryId but leaves
 * one of the GL account fields blank, copy the category's default into the
 * per-product column. Returns the data object the caller should pass into
 * prisma.product.create/update (only fields the caller already set are
 * touched — undefined inputs stay undefined so partial updates work).
 */
export async function applyCategoryDefaultsToProductData<
  T extends {
    productCategoryId?: string | null;
    revenueGlAccountId?: string | null;
    cogsGlAccountId?: string | null;
    inventoryAssetGlAccountId?: string | null;
    taxClass?: string | null;
  },
>(tenantId: string, data: T): Promise<T> {
  if (!data.productCategoryId) return data;

  const category = await prisma.productCategory.findFirst({
    where: { id: data.productCategoryId, tenantId },
    select: {
      defaultRevenueGlAccountId: true,
      defaultCogsGlAccountId: true,
      defaultInventoryAssetGlAccountId: true,
      defaultTaxCategory: true,
      taxable: true,
    },
  });
  // Reject cross-tenant or non-existent category references at write-time so
  // the FK never points to data the caller can't see.
  if (!category) {
    const err: any = new Error("Product category not found");
    err.statusCode = 400;
    err.code = "PRODUCT_CATEGORY_NOT_FOUND";
    throw err;
  }

  const out = { ...data };
  if (out.revenueGlAccountId === undefined || out.revenueGlAccountId === null) {
    out.revenueGlAccountId = category.defaultRevenueGlAccountId ?? null;
  }
  if (out.cogsGlAccountId === undefined || out.cogsGlAccountId === null) {
    out.cogsGlAccountId = category.defaultCogsGlAccountId ?? null;
  }
  if (
    out.inventoryAssetGlAccountId === undefined ||
    out.inventoryAssetGlAccountId === null
  ) {
    out.inventoryAssetGlAccountId =
      category.defaultInventoryAssetGlAccountId ?? null;
  }
  // Only copy tax category when caller didn't specify a taxClass at all.
  if (out.taxClass === undefined || out.taxClass === null) {
    if (!category.taxable) {
      out.taxClass = "Tax Exempt";
    } else if (category.defaultTaxCategory) {
      out.taxClass = category.defaultTaxCategory;
    }
  }
  return out;
}

/**
 * Synchronous resolver for an already-loaded product. Centralizes the
 * per-product → category → "general" precedence rule and the two
 * short-circuit cases (per-product "Tax Exempt", category.taxable=false).
 * Both the POS batch-loaded path and the invoice/single-product path call
 * this so the rule lives in exactly one place.
 */
export function resolveProductTaxCategory(product: {
  taxClass?: string | null;
  productCategory?: {
    defaultTaxCategory: string | null;
    taxable: boolean;
  } | null;
}): { taxCategory: string | null; taxable: boolean } {
  if (isTaxExempt(product.taxClass)) {
    return { taxCategory: null, taxable: false };
  }
  if (product.productCategory && !product.productCategory.taxable) {
    return { taxCategory: null, taxable: false };
  }
  const taxCategory =
    (product.taxClass && product.taxClass !== "Standard"
      ? product.taxClass
      : null) ??
    product.productCategory?.defaultTaxCategory ??
    DEFAULT_TAX_CATEGORY;
  return { taxCategory, taxable: true };
}

/**
 * Async wrapper that loads a product by id and resolves its effective tax
 * category. Used by callers that don't already have the product in hand
 * (e.g. invoice line items referencing a product by id).
 */
export async function getProductTaxCategory(
  productId: string,
  tenantId: string,
): Promise<{ taxCategory: string | null; taxable: boolean }> {
  const product = await prisma.product.findFirst({
    where: { id: productId, tenantId },
    select: {
      taxClass: true,
      productCategory: {
        select: { defaultTaxCategory: true, taxable: true },
      },
    },
  });
  if (!product) return { taxCategory: DEFAULT_TAX_CATEGORY, taxable: true };
  return resolveProductTaxCategory(product);
}

