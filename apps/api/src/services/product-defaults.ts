import { prisma } from "../lib/prisma.js";

// ---------------------------------------------------------------------------
// Product effective tax-category resolution
//
// All inventory GL accounts now resolve through the per-location
// ProductCategoryGlMapping table only (see gl-account-resolver.ts). The only
// per-product → category fall-through still owned by this module is the
// tax category and taxable flag — the per-product `taxClass` overrides the
// category's `defaultTaxCategory` when present, with "Tax Exempt" forcing
// non-taxable on either side.
// ---------------------------------------------------------------------------

const DEFAULT_TAX_CATEGORY = "general";

// The product modal historically stored exempt status as the literal string
// "Exempt"; the new categories form writes "Tax Exempt". Treat both (and any
// case variant) as the same exempt sentinel so legacy products keep behaving
// as expected.
const TAX_EXEMPT_LABELS = new Set(["tax exempt", "exempt"]);
export function isTaxExempt(taxClass: string | null | undefined): boolean {
  return !!taxClass && TAX_EXEMPT_LABELS.has(taxClass.trim().toLowerCase());
}

// Sentinel labels the form / legacy data have written into Product.taxClass
// to mean "no override — inherit from the category". Empty strings, pure
// whitespace, and the literal "Standard" the inventory modal pre-fills for
// legacy rows all need to flow through to the category default rather than
// being treated as a real per-product tax category. Match case-insensitively
// so "standard" and "  STANDARD  " are caught too — the test fixtures and a
// handful of legacy rows write the lowercase form.
const NO_OVERRIDE_LABELS = new Set(["", "standard"]);
function isNoOverride(taxClass: string | null | undefined): boolean {
  if (taxClass == null) return true;
  return NO_OVERRIDE_LABELS.has(taxClass.trim().toLowerCase());
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
  // Per-product taxClass wins only when it's a real value — null, empty
  // string, whitespace, and the "Standard" / "standard" sentinels mean
  // "use the category default".  Use `||` (not `??`) so an empty-string
  // defaultTaxCategory on the category also falls through to "general"
  // rather than being passed as `""` and then dropped by POS's
  // `taxableLines` filter (which short-circuits on a falsy taxCategory).
  const override = isNoOverride(product.taxClass)
    ? null
    : product.taxClass!.trim();
  const categoryDefault = product.productCategory?.defaultTaxCategory?.trim();
  const taxCategory = override || categoryDefault || DEFAULT_TAX_CATEGORY;
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
