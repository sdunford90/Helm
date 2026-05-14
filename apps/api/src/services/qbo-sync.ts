import { GLAccountType, GlAccountSource } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { getLocationPostingAccounts } from "./gl-account-resolver.js";

// --------------------------------------------------------------------------
// QuickBooks Online Bidirectional Sync Service
// --------------------------------------------------------------------------

const QBO_AUTH_BASE = "https://appcenter.intuit.com/connect/oauth2";
const QBO_TOKEN_URL = "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer";
const QBO_API_BASE_SANDBOX = "https://sandbox-quickbooks.api.intuit.com/v3/company";
const QBO_API_BASE_PRODUCTION = "https://quickbooks.api.intuit.com/v3/company";

interface QboConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  environment: "sandbox" | "production";
}

interface QboTokens {
  accessToken: string;
  refreshToken: string;
  realmId: string;
  expiresAt: Date;
}

interface JournalLineEntry {
  accountId: string;
  debitCents: number;
  creditCents: number;
  description: string;
}

function getConfig(): QboConfig {
  return {
    clientId: process.env.QBO_CLIENT_ID!,
    clientSecret: process.env.QBO_CLIENT_SECRET!,
    redirectUri: process.env.QBO_REDIRECT_URI!,
    environment: (process.env.QBO_ENVIRONMENT as "sandbox" | "production") || "sandbox",
  };
}

function getApiBase(environment: "sandbox" | "production"): string {
  return environment === "production" ? QBO_API_BASE_PRODUCTION : QBO_API_BASE_SANDBOX;
}

function basicAuthHeader(config: QboConfig): string {
  return "Basic " + Buffer.from(`${config.clientId}:${config.clientSecret}`).toString("base64");
}

async function auditLog(
  tenantId: string,
  action: string,
  details: Record<string, unknown>,
): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        tenantId,
        userId: "system",
        userName: "qbo-sync",
        recordType: "QboSync",
        recordId: tenantId,
        action,
        changedFieldsJson: details,
      },
    });
  } catch {
    console.error("[qbo-sync] Failed to write audit log", { tenantId, action });
  }
}

// --------------------------------------------------------------------------
// Token management helpers
// --------------------------------------------------------------------------

async function getTokens(tenantId: string): Promise<QboTokens> {
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: {
      qboAccessToken: true,
      qboRefreshToken: true,
      qboRealmId: true,
      qboTokenExpiresAt: true,
    },
  });

  if (!tenant?.qboAccessToken || !tenant?.qboRefreshToken || !tenant?.qboRealmId) {
    throw new Error("QuickBooks Online is not connected for this tenant");
  }

  return {
    accessToken: tenant.qboAccessToken,
    refreshToken: tenant.qboRefreshToken,
    realmId: tenant.qboRealmId,
    expiresAt: tenant.qboTokenExpiresAt ?? new Date(0),
  };
}

async function getLocationTokens(locationId: string): Promise<QboTokens> {
  const location = await prisma.location.findUnique({
    where: { id: locationId },
    select: {
      qboAccessToken: true,
      qboRefreshToken: true,
      qboRealmId: true,
      qboTokenExpiresAt: true,
    },
  });

  if (!location?.qboAccessToken || !location?.qboRefreshToken || !location?.qboRealmId) {
    throw new Error(`QuickBooks Online is not connected for location ${locationId}`);
  }

  return {
    accessToken: location.qboAccessToken,
    refreshToken: location.qboRefreshToken,
    realmId: location.qboRealmId,
    expiresAt: location.qboTokenExpiresAt ?? new Date(0),
  };
}

async function storeTokens(
  tenantId: string,
  accessToken: string,
  refreshToken: string,
  realmId: string,
  expiresIn: number,
): Promise<void> {
  const expiresAt = new Date(Date.now() + expiresIn * 1000);
  await prisma.tenant.update({
    where: { id: tenantId },
    data: {
      qboAccessToken: accessToken,
      qboRefreshToken: refreshToken,
      qboRealmId: realmId,
      qboTokenExpiresAt: expiresAt,
      qboConnectedAt: new Date(),
    },
  });
}

async function storeLocationTokens(
  locationId: string,
  accessToken: string,
  refreshToken: string,
  realmId: string,
  expiresIn: number,
  companyName?: string,
): Promise<void> {
  const expiresAt = new Date(Date.now() + expiresIn * 1000);
  await prisma.location.update({
    where: { id: locationId },
    data: {
      qboAccessToken: accessToken,
      qboRefreshToken: refreshToken,
      qboRealmId: realmId,
      qboTokenExpiresAt: expiresAt,
      qboConnectedAt: new Date(),
      ...(companyName ? { qboCompanyName: companyName } : {}),
    },
  });
}

export async function getValidAccessToken(tenantId: string): Promise<{ accessToken: string; realmId: string }> {
  const tokens = await getTokens(tenantId);

  // Refresh if token expires within 5 minutes
  if (tokens.expiresAt.getTime() - Date.now() < 5 * 60 * 1000) {
    const newAccessToken = await refreshToken(tenantId);
    return { accessToken: newAccessToken, realmId: tokens.realmId };
  }

  return { accessToken: tokens.accessToken, realmId: tokens.realmId };
}

export async function getValidAccessTokenForLocation(locationId: string): Promise<{ accessToken: string; realmId: string }> {
  const tokens = await getLocationTokens(locationId);

  if (tokens.expiresAt.getTime() - Date.now() < 5 * 60 * 1000) {
    const newAccessToken = await refreshLocationToken(locationId);
    return { accessToken: newAccessToken, realmId: tokens.realmId };
  }

  return { accessToken: tokens.accessToken, realmId: tokens.realmId };
}

// --------------------------------------------------------------------------
// QBO API request helper with automatic token refresh on 401
// --------------------------------------------------------------------------

// Credential context: either tenant-level or location-level
export interface QboCredentialContext {
  tenantId: string;
  locationId?: string;
}

export async function qboRequest(
  ctx: string | QboCredentialContext,
  method: "GET" | "POST",
  path: string,
  body?: unknown,
  retried = false,
): Promise<any> {
  // Support legacy string tenantId for backward compatibility
  const context: QboCredentialContext = typeof ctx === "string" ? { tenantId: ctx } : ctx;
  const config = getConfig();

  let accessToken: string;
  let realmId: string;

  if (context.locationId) {
    const result = await getValidAccessTokenForLocation(context.locationId);
    accessToken = result.accessToken;
    realmId = result.realmId;
  } else {
    const result = await getValidAccessToken(context.tenantId);
    accessToken = result.accessToken;
    realmId = result.realmId;
  }

  const apiBase = getApiBase(config.environment);
  const url = `${apiBase}/${realmId}/${path}`;

  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    Accept: "application/json",
    "Content-Type": "application/json",
  };

  const response = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  if (response.status === 401 && !retried) {
    // Token expired, refresh and retry once
    if (context.locationId) {
      await refreshLocationToken(context.locationId);
    } else {
      await refreshToken(context.tenantId);
    }
    return qboRequest(ctx, method, path, body, true);
  }

  if (!response.ok) {
    const errorBody = await response.text();
    console.error("[qbo-sync] API error", { status: response.status, url, errorBody });
    throw new Error(`QBO API error ${response.status}: ${errorBody}`);
  }

  return response.json();
}

// --------------------------------------------------------------------------
// OAuth Flow
// --------------------------------------------------------------------------

export async function getAuthorizationUrl(tenantId: string, state: string): Promise<string> {
  const config = getConfig();

  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: "code",
    scope: "com.intuit.quickbooks.accounting",
    state: `${tenantId}:${state}`,
  });

  return `${QBO_AUTH_BASE}?${params.toString()}`;
}

export async function handleCallback(
  code: string,
  realmId: string,
  tenantId: string,
): Promise<void> {
  const config = getConfig();

  const response = await fetch(QBO_TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: basicAuthHeader(config),
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: config.redirectUri,
    }).toString(),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    console.error("[qbo-sync] Token exchange failed", { status: response.status, errorBody });
    throw new Error(`QBO token exchange failed: ${response.status}`);
  }

  const data = await response.json() as Record<string, unknown>;

  await storeTokens(
    tenantId,
    data.access_token as string,
    data.refresh_token as string,
    realmId,
    data.expires_in as number,
  );

  await auditLog(tenantId, "QBO_CONNECTED", { realmId });

  // Trigger initial sync in the background
  syncAll(tenantId).catch((err) => {
    console.error("[qbo-sync] Initial sync failed", err);
  });
}

export async function refreshToken(tenantId: string): Promise<string> {
  const config = getConfig();
  const tokens = await getTokens(tenantId);

  const response = await fetch(QBO_TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: basicAuthHeader(config),
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: tokens.refreshToken,
    }).toString(),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    console.error("[qbo-sync] Token refresh failed", { status: response.status, errorBody });

    // If refresh token is invalid, mark as disconnected
    if (response.status === 400 || response.status === 401) {
      await prisma.tenant.update({
        where: { id: tenantId },
        data: {
          qboAccessToken: null,
          qboRefreshToken: null,
          qboTokenExpiresAt: null,
        },
      });
      await auditLog(tenantId, "QBO_DISCONNECTED", { reason: "refresh_token_expired" });
    }

    throw new Error(`QBO token refresh failed: ${response.status}`);
  }

  const data = await response.json() as Record<string, unknown>;

  await storeTokens(
    tenantId,
    data.access_token as string,
    data.refresh_token as string,
    tokens.realmId,
    data.expires_in as number,
  );

  return data.access_token as string;
}

export async function refreshLocationToken(locationId: string): Promise<string> {
  const config = getConfig();
  const tokens = await getLocationTokens(locationId);

  const response = await fetch(QBO_TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: basicAuthHeader(config),
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: tokens.refreshToken,
    }).toString(),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    console.error("[qbo-sync] Location token refresh failed", { status: response.status, errorBody });

    if (response.status === 400 || response.status === 401) {
      await prisma.location.update({
        where: { id: locationId },
        data: {
          qboAccessToken: null,
          qboRefreshToken: null,
          qboTokenExpiresAt: null,
        },
      });
    }

    throw new Error(`QBO location token refresh failed: ${response.status}`);
  }

  const data = await response.json() as Record<string, unknown>;

  await storeLocationTokens(
    locationId,
    data.access_token as string,
    data.refresh_token as string,
    tokens.realmId,
    data.expires_in as number,
  );

  return data.access_token as string;
}

export async function handleCallbackForLocation(
  code: string,
  realmId: string,
  locationId: string,
  tenantId: string,
): Promise<void> {
  const config = getConfig();

  const response = await fetch(QBO_TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: basicAuthHeader(config),
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: config.redirectUri,
    }).toString(),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    console.error("[qbo-sync] Location token exchange failed", { status: response.status, errorBody });
    throw new Error(`QBO token exchange failed: ${response.status}`);
  }

  const data = await response.json() as Record<string, unknown>;

  // Attempt to fetch QBO company name for display
  let companyName: string | undefined;
  try {
    const accessToken = data.access_token as string;
    const companyInfoUrl = `${getApiBase(config.environment)}/${realmId}/companyinfo/${realmId}?minorversion=73`;
    const infoRes = await fetch(companyInfoUrl, {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
    });
    if (infoRes.ok) {
      const info = await infoRes.json() as any;
      companyName = info?.CompanyInfo?.CompanyName as string | undefined;
    }
  } catch {
    // Non-fatal — company name display is best-effort
  }

  await storeLocationTokens(
    locationId,
    data.access_token as string,
    data.refresh_token as string,
    realmId,
    data.expires_in as number,
    companyName,
  );

  await auditLog(tenantId, "QBO_LOCATION_CONNECTED", { locationId, realmId, companyName });
}

export async function disconnectLocation(locationId: string, tenantId: string): Promise<void> {
  await prisma.location.update({
    where: { id: locationId },
    data: {
      qboAccessToken: null,
      qboRefreshToken: null,
      qboRealmId: null,
      qboTokenExpiresAt: null,
      qboConnectedAt: null,
      qboCompanyName: null,
    },
  });
  await auditLog(tenantId, "QBO_LOCATION_DISCONNECTED", { locationId, reason: "manual_disconnect" });
}

// --------------------------------------------------------------------------
// Entity Sync: Customer
// --------------------------------------------------------------------------

// Resolve the credential context for a location — uses location credentials if available,
// otherwise throws a clear error so callers can decide how to proceed.
async function resolveQboContext(tenantId: string, locationId?: string | null): Promise<QboCredentialContext> {
  if (!locationId) {
    console.log(`[qbo-sync] Using tenant-level QBO credentials for tenant ${tenantId}`);
    return { tenantId };
  }
  const location = await prisma.location.findUnique({
    where: { id: locationId },
    select: { qboRealmId: true, qboAccessToken: true },
  });
  if (location?.qboRealmId && location?.qboAccessToken) {
    console.log(`[qbo-sync] Using per-location QBO credentials for tenant ${tenantId}, locationId=${locationId}`);
    return { tenantId, locationId };
  }
  throw new Error(`QuickBooks Online is not connected for location ${locationId}. Please connect QBO in Settings > Locations before syncing.`);
}

export async function syncCustomer(customerId: string, tenantId: string, locationId?: string | null): Promise<void> {
  const customer = await prisma.customer.findFirst({
    where: { id: customerId, tenantId },
  });

  if (!customer) {
    throw new Error(`Customer ${customerId} not found`);
  }

  const ctx = await resolveQboContext(tenantId, locationId ?? null);

  const qboCustomerData: Record<string, unknown> = {
    GivenName: customer.firstName || "",
    FamilyName: customer.lastName || "",
    DisplayName: `${customer.firstName || ""} ${customer.lastName || ""}`.trim() || customer.email,
    PrimaryEmailAddr: customer.email ? { Address: customer.email } : undefined,
    PrimaryPhone: customer.phone ? { FreeFormNumber: customer.phone } : undefined,
    CompanyName: (customer as any).company || undefined,
  };

  // Add billing address if available (stored as addressJson JSON object)
  const addrJson = (customer as any).addressJson as { address?: string; city?: string; state?: string; zip?: string } | null | undefined;
  if (addrJson?.address) {
    qboCustomerData.BillAddr = {
      Line1: addrJson.address,
      City: addrJson.city || undefined,
      CountrySubDivisionCode: addrJson.state || undefined,
      PostalCode: addrJson.zip || undefined,
    };
  }

  let result: any;

  if ((customer as any).qboCustomerId) {
    // Update existing QBO customer — need to fetch SyncToken first
    const existing = await qboRequest(
      ctx,
      "GET",
      `customer/${(customer as any).qboCustomerId}?minorversion=73`,
    );

    qboCustomerData.Id = (customer as any).qboCustomerId;
    qboCustomerData.SyncToken = existing.Customer.SyncToken;
    qboCustomerData.sparse = true;

    result = await qboRequest(ctx, "POST", "customer?minorversion=73", qboCustomerData);
  } else {
    // Create new QBO customer. If QBO already has a customer with the same
    // DisplayName (error 6240 — common when the QBO file pre-existed our
    // records, e.g. seeded sandbox data), look it up by DisplayName and
    // bind to it instead of failing the whole invoice sync.
    try {
      result = await qboRequest(ctx, "POST", "customer?minorversion=73", qboCustomerData);
    } catch (err) {
      const msg = (err as Error).message || "";
      const isDuplicate = /"code":"?6240"?/.test(msg) || /Duplicate Name Exists/i.test(msg);
      if (!isDuplicate) throw err;

      const displayName = String(qboCustomerData.DisplayName ?? "").trim();
      if (!displayName) throw err;
      // Escape single quotes for QBO's SQL-like query language.
      const escaped = displayName.replace(/'/g, "\\'");
      const queryRes = await qboRequest(
        ctx,
        "GET",
        `query?query=${encodeURIComponent(
          `SELECT Id, DisplayName, SyncToken FROM Customer WHERE DisplayName = '${escaped}'`,
        )}&minorversion=73`,
      );
      const existing = queryRes?.QueryResponse?.Customer?.[0];
      if (!existing?.Id) {
        // Truly couldn't find it — surface the original duplicate error.
        throw err;
      }
      console.log(
        `[qbo-sync] Bound local customer ${customerId} to existing QBO customer ${existing.Id} (${displayName}) via duplicate-name recovery`,
      );
      result = { Customer: { Id: String(existing.Id) } };
    }

    // Store QBO customer ID on our record
    await prisma.customer.update({
      where: { id: customerId },
      data: { qboCustomerId: result.Customer.Id } as any,
    });
  }

  await auditLog(tenantId, "QBO_CUSTOMER_SYNCED", {
    customerId,
    qboCustomerId: result.Customer.Id,
    locationId: locationId ?? null,
  });
}

// --------------------------------------------------------------------------
// Entity Sync: Invoice
// --------------------------------------------------------------------------

export async function syncInvoice(invoiceId: string, tenantId: string): Promise<void> {
  const invoice = await prisma.invoice.findFirst({
    where: { id: invoiceId, tenantId },
    include: {
      lineItems: true,
      customer: true,
    },
  });

  if (!invoice) {
    throw new Error(`Invoice ${invoiceId} not found`);
  }

  // Resolve credentials: prefer location-level QBO connection if the invoice has a location
  const locationId = (invoice as any).locationId as string | null | undefined;
  const ctx = await resolveQboContext(tenantId, locationId);

  // Ensure customer is synced to QBO first (using same credential context)
  if (!(invoice.customer as any).qboCustomerId) {
    await syncCustomer(invoice.customer.id, tenantId, ctx.locationId);
    // Re-fetch customer to get qboCustomerId
    const updatedCustomer = await prisma.customer.findUnique({
      where: { id: invoice.customer.id },
    });
    if (!(updatedCustomer as any)?.qboCustomerId) {
      throw new Error("Failed to sync customer to QBO before invoice sync");
    }
    (invoice.customer as any).qboCustomerId = (updatedCustomer as any).qboCustomerId;
  }

  // Task 18 preflight: for PRODUCT-sourced line items that don't yet have a
  // QBO Item ID, attempt to sync the QB Item now so the invoice can reference
  // it via ItemRef (improves reporting + avoids orphaned revenue lines in QBO).
  const rawLineItems: any[] = (invoice as any).lineItems ?? [];
  const productLineItems = rawLineItems.filter(
    (li: any) => li.sourceType?.toUpperCase() === "PRODUCT" && li.sourceId,
  );
  if (productLineItems.length > 0) {
    // Batch-fetch qboItemId from the sync-ref table for all product IDs.
    const productIds = [...new Set(productLineItems.map((li: any) => li.sourceId as string))];
    const syncRefs = await (prisma as any).qboInventorySyncRef.findMany({
      where: { tenantId, sourceType: "product", sourceId: { in: productIds } },
      select: { sourceId: true, qboId: true },
    });
    const qboItemIdByProductId = new Map<string, string | null>(
      syncRefs.map((r: any) => [r.sourceId as string, (r.qboId as string | null) ?? null]),
    );

    // For each product line item without a QBO Item ID, try to sync it now.
    for (const li of productLineItems) {
      const productId = li.sourceId as string;
      if (qboItemIdByProductId.get(productId)) continue; // already synced

      try {
        const product = await prisma.product.findFirst({
          where: { id: productId, tenantId },
          select: {
            id: true, name: true, sku: true, priceCents: true,
            costCents: true, qoh: true, trackInventory: true,
            productCategory: {
              select: {
                glMappings: {
                  ...(ctx.locationId ? { where: { locationId: ctx.locationId } } : {}),
                  select: {
                    revenueGlAccountId: true,
                    inventoryAssetGlAccountId: true,
                    cogsGlAccountId: true,
                  },
                  take: 1,
                },
              },
            },
          },
        });
        if (!product) continue;

        const mapping = (product as any).productCategory?.glMappings?.[0];
        const incomeGlAccountId = mapping?.revenueGlAccountId ?? null;
        const inventoryAssetGlAccountId = mapping?.inventoryAssetGlAccountId ?? null;
        const cogsGlAccountId = mapping?.cogsGlAccountId ?? null;

        const synced = await syncInventoryItem(
          {
            productId: product.id,
            name: product.name,
            sku: product.sku ?? null,
            priceCents: product.priceCents,
            costCents: (product as any).costCents ?? 0,
            qoh: (product as any).qoh,
            trackInventory: (product as any).trackInventory ?? false,
            incomeGlAccountId,
            inventoryAssetGlAccountId,
            cogsGlAccountId,
          },
          tenantId,
          ctx.locationId,
        );
        qboItemIdByProductId.set(productId, synced.qboItemId);
      } catch (err) {
        console.warn(
          `[qbo-sync] syncInvoice preflight: could not sync QB Item for product ${productId}:`,
          err instanceof Error ? err.message : String(err),
        );
        // Continue — the line will be sent without ItemRef (falls back to
        // AccountRef / manual revenue account in QBO).
      }
    }

    // Stamp the resolved qboItemId onto each raw line item so the map below
    // can include ItemRef without a second DB round-trip.
    for (const li of rawLineItems) {
      if (li.sourceType?.toUpperCase() === "PRODUCT" && li.sourceId) {
        const qboItemId = qboItemIdByProductId.get(li.sourceId as string);
        if (qboItemId) li._resolvedQboItemId = qboItemId;
      }
    }
  }

  // QBO validates `Line.Amount === SalesItemLineDetail.UnitPrice * Qty` to the
  // cent on every SalesItemLineDetail line and rejects the entire invoice when
  // it doesn't tie. Sending the post-discount/post-tax `extendedCents` as
  // Amount while sending the pre-discount `unitPriceCents` as UnitPrice
  // violates that invariant the moment any line carries a discount or
  // line-level tax — the same failure mode that broke POS receipts (Task #309).
  //
  // Fix: send the *pre-discount, pre-tax* line subtotal as `Amount`, and a
  // `UnitPrice` that satisfies the equality exactly. Discounts are surfaced as
  // a single receipt-level `DiscountLineDetail`, and per-line tax is
  // aggregated into one `Sales Tax` line so the QBO invoice's `TotalAmt` still
  // ties to `Invoice.totalCents`.
  let totalLineDiscountCents = 0;
  let totalLineTaxCents = 0;
  let totalLineSubtotalCents = 0;
  const lineItems: Record<string, unknown>[] = [];
  rawLineItems.forEach((item: any, idx: number) => {
    const quantity = Math.max(1, Number(item.quantity) || 1);
    const unitPriceCents = Number(item.unitPriceCents) || 0;
    const lineSubtotalCents = unitPriceCents * quantity;
    const amount = lineSubtotalCents / 100;
    const unitPrice = unitPriceCents / 100;

    // Detect float-precision drift between (UnitPrice * Qty) and Amount —
    // e.g. 1.43 * 7 = 10.010000000000002 in IEEE-754. When QBO would round
    // the product differently than our integer subtotal, collapse to a
    // single-unit line so the equality holds exactly.
    const productMatchesCents =
      Math.round(unitPrice * quantity * 100) === lineSubtotalCents;

    const detail: Record<string, unknown> = productMatchesCents
      ? { Qty: quantity, UnitPrice: unitPrice }
      : { Qty: 1, UnitPrice: amount };
    if (item._resolvedQboItemId || item.qboItemId) {
      detail.ItemRef = { value: item._resolvedQboItemId ?? item.qboItemId };
    }

    lineItems.push({
      LineNum: lineItems.length + 1,
      Amount: amount,
      DetailType: "SalesItemLineDetail",
      Description: item.description || `Line ${idx + 1}`,
      SalesItemLineDetail: detail,
    });

    totalLineSubtotalCents += lineSubtotalCents;
    totalLineDiscountCents += Number(item.discountCents) || 0;
    totalLineTaxCents += Number(item.taxCents) || 0;
  });

  // Aggregate per-line discounts into a single receipt-level discount line so
  // the per-line UnitPrice * Qty equality holds while the invoice total still
  // ties to Invoice.totalCents.
  if (totalLineDiscountCents > 0) {
    lineItems.push({
      LineNum: lineItems.length + 1,
      Amount: totalLineDiscountCents / 100,
      DetailType: "DiscountLineDetail",
      Description: "Invoice discount",
      DiscountLineDetail: {
        PercentBased: false,
      },
    });
  }

  // Surface tax as a separate sales-tax line. Per-line `taxCents` was
  // previously folded into `extendedCents` and is now intentionally excluded
  // from item lines so we don't double-count. Legacy invoices may carry tax
  // only on the header (`Invoice.taxCents`) without per-line `taxCents`; fall
  // back to the header value so those still tie out to `Invoice.totalCents`.
  const headerTaxCents = Number((invoice as any).taxCents) || 0;
  const taxCentsForQbo = totalLineTaxCents > 0 ? totalLineTaxCents : headerTaxCents;
  if (taxCentsForQbo > 0) {
    lineItems.push({
      Amount: taxCentsForQbo / 100,
      DetailType: "SalesItemLineDetail",
      Description: "Sales Tax",
      SalesItemLineDetail: {
        Qty: 1,
        UnitPrice: taxCentsForQbo / 100,
      },
    });
  }

  // Defense in depth: assert the computed invoice total ties out to
  // Invoice.totalCents to the cent before we send. If it doesn't, throw a
  // clear internal error rather than letting QBO reject the payload.
  const computedTotalCents =
    totalLineSubtotalCents - totalLineDiscountCents + taxCentsForQbo;
  const expectedTotalCents = Number((invoice as any).totalCents) || 0;
  if (expectedTotalCents > 0 && computedTotalCents !== expectedTotalCents) {
    throw new Error(
      `[qbo-sync] Invoice total mismatch for ${invoiceId}: ` +
        `computed=${computedTotalCents} expected=${expectedTotalCents}`,
    );
  }

  const qboInvoiceData: Record<string, unknown> = {
    CustomerRef: { value: (invoice.customer as any).qboCustomerId },
    Line: lineItems,
    DueDate: invoice.dueDate ? (invoice.dueDate as Date).toISOString().split("T")[0] : undefined,
    TxnDate: invoice.issuedDate
      ? (invoice.issuedDate as Date).toISOString().split("T")[0]
      : undefined,
    DocNumber: (invoice as any).invoiceNumber || undefined,
    CustomerMemo: { value: (invoice as any).memo || "" },
  };

  // When the invoice's location pins a per-location A/R account that's
  // already mirrored in QBO, force the QBO Invoice to that A/R account.
  // Without this, QBO would pick its file's default A/R, which can be the
  // wrong account (or even the wrong realm) for tenants whose locations
  // file separate QBO books.
  if (locationId) {
    const pinned = await getLocationPostingAccounts(locationId);
    if (pinned.ar?.qboAccountId) {
      qboInvoiceData.ARAccountRef = { value: pinned.ar.qboAccountId };
    }
  }

  let result: any;

  if ((invoice as any).qboInvoiceId) {
    // Update existing QBO invoice
    const existing = await qboRequest(
      ctx,
      "GET",
      `invoice/${(invoice as any).qboInvoiceId}?minorversion=73`,
    );

    qboInvoiceData.Id = (invoice as any).qboInvoiceId;
    qboInvoiceData.SyncToken = existing.Invoice.SyncToken;
    qboInvoiceData.sparse = true;

    result = await qboRequest(ctx, "POST", "invoice?minorversion=73", qboInvoiceData);
  } else {
    // Create new QBO invoice
    result = await qboRequest(ctx, "POST", "invoice?minorversion=73", qboInvoiceData);

    await prisma.invoice.update({
      where: { id: invoiceId },
      data: { qboInvoiceId: result.Invoice.Id } as any,
    });
  }

  await auditLog(tenantId, "QBO_INVOICE_SYNCED", {
    invoiceId,
    qboInvoiceId: result.Invoice.Id,
    locationId: ctx.locationId ?? null,
  });
}

// --------------------------------------------------------------------------
// Entity Sync: Payment
// --------------------------------------------------------------------------

export async function syncPayment(paymentId: string, tenantId: string): Promise<void> {
  const payment = await prisma.payment.findFirst({
    where: { id: paymentId, tenantId },
    include: {
      customer: true,
      invoice: true,
    },
  });

  if (!payment) {
    throw new Error(`Payment ${paymentId} not found`);
  }

  // Resolve credentials from the linked invoice's location (if any)
  const locationId = (payment.invoice as any)?.locationId as string | null | undefined;
  const ctx = await resolveQboContext(tenantId, locationId);

  // Ensure customer is synced using same credential context
  if (!(payment.customer as any).qboCustomerId) {
    await syncCustomer(payment.customer.id, tenantId, ctx.locationId);
    const updatedCustomer = await prisma.customer.findUnique({
      where: { id: payment.customer.id },
    });
    (payment.customer as any).qboCustomerId = (updatedCustomer as any)?.qboCustomerId;
  }

  if (!(payment.customer as any).qboCustomerId) {
    throw new Error("Customer has no QBO ID after sync attempt");
  }

  // Resolve location-pinned AR + cash/undeposited-funds accounts. When the
  // location has them mapped to a QBO account, we send ARAccountRef and
  // DepositToAccountRef on the QBO Payment / SalesReceipt so QBO posts to
  // the same accounts our local GL already used (rather than QBO's default
  // file-level A/R or "Undeposited Funds").
  const locationPinned = locationId
    ? await getLocationPostingAccounts(locationId)
    : { ar: null, undepositedFunds: null, deferredRevenue: null };

  // For payments linked to an invoice, create a QBO Payment
  // For standalone payments, create a QBO SalesReceipt
  if (payment.invoice && (payment.invoice as any).qboInvoiceId) {
    const qboPaymentData: Record<string, unknown> = {
      CustomerRef: { value: (payment.customer as any).qboCustomerId },
      TotalAmt: payment.amountCents / 100,
      TxnDate: (payment.postedDate as Date).toISOString().split("T")[0],
      Line: [
        {
          Amount: payment.amountCents / 100,
          LinkedTxn: [
            {
              TxnId: (payment.invoice as any).qboInvoiceId,
              TxnType: "Invoice",
            },
          ],
        },
      ],
    };

    // Map payment method to QBO payment type
    if (payment.method === "CARD" || payment.method === "ACH") {
      qboPaymentData.PaymentMethodRef = {
        value: payment.method === "CARD" ? "CreditCard" : "ACH",
      };
    }

    if (locationPinned.ar?.qboAccountId) {
      qboPaymentData.ARAccountRef = { value: locationPinned.ar.qboAccountId };
    }
    if (locationPinned.undepositedFunds?.qboAccountId) {
      qboPaymentData.DepositToAccountRef = {
        value: locationPinned.undepositedFunds.qboAccountId,
      };
    }

    const result = await qboRequest(ctx, "POST", "payment?minorversion=73", qboPaymentData);

    await prisma.payment.update({
      where: { id: paymentId },
      data: { qboPaymentId: result.Payment.Id } as any,
    });

    await auditLog(tenantId, "QBO_PAYMENT_SYNCED", {
      paymentId,
      qboPaymentId: result.Payment.Id,
      type: "Payment",
      locationId: ctx.locationId ?? null,
    });
  } else {
    // Create SalesReceipt for standalone payments
    const qboReceiptData: Record<string, unknown> = {
      CustomerRef: { value: (payment.customer as any).qboCustomerId },
      TotalAmt: payment.amountCents / 100,
      TxnDate: (payment.postedDate as Date).toISOString().split("T")[0],
      Line: [
        {
          Amount: payment.amountCents / 100,
          DetailType: "SalesItemLineDetail",
          Description: `Payment ${paymentId}`,
          SalesItemLineDetail: {
            Qty: 1,
            UnitPrice: payment.amountCents / 100,
          },
        },
      ],
    };

    if (locationPinned.undepositedFunds?.qboAccountId) {
      qboReceiptData.DepositToAccountRef = {
        value: locationPinned.undepositedFunds.qboAccountId,
      };
    }

    const result = await qboRequest(
      ctx,
      "POST",
      "salesreceipt?minorversion=73",
      qboReceiptData,
    );

    await prisma.payment.update({
      where: { id: paymentId },
      data: { qboPaymentId: result.SalesReceipt.Id } as any,
    });

    await auditLog(tenantId, "QBO_PAYMENT_SYNCED", {
      paymentId,
      qboSalesReceiptId: result.SalesReceipt.Id,
      type: "SalesReceipt",
    });
  }
}

// --------------------------------------------------------------------------
// Journal Entry
// --------------------------------------------------------------------------

export async function postJournalEntry(
  tenantId: string,
  entries: JournalLineEntry[],
): Promise<void> {
  // Validate that debits equal credits
  const totalDebits = entries.reduce((sum, e) => sum + e.debitCents, 0);
  const totalCredits = entries.reduce((sum, e) => sum + e.creditCents, 0);

  if (totalDebits !== totalCredits) {
    throw new Error(
      `Journal entry is unbalanced: debits=${totalDebits} credits=${totalCredits}`,
    );
  }

  const lines = entries.map((entry, idx) => {
    const isDebit = entry.debitCents > 0;
    const amount = isDebit ? entry.debitCents / 100 : entry.creditCents / 100;

    return {
      LineNum: idx + 1,
      Amount: amount,
      DetailType: "JournalEntryLineDetail",
      Description: entry.description,
      JournalEntryLineDetail: {
        PostingType: isDebit ? "Debit" : "Credit",
        AccountRef: { value: entry.accountId },
      },
    };
  });

  const journalData = {
    TxnDate: new Date().toISOString().split("T")[0],
    Line: lines,
    PrivateNote: `Helm auto-posted journal entry for tenant ${tenantId}`,
  };

  const result = await qboRequest(
    tenantId,
    "POST",
    "journalentry?minorversion=73",
    journalData,
  );

  await auditLog(tenantId, "QBO_JOURNAL_ENTRY_CREATED", {
    qboJournalEntryId: result.JournalEntry.Id,
    totalAmount: totalDebits / 100,
    lineCount: entries.length,
  });
}

// --------------------------------------------------------------------------
// Full Sync
// --------------------------------------------------------------------------

export async function syncAll(
  tenantId: string,
): Promise<{ synced: number; failed: number }> {
  let synced = 0;
  let failed = 0;
  const BATCH_SIZE = 50;

  await auditLog(tenantId, "QBO_FULL_SYNC_STARTED", {});

  // 1. Sync all customers
  const customers = await prisma.customer.findMany({
    where: { tenantId },
    select: { id: true },
    orderBy: { createdAt: "asc" },
  });

  for (let i = 0; i < customers.length; i += BATCH_SIZE) {
    const batch = customers.slice(i, i + BATCH_SIZE);
    const results = await Promise.allSettled(
      batch.map((c) => syncCustomer(c.id, tenantId)),
    );

    for (const r of results) {
      if (r.status === "fulfilled") synced++;
      else {
        failed++;
        console.error("[qbo-sync] Customer sync failed", r.reason);
      }
    }
  }

  // 2. Sync all invoices
  const invoices = await prisma.invoice.findMany({
    where: { tenantId },
    select: { id: true },
    orderBy: { createdAt: "asc" },
  });

  for (let i = 0; i < invoices.length; i += BATCH_SIZE) {
    const batch = invoices.slice(i, i + BATCH_SIZE);
    const results = await Promise.allSettled(
      batch.map((inv) => syncInvoice(inv.id, tenantId)),
    );

    for (const r of results) {
      if (r.status === "fulfilled") synced++;
      else {
        failed++;
        console.error("[qbo-sync] Invoice sync failed", r.reason);
      }
    }
  }

  // 3. Sync all completed payments
  const payments = await prisma.payment.findMany({
    where: { tenantId, status: "COMPLETED" },
    select: { id: true },
    orderBy: { createdAt: "asc" },
  });

  for (let i = 0; i < payments.length; i += BATCH_SIZE) {
    const batch = payments.slice(i, i + BATCH_SIZE);
    const results = await Promise.allSettled(
      batch.map((p) => syncPayment(p.id, tenantId)),
    );

    for (const r of results) {
      if (r.status === "fulfilled") synced++;
      else {
        failed++;
        console.error("[qbo-sync] Payment sync failed", r.reason);
      }
    }
  }

  await auditLog(tenantId, "QBO_FULL_SYNC_COMPLETED", { synced, failed });

  // Update last sync timestamp
  await prisma.tenant.update({
    where: { id: tenantId },
    data: { qboLastSyncAt: new Date() } as any,
  });

  return { synced, failed };
}

// --------------------------------------------------------------------------
// Webhook Handler
// --------------------------------------------------------------------------
//
// Resolves the incoming realmId to either a tenant-level connection or a
// per-location connection (since each marina property files its own books
// and so has its own QBO realm). Then dispatches per-entity handlers that
// fetch the changed QBO record and upsert it into Helm.
// --------------------------------------------------------------------------

async function resolveWebhookContext(realmId: string): Promise<QboCredentialContext | null> {
  // Prefer location-level — per-location QBO is the standard configuration.
  const location = await prisma.location.findFirst({
    where: { qboRealmId: realmId } as any,
    select: { id: true, tenantId: true } as any,
  });
  if (location) {
    return { tenantId: (location as any).tenantId, locationId: (location as any).id };
  }
  const tenant = await prisma.tenant.findFirst({
    where: { qboRealmId: realmId } as any,
    select: { id: true },
  });
  if (tenant) {
    return { tenantId: tenant.id };
  }
  return null;
}

export async function handleQboWebhook(
  payload: any,
  _tenantId?: string,
): Promise<void> {
  if (!payload?.eventNotifications) return;

  // Collect per-entity processing errors so the webhook receiver can mark
  // the persisted delivery row as FAILED. We deliberately keep the
  // per-entity try/catch so a single bad entity does not block the rest of
  // the batch — but we surface the failures by throwing an aggregated error
  // at the end of the dispatch.
  const errors: string[] = [];

  for (const notification of payload.eventNotifications) {
    const realmId = notification.realmId;
    const ctx = await resolveWebhookContext(realmId);

    if (!ctx) {
      console.warn("[qbo-sync] Unknown realmId in webhook", { realmId });
      continue;
    }

    const effectiveTenantId = ctx.tenantId;
    const effectiveLocationId = ctx.locationId ?? null;

    for (const entity of notification.dataChangeEvent?.entities || []) {
      const { name, id, operation } = entity;

      try {
        if (name === "Customer" && (operation === "Create" || operation === "Update")) {
          const qboCustomer = await qboRequest(ctx, "GET", `customer/${id}?minorversion=73`);
          const customer = qboCustomer.Customer;
          const existing = await prisma.customer.findFirst({
            where: { tenantId: effectiveTenantId, qboCustomerId: id } as any,
          });

          if (existing) {
            await prisma.customer.update({
              where: { id: existing.id },
              data: {
                firstName: customer.GivenName || existing.firstName,
                lastName: customer.FamilyName || existing.lastName,
                email: customer.PrimaryEmailAddr?.Address || existing.email,
                phone: customer.PrimaryPhone?.FreeFormNumber || existing.phone,
              },
            });

            await auditLog(effectiveTenantId, "QBO_WEBHOOK_CUSTOMER_UPDATED", {
              customerId: existing.id,
              qboCustomerId: id,
              operation,
              locationId: effectiveLocationId,
              realmId,
            });
          }
        }

        if (name === "Invoice" && operation === "Update") {
          const qboInvoice = await qboRequest(ctx, "GET", `invoice/${id}?minorversion=73`);
          const invoice = qboInvoice.Invoice;
          const existing = await prisma.invoice.findFirst({
            where: { tenantId: effectiveTenantId, qboInvoiceId: id } as any,
          });

          if (existing) {
            const balance = Math.round((invoice.Balance ?? 0) * 100);
            await prisma.invoice.update({
              where: { id: existing.id },
              data: {
                balanceCents: balance,
                status: balance <= 0 ? "PAID" : (existing as any).status,
              },
            });

            await auditLog(effectiveTenantId, "QBO_WEBHOOK_INVOICE_UPDATED", {
              invoiceId: existing.id,
              qboInvoiceId: id,
              newBalance: balance,
              locationId: effectiveLocationId,
              realmId,
            });
          }
        }

        if (name === "Payment" && operation === "Create") {
          await auditLog(effectiveTenantId, "QBO_WEBHOOK_PAYMENT_RECEIVED", {
            qboPaymentId: id,
            operation,
            locationId: effectiveLocationId,
            realmId,
          });
        }

        // ── Vendor pulled back from QBO ──────────────────────────────────
        if (name === "Vendor" && (operation === "Create" || operation === "Update")) {
          const qboVendor = await qboRequest(ctx, "GET", `vendor/${id}?minorversion=73`);
          await applyQboVendor(effectiveTenantId, ctx.locationId ?? null, qboVendor.Vendor, "webhook");
        }

        // ── Bill pulled back from QBO ────────────────────────────────────
        if (name === "Bill" && (operation === "Create" || operation === "Update")) {
          const qboBill = await qboRequest(ctx, "GET", `bill/${id}?minorversion=73`);
          await applyQboBill(effectiveTenantId, ctx.locationId ?? null, qboBill.Bill, "webhook");
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        errors.push(`${name}/${operation}/${id}: ${message}`);
        console.error("[qbo-sync] Webhook entity processing failed", {
          name,
          id,
          operation,
          locationId: effectiveLocationId,
          error: err,
        });
      }
    }
  }

  if (errors.length > 0) {
    throw new Error(
      `QBO webhook dispatch had ${errors.length} entity failure(s): ${errors.join("; ")}`,
    );
  }
}

// --------------------------------------------------------------------------
// Disconnect
// --------------------------------------------------------------------------

export async function disconnect(tenantId: string): Promise<void> {
  await prisma.tenant.update({
    where: { id: tenantId },
    data: {
      qboAccessToken: null,
      qboRefreshToken: null,
      qboRealmId: null,
      qboTokenExpiresAt: null,
    } as any,
  });

  await auditLog(tenantId, "QBO_DISCONNECTED", { reason: "manual_disconnect" });
}

// --------------------------------------------------------------------------
// Status
// --------------------------------------------------------------------------

export async function getStatus(
  tenantId: string,
): Promise<{
  connected: boolean;
  realmId: string | null;
  lastSyncAt: Date | null;
  tokenExpiresAt: Date | null;
}> {
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: {
      qboRealmId: true,
      qboTokenExpiresAt: true,
      qboLastSyncAt: true,
      qboAccessToken: true,
    } as any,
  });

  return {
    connected: !!(tenant as any)?.qboAccessToken,
    realmId: (tenant as any)?.qboRealmId || null,
    lastSyncAt: (tenant as any)?.qboLastSyncAt || null,
    tokenExpiresAt: (tenant as any)?.qboTokenExpiresAt || null,
  };
}

// ===========================================================================
// Per-location QBO connection status
// ---------------------------------------------------------------------------
// Returns one row per Location for the tenant, indicating connection state
// and the last chart-of-accounts pull. Used by the QuickBooks Setup page.
// ===========================================================================

export interface LocationQboStatus {
  locationId: string;
  locationName: string;
  connected: boolean;
  realmId: string | null;
  companyName: string | null;
  tokenExpiresAt: Date | null;
  connectedAt: Date | null;
  lastChartOfAccountsSyncAt: Date | null;
  glAccountCount: number;
}

export async function getLocationsQboStatus(
  tenantId: string,
): Promise<LocationQboStatus[]> {
  const locations = await prisma.location.findMany({
    where: { tenantId },
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      qboAccessToken: true,
      qboRealmId: true,
      qboCompanyName: true,
      qboTokenExpiresAt: true,
      qboConnectedAt: true,
      qboLastChartOfAccountsSyncAt: true,
    },
  });

  const counts = await prisma.glAccount.groupBy({
    by: ["locationId"],
    where: { tenantId, locationId: { not: null }, isActive: true },
    _count: { _all: true },
  });
  const countByLoc = new Map<string, number>();
  for (const c of counts) {
    if (c.locationId) countByLoc.set(c.locationId, c._count._all);
  }

  return locations.map((l) => ({
    locationId: l.id,
    locationName: l.name,
    connected: !!l.qboAccessToken && !!l.qboRealmId,
    realmId: l.qboRealmId ?? null,
    companyName: l.qboCompanyName ?? null,
    tokenExpiresAt: l.qboTokenExpiresAt ?? null,
    connectedAt: l.qboConnectedAt ?? null,
    lastChartOfAccountsSyncAt: l.qboLastChartOfAccountsSyncAt ?? null,
    glAccountCount: countByLoc.get(l.id) ?? 0,
  }));
}

// ===========================================================================
// Chart of Accounts pull — one location at a time
// ---------------------------------------------------------------------------
// Pages QuickBooks `Account` records and upserts them into GlAccount rows
// scoped to the location. Existing QBO-sourced accounts that disappear (or
// that QBO marks Active=false) are flipped to isActive=false; they are not
// deleted because they may still be referenced from historical mappings.
// ===========================================================================

interface QboAccountPayload {
  Id: string;
  Name?: string;
  AcctNum?: string;
  AccountType?: string;
  AccountSubType?: string;
  Active?: boolean;
  MetaData?: { LastUpdatedTime?: string };
}

function mapQboAccountType(t?: string): GLAccountType {
  if (!t) return GLAccountType.ASSET;
  const v = t.toLowerCase();
  if (v.includes("revenue") || v.includes("income")) return GLAccountType.REVENUE;
  if (v.includes("expense") || v.includes("cost of goods")) return GLAccountType.EXPENSE;
  if (v.includes("liability") || v.includes("payable") || v.includes("credit card"))
    return GLAccountType.LIABILITY;
  if (v.includes("equity")) return GLAccountType.EQUITY;
  return GLAccountType.ASSET;
}

export interface ChartOfAccountsPullResult {
  pulled: number;
  created: number;
  updated: number;
  deactivated: number;
  total: number;
}

export async function pullChartOfAccountsForLocation(
  locationId: string,
  tenantId: string,
): Promise<ChartOfAccountsPullResult> {
  const location = await prisma.location.findFirst({
    where: { id: locationId, tenantId },
    select: { id: true, qboAccessToken: true, qboRealmId: true },
  });
  if (!location) {
    throw new Error(`Location ${locationId} not found for tenant ${tenantId}`);
  }
  if (!location.qboAccessToken || !location.qboRealmId) {
    throw new Error(
      `Location ${locationId} is not connected to QuickBooks. Connect it on the QuickBooks Setup page first.`,
    );
  }

  const ctx: QboCredentialContext = { tenantId, locationId };
  const startedAt = new Date();
  const result: ChartOfAccountsPullResult = {
    pulled: 0,
    created: 0,
    updated: 0,
    deactivated: 0,
    total: 0,
  };

  try {
    const rows = await queryQboPaged<QboAccountPayload>(
      ctx,
      "SELECT * FROM Account",
      "Account",
    );
    result.pulled = rows.length;

    const seenQboIds = new Set<string>();

    for (const a of rows) {
      const qboId = String(a.Id);
      seenQboIds.add(qboId);
      const isActive = a.Active !== false;
      const existing = await prisma.glAccount.findFirst({
        where: { tenantId, locationId, qboAccountId: qboId },
        select: { id: true },
      });
      const accountNumber = (a.AcctNum && a.AcctNum.trim()) || `QBO-${qboId}`;
      const data = {
        accountNumber,
        name: (a.Name ?? "Unnamed").slice(0, 200),
        type: mapQboAccountType(a.AccountType),
        subType: a.AccountSubType ?? null,
        qboAccountId: qboId,
        source: GlAccountSource.QBO,
        // Mirror both columns so legacy filters keep working alongside
        // the new isActive-aware ones (see settings.ts schema comment).
        isActive,
        active: isActive,
      };
      if (existing) {
        await prisma.glAccount.update({
          where: { id: existing.id },
          data,
        });
        result.updated++;
      } else {
        try {
          await prisma.glAccount.create({
            data: { tenantId, locationId, ...data },
          });
          result.created++;
        } catch (err) {
          // Unique conflict on (tenantId, locationId, accountNumber) — likely
          // an earlier MANUAL row with the same number. Re-bind it to QBO.
          const conflict = await prisma.glAccount.findFirst({
            where: { tenantId, locationId, accountNumber },
            select: { id: true },
          });
          if (conflict) {
            await prisma.glAccount.update({
              where: { id: conflict.id },
              data,
            });
            result.updated++;
          } else {
            throw err;
          }
        }
      }
    }

    // Mark any QBO-sourced rows we didn't see this pull as inactive.
    const stale = await prisma.glAccount.findMany({
      where: {
        tenantId,
        locationId,
        source: GlAccountSource.QBO,
        isActive: true,
        qboAccountId: { notIn: Array.from(seenQboIds) },
      },
      select: { id: true },
    });
    if (stale.length > 0) {
      await prisma.glAccount.updateMany({
        where: { id: { in: stale.map((s) => s.id) } },
        data: { isActive: false, active: false },
      });
      result.deactivated = stale.length;
    }

    result.total = await prisma.glAccount.count({
      where: { tenantId, locationId, isActive: true },
    });

    await prisma.location.update({
      where: { id: locationId },
      data: { qboLastChartOfAccountsSyncAt: startedAt },
    });

    await auditLog(tenantId, "QBO_CHART_OF_ACCOUNTS_PULLED", {
      locationId,
      counts: result,
    });

    return result;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await auditLog(tenantId, "QBO_CHART_OF_ACCOUNTS_PULL_FAILED", {
      locationId,
      error: msg,
    });
    throw err;
  }
}

// ===========================================================================
// Inventory sync — Items, Bills, COGS, Adjustments
// ---------------------------------------------------------------------------
// Pushes inventory-tracked Products to QBO as Inventory Items, creates Bills
// from received Purchase Orders, and posts journal entries for adjustments
// (count corrections, damage, shrinkage). Uses per-location QBO credentials
// when a location is provided, mirroring the customer/invoice/payment paths.
// ===========================================================================

export interface InventoryItemSyncInput {
  productId: string;
  name: string;
  sku?: string | null;
  description?: string | null;
  priceCents: number;
  costCents: number;
  qoh?: number;
  // When true → sync as QBO `Type: "Inventory"` (requires Income, Inventory
  // Asset, and COGS accounts, plus QtyOnHand/InvStartDate). When false → sync
  // as `Type: "Service"` (only requires Income; the asset/COGS plumbing is
  // skipped entirely so dockage add-ons / fee-style products don't get
  // rejected with QBO error 6430).
  trackInventory: boolean;
  // Local GlAccount IDs — translated to QBO account IDs at push time.
  // For service items only `incomeGlAccountId` is required; the inventory
  // asset / COGS slots are ignored.
  incomeGlAccountId: string | null;
  inventoryAssetGlAccountId: string | null;
  cogsGlAccountId: string | null;
}

export interface VendorSyncInput {
  vendorId: string;
  name: string;
  email?: string | null;
  phone?: string | null;
  address?: string | null;
}

export interface PoBillLineInput {
  // Local product id — we look up its synced qboItemId via the sync-ref table.
  productId: string;
  productName: string;
  receivedQty: number;
  unitCostCents: number;
}

export interface PoBillSyncInput {
  // The local Purchase Order id (used as sync-ref key + Bill PrivateNote).
  purchaseOrderId: string;
  poNumber: string;
  vendorId: string | null;
  expectedDate?: Date | null;
  // Lines to bill in this push (typically lines whose receivedQty > previously billed qty).
  lines: PoBillLineInput[];
  /** When true, push even if a qboBillId already exists (creates an additional Bill). */
  forcePush?: boolean;
}

export interface AdjustmentJournalSyncInput {
  // Local adjustment id (sync-ref key + JE PrivateNote).
  adjustmentId: string;
  productId: string;
  productName: string;
  reason: "damaged" | "shrinkage" | "count" | "return" | string;
  // Quantity delta (positive = added to inventory, negative = removed).
  quantityChange: number;
  unitCostCents: number;
  /** Local GL accounts on the affected product. Required to post JE. */
  inventoryAssetGlAccountId: string | null;
  cogsGlAccountId: string | null;
  notes?: string | null;
}

interface SyncRefRow {
  qboId: string | null;
  lastSyncedAt: Date | null;
  lastError: string | null;
  lastErrorAt: Date | null;
}

// ---------------------------------------------------------------------------
// SyncRef helpers — read/write the qbo_inventory_sync_refs table
// ---------------------------------------------------------------------------

async function readSyncRef(
  tenantId: string,
  sourceType: string,
  sourceId: string,
): Promise<SyncRefRow | null> {
  const ref = await (prisma as any).qboInventorySyncRef.findUnique({
    where: { tenantId_sourceType_sourceId: { tenantId, sourceType, sourceId } },
  });
  if (!ref) return null;
  return {
    qboId: ref.qboId ?? null,
    lastSyncedAt: ref.lastSyncedAt ?? null,
    lastError: ref.lastError ?? null,
    lastErrorAt: ref.lastErrorAt ?? null,
  };
}

async function writeSyncRefSuccess(
  tenantId: string,
  sourceType: string,
  sourceId: string,
  qboType: string,
  qboId: string,
  locationId?: string | null,
): Promise<void> {
  const now = new Date();
  await (prisma as any).qboInventorySyncRef.upsert({
    where: { tenantId_sourceType_sourceId: { tenantId, sourceType, sourceId } },
    create: {
      tenantId,
      locationId: locationId ?? null,
      sourceType,
      sourceId,
      qboType,
      qboId,
      lastSyncedAt: now,
      lastError: null,
      lastErrorAt: null,
      retryCount: 0,
      nextRetryAt: null,
    },
    update: {
      qboType,
      qboId,
      locationId: locationId ?? null,
      lastSyncedAt: now,
      lastError: null,
      lastErrorAt: null,
      retryCount: 0,
      nextRetryAt: null,
    },
  });
}

// Exponential backoff for repeated sync failures. The background sweep runs
// every 15 minutes, so the first delay aligns with the next sweep tick. Caps
// at 24h so a permanently broken record stops hammering QuickBooks but still
// gets a daily attempt in case the upstream issue (e.g. GL mapping) was fixed.
//
// retryCount=1 → 15m, 2 → 30m, 3 → 1h, 4 → 2h, 5 → 4h, 6 → 8h, 7 → 16h, 8+ → 24h
export function computeRetryBackoffMs(retryCount: number): number {
  const safeCount = Math.max(1, retryCount);
  const minutes = Math.min(15 * Math.pow(2, safeCount - 1), 24 * 60);
  return minutes * 60 * 1000;
}

async function writeSyncRefFailure(
  tenantId: string,
  sourceType: string,
  sourceId: string,
  qboType: string,
  errorMessage: string,
  locationId?: string | null,
): Promise<void> {
  const now = new Date();
  const errSlice = errorMessage.slice(0, 1000);
  const where = { tenantId_sourceType_sourceId: { tenantId, sourceType, sourceId } };

  // Probe-first to avoid Prisma's noisy `prisma:error` log on the expected
  // first-failure case (P2025 from update-of-missing-row). The tiny TOCTOU
  // race with a concurrent create is handled by catching P2002 below.
  const existing = await (prisma as any).qboInventorySyncRef.findUnique({
    where,
    select: { id: true },
  });

  if (!existing) {
    const nextRetryAt = new Date(now.getTime() + computeRetryBackoffMs(1));
    try {
      await (prisma as any).qboInventorySyncRef.create({
        data: {
          tenantId,
          locationId: locationId ?? null,
          sourceType,
          sourceId,
          qboType,
          qboId: null,
          lastError: errSlice,
          lastErrorAt: now,
          retryCount: 1,
          nextRetryAt,
        },
      });
      return;
    } catch (err: any) {
      // P2002 = unique constraint — a concurrent failure already created the
      // row. Fall through to the increment path.
      if (err?.code !== 'P2002') throw err;
    }
  }

  // Atomic-increment path. Use Prisma's `increment` operator so concurrent
  // failure writes don't undercount via a read-modify-write race. The second
  // update (setting nextRetryAt) is intentionally outside any P2025 catch so
  // a missing row here can never silently trigger a duplicate `create`.
  const incremented = await (prisma as any).qboInventorySyncRef.update({
    where,
    data: {
      qboType,
      locationId: locationId ?? null,
      lastError: errSlice,
      lastErrorAt: now,
      retryCount: { increment: 1 },
    },
    select: { retryCount: true },
  });
  const nextRetryAt = new Date(now.getTime() + computeRetryBackoffMs(incremented.retryCount));
  await (prisma as any).qboInventorySyncRef.update({
    where,
    data: { nextRetryAt },
  });
}

// Translate a local GlAccount.id to its QBO account id (qboAccountId column).
// Throws a descriptive error if the local account is missing or has not yet
// been synced to QBO. This is the most common cause of inventory sync failures.
async function resolveQboAccountId(
  tenantId: string,
  localGlAccountId: string | null | undefined,
  purpose: string,
): Promise<string> {
  if (!localGlAccountId) {
    throw new Error(`Missing GL account for ${purpose}. Configure it on the product or in Settings > Chart of Accounts.`);
  }
  const account = await prisma.glAccount.findFirst({
    where: { id: localGlAccountId, tenantId },
    select: { id: true, qboAccountId: true, name: true, accountNumber: true },
  });
  if (!account) {
    throw new Error(`GL account ${localGlAccountId} not found for ${purpose}`);
  }
  if (!account.qboAccountId) {
    throw new Error(
      `GL account ${account.accountNumber} ${account.name} for ${purpose} is not linked to a QuickBooks account. Open Chart of Accounts and map it to QBO before syncing inventory.`,
    );
  }
  return account.qboAccountId;
}

// ---------------------------------------------------------------------------
// Inventory Item sync (Product → QBO Item)
// ---------------------------------------------------------------------------

export async function syncInventoryItem(
  input: InventoryItemSyncInput,
  tenantId: string,
  locationId?: string | null,
): Promise<{ qboItemId: string }> {
  const ctx = await resolveQboContext(tenantId, locationId ?? undefined);
  const sourceType = "product";

  try {
    const desiredType = input.trackInventory ? "Inventory" : "Service";
    const incomePurpose = input.trackInventory ? "Income" : `Income (Service item "${input.name}")`;

    const incomeAcctRef = await resolveQboAccountId(tenantId, input.incomeGlAccountId, incomePurpose);
    let assetAcctRef: string | null = null;
    let cogsAcctRef: string | null = null;
    if (input.trackInventory) {
      assetAcctRef = await resolveQboAccountId(tenantId, input.inventoryAssetGlAccountId, "Inventory Asset");
      cogsAcctRef = await resolveQboAccountId(tenantId, input.cogsGlAccountId, "Cost of Goods Sold");
    }

    let existingRef = await readSyncRef(tenantId, sourceType, input.productId);

    // Detect tracked↔non-tracked flips by reading the existing QBO Item's
    // Type. QBO does not allow `Type` changes on Item updates, so when the
    // local product flips between tracked/untracked we must abandon the old
    // QBO Item and create a fresh one of the correct type.
    let cachedSyncToken: string | undefined;
    if (existingRef?.qboId) {
      const existingQboId = existingRef.qboId;
      try {
        const existingItem = await qboRequest(ctx, "GET", `item/${existingQboId}?minorversion=73`);
        const existingType = existingItem?.Item?.Type as string | undefined;
        cachedSyncToken = existingItem?.Item?.SyncToken as string | undefined;
        if (existingType && existingType !== desiredType) {
          await auditLog(tenantId, "QBO_INVENTORY_ITEM_TYPE_FLIP", {
            productId: input.productId,
            previousQboItemId: existingRef.qboId,
            previousType: existingType,
            newType: desiredType,
            reason: "trackInventory flipped — QBO does not allow Item Type changes; creating a new Item",
            locationId: ctx.locationId ?? null,
          });
          await (prisma as any).qboInventorySyncRef.update({
            where: { tenantId_sourceType_sourceId: { tenantId, sourceType, sourceId: input.productId } },
            data: { qboId: null },
          });
          existingRef = null;
          cachedSyncToken = undefined;
        }
      } catch (lookupErr) {
        // Only treat "definitely gone from QBO" responses as stale — i.e. an
        // HTTP 404, or QBO's specific "Object Not Found" error code 610.
        // Transient failures (5xx, network errors, 401 between refreshes,
        // etc.) must NOT invalidate the ref or we'd create duplicate Items
        // in QBO every time the upstream hiccups.
        const msg = lookupErr instanceof Error ? lookupErr.message : String(lookupErr);
        const isMissing =
          /QBO API error 404\b/.test(msg) ||
          /"code":\s*"?610"?/.test(msg) ||
          /Object Not Found/i.test(msg);
        if (!isMissing) {
          // Re-throw so writeSyncRefFailure / the outer catch records the
          // failure and the next retry will try again with the same ref.
          throw lookupErr;
        }
        console.warn(
          `[qbo-sync] Existing QBO Item ${existingQboId} for product ${input.productId} no longer exists in QBO; creating a new one: ${msg}`,
        );
        await (prisma as any).qboInventorySyncRef.update({
          where: { tenantId_sourceType_sourceId: { tenantId, sourceType, sourceId: input.productId } },
          data: { qboId: null },
        });
        existingRef = null;
        cachedSyncToken = undefined;
      }
    }

    const qboPayload: Record<string, unknown> = {
      Name: input.name.slice(0, 100),
      Sku: input.sku ?? undefined,
      Description: input.description ?? undefined,
      Type: desiredType,
      UnitPrice: input.priceCents / 100,
      IncomeAccountRef: { value: incomeAcctRef },
    };

    if (input.trackInventory) {
      qboPayload.TrackQtyOnHand = true;
      qboPayload.QtyOnHand = input.qoh ?? 0;
      qboPayload.InvStartDate = new Date().toISOString().split("T")[0];
      qboPayload.PurchaseCost = input.costCents / 100;
      qboPayload.AssetAccountRef = { value: assetAcctRef };
      qboPayload.ExpenseAccountRef = { value: cogsAcctRef };
    }

    let result: any;
    if (existingRef?.qboId) {
      // Update — QBO requires SyncToken on every update. Reuse the token
      // fetched during the type-flip probe above when available.
      let syncToken = cachedSyncToken;
      if (!syncToken) {
        const existing = await qboRequest(ctx, "GET", `item/${existingRef.qboId}?minorversion=73`);
        syncToken = existing.Item.SyncToken;
      }
      qboPayload.Id = existingRef.qboId;
      qboPayload.SyncToken = syncToken;
      qboPayload.sparse = true;
      // Don't reset QtyOnHand on updates — let receiving Bills / adjustments drive it.
      delete qboPayload.QtyOnHand;
      delete qboPayload.InvStartDate;
      result = await qboRequest(ctx, "POST", "item?minorversion=73", qboPayload);
    } else {
      result = await qboRequest(ctx, "POST", "item?minorversion=73", qboPayload);
    }

    const qboItemId = result.Item.Id as string;

    await writeSyncRefSuccess(tenantId, sourceType, input.productId, "Item", qboItemId, ctx.locationId);

    // Mirror onto Product row if one exists (best effort — product may live only in-memory).
    try {
      await prisma.product.updateMany({
        where: { id: input.productId, tenantId },
        data: {
          qboItemId,
          qboItemSyncedAt: new Date(),
          qboItemSyncError: null,
          qboItemSyncErrorAt: null,
        } as any,
      });
    } catch {
      // Product row doesn't exist (in-memory only) — sync-ref table holds state.
    }

    await auditLog(tenantId, "QBO_INVENTORY_ITEM_SYNCED", {
      productId: input.productId,
      qboItemId,
      locationId: ctx.locationId ?? null,
    });

    return { qboItemId };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await writeSyncRefFailure(tenantId, sourceType, input.productId, "Item", msg, locationId);
    try {
      await prisma.product.updateMany({
        where: { id: input.productId, tenantId },
        data: { qboItemSyncError: msg.slice(0, 1000), qboItemSyncErrorAt: new Date() } as any,
      });
    } catch { /* ignore */ }
    await auditLog(tenantId, "QBO_INVENTORY_ITEM_SYNC_FAILED", {
      productId: input.productId,
      error: msg,
      locationId: locationId ?? null,
    });
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Vendor sync (Vendor → QBO Vendor)
// ---------------------------------------------------------------------------

export async function syncVendor(
  input: VendorSyncInput,
  tenantId: string,
  locationId?: string | null,
): Promise<{ qboVendorId: string }> {
  const ctx = await resolveQboContext(tenantId, locationId ?? undefined);
  const sourceType = "vendor";

  try {
    const existing = await prisma.vendor.findFirst({
      where: { id: input.vendorId, tenantId },
      select: { qboVendorId: true },
    } as any);

    const payload: Record<string, unknown> = {
      DisplayName: input.name.slice(0, 100),
      CompanyName: input.name.slice(0, 100),
      PrimaryEmailAddr: input.email ? { Address: input.email } : undefined,
      PrimaryPhone: input.phone ? { FreeFormNumber: input.phone } : undefined,
      BillAddr: input.address ? { Line1: input.address } : undefined,
    };

    let result: any;
    const existingQboId = (existing as any)?.qboVendorId as string | null | undefined;
    if (existingQboId) {
      const fetched = await qboRequest(ctx, "GET", `vendor/${existingQboId}?minorversion=73`);
      payload.Id = existingQboId;
      payload.SyncToken = fetched.Vendor.SyncToken;
      payload.sparse = true;
      result = await qboRequest(ctx, "POST", "vendor?minorversion=73", payload);
    } else {
      result = await qboRequest(ctx, "POST", "vendor?minorversion=73", payload);
    }

    const qboVendorId = result.Vendor.Id as string;
    const now = new Date();

    await prisma.vendor.update({
      where: { id: input.vendorId },
      data: {
        qboVendorId,
        qboVendorSyncedAt: now,
        qboVendorSyncError: null,
        qboVendorSyncErrorAt: null,
      } as any,
    });

    await writeSyncRefSuccess(tenantId, sourceType, input.vendorId, "Vendor", qboVendorId, ctx.locationId);

    await auditLog(tenantId, "QBO_VENDOR_SYNCED", {
      vendorId: input.vendorId,
      qboVendorId,
      locationId: ctx.locationId ?? null,
    });

    return { qboVendorId };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    try {
      await prisma.vendor.update({
        where: { id: input.vendorId },
        data: { qboVendorSyncError: msg.slice(0, 1000), qboVendorSyncErrorAt: new Date() } as any,
      });
    } catch { /* ignore */ }
    await writeSyncRefFailure(tenantId, sourceType, input.vendorId, "Vendor", msg, locationId);
    await auditLog(tenantId, "QBO_VENDOR_SYNC_FAILED", {
      vendorId: input.vendorId,
      error: msg,
      locationId: locationId ?? null,
    });
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Receiving → QBO Bill
// ---------------------------------------------------------------------------

export async function syncReceivingBill(
  input: PoBillSyncInput,
  tenantId: string,
  locationId?: string | null,
): Promise<{ qboBillId: string; created: boolean }> {
  const ctx = await resolveQboContext(tenantId, locationId ?? undefined);
  const sourceType = "purchase_order";

  // Idempotency: if we already pushed a Bill for this PO and caller didn't ask
  // for a force-push, return the existing reference instead of duplicating.
  const existingRef = await readSyncRef(tenantId, sourceType, input.purchaseOrderId);
  if (existingRef?.qboId && !input.forcePush) {
    return { qboBillId: existingRef.qboId, created: false };
  }

  try {
    if (!input.lines.length) {
      throw new Error("No lines to bill — nothing has been received yet");
    }
    if (!input.vendorId) {
      throw new Error(`Purchase order ${input.poNumber} has no vendor — cannot create QBO Bill`);
    }

    // Look up vendor's qboVendorId (sync if necessary)
    const vendor = await prisma.vendor.findFirst({
      where: { id: input.vendorId, tenantId },
    } as any);
    if (!vendor) {
      throw new Error(`Vendor ${input.vendorId} not found`);
    }
    let qboVendorId = (vendor as any).qboVendorId as string | null;
    if (!qboVendorId) {
      const synced = await syncVendor(
        {
          vendorId: vendor.id,
          name: (vendor as any).name,
          email: (vendor as any).email,
          phone: (vendor as any).phone,
          address: (vendor as any).address,
        },
        tenantId,
        ctx.locationId,
      );
      qboVendorId = synced.qboVendorId;
    }

    // For each line, look up the synced qboItemId via sync-ref. If missing,
    // surface a clear error rather than silently dropping the line.
    const billLines: Record<string, unknown>[] = [];
    for (const line of input.lines) {
      const itemRef = await readSyncRef(tenantId, "product", line.productId);
      if (!itemRef?.qboId) {
        throw new Error(
          `Product ${line.productName} (${line.productId}) has not been synced to QBO yet — cannot include on Bill`,
        );
      }
      const amountCents = line.unitCostCents * line.receivedQty;
      billLines.push({
        DetailType: "ItemBasedExpenseLineDetail",
        Amount: amountCents / 100,
        Description: `${line.productName} — ${line.receivedQty} @ ${(line.unitCostCents / 100).toFixed(2)}`,
        ItemBasedExpenseLineDetail: {
          ItemRef: { value: itemRef.qboId },
          Qty: line.receivedQty,
          UnitPrice: line.unitCostCents / 100,
          BillableStatus: "NotBillable",
        },
      });
    }

    const payload: Record<string, unknown> = {
      VendorRef: { value: qboVendorId },
      TxnDate: new Date().toISOString().split("T")[0],
      DueDate: input.expectedDate
        ? input.expectedDate.toISOString().split("T")[0]
        : undefined,
      DocNumber: input.poNumber.slice(0, 21),
      PrivateNote: `Helm PO ${input.poNumber}`,
      Line: billLines,
    };

    const result = await qboRequest(ctx, "POST", "bill?minorversion=73", payload);
    const qboBillId = result.Bill.Id as string;

    await writeSyncRefSuccess(tenantId, sourceType, input.purchaseOrderId, "Bill", qboBillId, ctx.locationId);

    // Mirror onto PurchaseOrder if it exists in DB
    try {
      await prisma.purchaseOrder.updateMany({
        where: { id: input.purchaseOrderId, tenantId },
        data: {
          qboBillId,
          qboBillSyncedAt: new Date(),
          qboBillSyncError: null,
          qboBillSyncErrorAt: null,
        } as any,
      });
    } catch {
      // PO doesn't exist in DB (in-memory only) — sync-ref holds state.
    }

    await auditLog(tenantId, "QBO_RECEIVING_BILL_SYNCED", {
      purchaseOrderId: input.purchaseOrderId,
      poNumber: input.poNumber,
      qboBillId,
      lineCount: billLines.length,
      locationId: ctx.locationId ?? null,
    });

    return { qboBillId, created: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await writeSyncRefFailure(tenantId, sourceType, input.purchaseOrderId, "Bill", msg, locationId);
    try {
      await prisma.purchaseOrder.updateMany({
        where: { id: input.purchaseOrderId, tenantId },
        data: { qboBillSyncError: msg.slice(0, 1000), qboBillSyncErrorAt: new Date() } as any,
      });
    } catch { /* ignore */ }
    await auditLog(tenantId, "QBO_RECEIVING_BILL_SYNC_FAILED", {
      purchaseOrderId: input.purchaseOrderId,
      poNumber: input.poNumber,
      error: msg,
      locationId: locationId ?? null,
    });
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Inventory adjustment → QBO Journal Entry
// ---------------------------------------------------------------------------
//
// Reasons we post a JE for (and the direction of the entry):
//   - damaged / shrinkage / count(negative variance) / return-to-vendor:
//       inventory drops → DEBIT COGS (or shrinkage account) / CREDIT Inventory Asset
//   - count(positive variance) / found:
//       inventory increases → DEBIT Inventory Asset / CREDIT COGS (reversal)
// "received" adjustments are skipped here — those are posted via the Bill flow
// (the Bill itself increases Inventory Asset and creates AP).
// "sold" adjustments are skipped — COGS for sales is posted automatically by
// QBO when the Invoice / SalesReceipt line references an Inventory Item.
// ---------------------------------------------------------------------------

export async function postInventoryAdjustmentJournal(
  input: AdjustmentJournalSyncInput,
  tenantId: string,
  locationId?: string | null,
): Promise<{ qboJournalEntryId: string | null; skipped: boolean; reason?: string }> {
  const ctx = await resolveQboContext(tenantId, locationId ?? undefined);
  const sourceType = "inventory_adjustment";

  // Skip reasons handled by Bill / automatic-COGS paths
  if (input.reason === "received" || input.reason === "sold") {
    return { qboJournalEntryId: null, skipped: true, reason: `${input.reason}_handled_elsewhere` };
  }
  if (input.quantityChange === 0) {
    return { qboJournalEntryId: null, skipped: true, reason: "zero_qty_change" };
  }

  // Idempotency — if we've already posted a JE for this adjustment, return it
  const existingRef = await readSyncRef(tenantId, sourceType, input.adjustmentId);
  if (existingRef?.qboId) {
    return { qboJournalEntryId: existingRef.qboId, skipped: true, reason: "already_posted" };
  }

  try {
    const assetAcct = await resolveQboAccountId(tenantId, input.inventoryAssetGlAccountId, "Inventory Asset");
    const cogsAcct = await resolveQboAccountId(tenantId, input.cogsGlAccountId, "Cost of Goods Sold / Adjustment");

    const valueCents = Math.abs(input.quantityChange) * input.unitCostCents;
    if (valueCents === 0) {
      return { qboJournalEntryId: null, skipped: true, reason: "zero_value" };
    }

    // Negative qtyChange = inventory removed (damage/shrinkage/loss)
    //   debit COGS (expense up), credit Inventory Asset (asset down)
    // Positive qtyChange = inventory added back / count surplus
    //   debit Inventory Asset, credit COGS (reversal)
    const inventoryDecreasing = input.quantityChange < 0;
    const debitAccount = inventoryDecreasing ? cogsAcct : assetAcct;
    const creditAccount = inventoryDecreasing ? assetAcct : cogsAcct;

    const description = `Inventory ${input.reason} — ${input.productName} (${input.quantityChange})${input.notes ? ` — ${input.notes}` : ""}`.slice(0, 1000);

    const payload = {
      TxnDate: new Date().toISOString().split("T")[0],
      PrivateNote: `Helm inventory adjustment ${input.adjustmentId} (${input.reason})`,
      Line: [
        {
          LineNum: 1,
          Amount: valueCents / 100,
          DetailType: "JournalEntryLineDetail",
          Description: description,
          JournalEntryLineDetail: {
            PostingType: "Debit",
            AccountRef: { value: debitAccount },
          },
        },
        {
          LineNum: 2,
          Amount: valueCents / 100,
          DetailType: "JournalEntryLineDetail",
          Description: description,
          JournalEntryLineDetail: {
            PostingType: "Credit",
            AccountRef: { value: creditAccount },
          },
        },
      ],
    };

    const result = await qboRequest(ctx, "POST", "journalentry?minorversion=73", payload);
    const qboJournalEntryId = result.JournalEntry.Id as string;

    await writeSyncRefSuccess(
      tenantId,
      sourceType,
      input.adjustmentId,
      "JournalEntry",
      qboJournalEntryId,
      ctx.locationId,
    );

    await auditLog(tenantId, "QBO_INVENTORY_ADJUSTMENT_POSTED", {
      adjustmentId: input.adjustmentId,
      productId: input.productId,
      reason: input.reason,
      qboJournalEntryId,
      valueCents,
      locationId: ctx.locationId ?? null,
    });

    return { qboJournalEntryId, skipped: false };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await writeSyncRefFailure(tenantId, sourceType, input.adjustmentId, "JournalEntry", msg, locationId);
    await auditLog(tenantId, "QBO_INVENTORY_ADJUSTMENT_FAILED", {
      adjustmentId: input.adjustmentId,
      productId: input.productId,
      reason: input.reason,
      error: msg,
      locationId: locationId ?? null,
    });
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Void / refund — propagate to QBO so COGS posted via the auto-Item path is
// also reversed there. Best effort: callers should not block on these.
// ---------------------------------------------------------------------------

export async function voidQboInvoice(invoiceId: string, tenantId: string): Promise<void> {
  const invoice = await prisma.invoice.findFirst({
    where: { id: invoiceId, tenantId },
    select: { id: true, qboInvoiceId: true, locationId: true } as any,
  });
  if (!invoice || !(invoice as any).qboInvoiceId) {
    // Nothing to void — local invoice was never pushed to QBO.
    return;
  }
  const ctx = await resolveQboContext(tenantId, (invoice as any).locationId ?? undefined);
  const qboInvoiceId = (invoice as any).qboInvoiceId as string;

  try {
    // QBO operation=void marks the invoice as void (preserving history) and
    // reverses any auto-posted COGS for the line items.
    const existing = await qboRequest(ctx, "GET", `invoice/${qboInvoiceId}?minorversion=73`);
    const payload = {
      Id: qboInvoiceId,
      SyncToken: existing.Invoice.SyncToken,
    };
    await qboRequest(ctx, "POST", "invoice?operation=void&minorversion=73", payload);

    await auditLog(tenantId, "QBO_INVOICE_VOIDED", {
      invoiceId,
      qboInvoiceId,
      locationId: ctx.locationId ?? null,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await auditLog(tenantId, "QBO_INVOICE_VOID_FAILED", {
      invoiceId,
      qboInvoiceId,
      error: msg,
    });
    throw err;
  }
}

export async function voidQboPayment(paymentId: string, tenantId: string): Promise<void> {
  const payment = await prisma.payment.findFirst({
    where: { id: paymentId, tenantId },
    include: { invoice: { select: { locationId: true } as any } },
  });
  if (!payment || !(payment as any).qboPaymentId) {
    return;
  }
  const ctx = await resolveQboContext(tenantId, (payment.invoice as any)?.locationId ?? undefined);
  const qboPaymentId = (payment as any).qboPaymentId as string;

  try {
    const existing = await qboRequest(ctx, "GET", `payment/${qboPaymentId}?minorversion=73`);
    const payload = {
      Id: qboPaymentId,
      SyncToken: existing.Payment.SyncToken,
    };
    await qboRequest(ctx, "POST", "payment?operation=void&minorversion=73", payload);

    await auditLog(tenantId, "QBO_PAYMENT_VOIDED", {
      paymentId,
      qboPaymentId,
      locationId: ctx.locationId ?? null,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await auditLog(tenantId, "QBO_PAYMENT_VOID_FAILED", {
      paymentId,
      qboPaymentId,
      error: msg,
    });
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Partial refund → QBO Refund Receipt
//
// Full refunds are mirrored to QBO via voidQboPayment (above). Partial
// refunds can't void the original payment because that would zero out the
// full amount in QBO; instead, each partial refund event is mirrored to QBO
// as its own RefundReceipt, so the sum of RefundReceipts in QBO matches
// Helm's `refundedCents` ledger for that payment.
//
// Concurrency / idempotency: a single payment may be partially refunded
// multiple times. The sync-ref `sourceId` encodes the unique tuple
// (paymentId, priorRefundedCents, refundAmountCents) that identifies one
// individual refund event — the same tuple Stripe uses as its idempotency
// key (see payments.ts/customers.ts). Re-running this helper for the same
// tuple short-circuits and returns the previously-pushed RefundReceipt id
// instead of creating a duplicate in QBO.
//
// Failure handling: any QBO error is captured to qbo_inventory_sync_refs
// with sourceType="payment_refund" and qboType="RefundReceipt", so the
// existing Settings → QuickBooks recent-errors panel surfaces it the same
// way other QBO sync failures are shown. The retry sweep + manual "Retry
// all failures" button can then re-attempt the push (see
// retryFailedQboInventorySyncs in routes/inventory.ts).
// ---------------------------------------------------------------------------

export const PAYMENT_REFUND_SYNC_SOURCE_TYPE = "payment_refund";
export const QBO_REFUND_RECEIPT_TYPE = "RefundReceipt";

export function buildPaymentRefundSyncSourceId(
  paymentId: string,
  priorRefundedCents: number,
  refundAmountCents: number,
): string {
  return `${paymentId}:${priorRefundedCents}:${refundAmountCents}`;
}

/**
 * Parses a sync-ref sourceId produced by `buildPaymentRefundSyncSourceId`
 * back into its constituent fields. Returns null when the input doesn't
 * match the expected `paymentId:priorRefundedCents:refundAmountCents`
 * shape (e.g. legacy rows or human-edited values). Used by the retry path
 * so a failed refund push can be re-attempted with the original arguments.
 */
export function parsePaymentRefundSyncSourceId(
  sourceId: string,
): { paymentId: string; priorRefundedCents: number; refundAmountCents: number } | null {
  // The paymentId itself never contains ":" (uuid), so splitting from the
  // right-hand side is unnecessary — a simple split is unambiguous.
  const parts = sourceId.split(":");
  if (parts.length !== 3) return null;
  const [paymentId, priorStr, amountStr] = parts;
  const priorRefundedCents = Number(priorStr);
  const refundAmountCents = Number(amountStr);
  if (
    !paymentId ||
    !Number.isInteger(priorRefundedCents) ||
    priorRefundedCents < 0 ||
    !Number.isInteger(refundAmountCents) ||
    refundAmountCents <= 0
  ) {
    return null;
  }
  return { paymentId, priorRefundedCents, refundAmountCents };
}

export async function createQboRefundReceipt(
  paymentId: string,
  refundAmountCents: number,
  priorRefundedCents: number,
  tenantId: string,
): Promise<{ qboRefundReceiptId: string; skipped: boolean }> {
  if (!Number.isInteger(refundAmountCents) || refundAmountCents <= 0) {
    throw new Error("Refund amount must be a positive integer (cents)");
  }
  if (!Number.isInteger(priorRefundedCents) || priorRefundedCents < 0) {
    throw new Error("Prior refunded amount must be a non-negative integer (cents)");
  }

  const sourceType = PAYMENT_REFUND_SYNC_SOURCE_TYPE;
  const sourceId = buildPaymentRefundSyncSourceId(
    paymentId,
    priorRefundedCents,
    refundAmountCents,
  );
  const qboType = QBO_REFUND_RECEIPT_TYPE;

  let locationId: string | null = null;

  try {
    const payment = await prisma.payment.findFirst({
      where: { id: paymentId, tenantId },
      include: {
        customer: { select: { id: true, qboCustomerId: true } },
        invoice: { select: { id: true, locationId: true } },
      },
    });
    if (!payment) {
      throw new Error(`Payment ${paymentId} not found`);
    }
    if (!payment.customer) {
      throw new Error(`Payment ${paymentId} has no customer`);
    }
    locationId = payment.invoice?.locationId ?? null;

    // Idempotency — if we already pushed this exact refund event to QBO
    // (e.g. a previous attempt succeeded but the caller crashed before
    // logging success, or the retry sweep is re-running an already-fixed
    // ref), return the existing receipt id without re-posting.
    const existingRef = await readSyncRef(tenantId, sourceType, sourceId);
    if (existingRef?.qboId) {
      return { qboRefundReceiptId: existingRef.qboId, skipped: true };
    }

    // Resolve credentials from the linked invoice's location. Standalone
    // payments (no invoice) fall back to tenant-level credentials, mirroring
    // syncPayment above. resolveQboContext throws a descriptive error when
    // the location is set but has no QBO connection — that error is then
    // captured to the sync ref and surfaced in the Settings UI.
    const ctx = await resolveQboContext(tenantId, locationId ?? undefined);

    // Ensure the customer is synced to QBO using the same credential
    // context. If the customer already has a qboCustomerId we skip the
    // round-trip to avoid an unnecessary update.
    let qboCustomerId: string | null = payment.customer.qboCustomerId;
    if (!qboCustomerId) {
      await syncCustomer(payment.customer.id, tenantId, ctx.locationId);
      const refreshed = await prisma.customer.findUnique({
        where: { id: payment.customer.id },
        select: { qboCustomerId: true },
      });
      qboCustomerId = refreshed?.qboCustomerId ?? null;
    }
    if (!qboCustomerId) {
      throw new Error("Customer has no QBO ID after sync attempt");
    }

    const amount = refundAmountCents / 100;
    const txnDate = new Date().toISOString().split("T")[0];
    const description = `Refund of $${amount.toFixed(2)} for payment ${paymentId}`;

    // RefundReceipt mirrors the structure of the SalesReceipt path above
    // (single SalesItemLineDetail with Amount, no ItemRef) so the same
    // QBO company config that accepts our standalone-payment receipts
    // also accepts these refunds.
    const payload: Record<string, unknown> = {
      CustomerRef: { value: qboCustomerId },
      TotalAmt: amount,
      TxnDate: txnDate,
      PrivateNote:
        `Helm partial refund: $${(priorRefundedCents / 100).toFixed(2)} → $${(
          (priorRefundedCents + refundAmountCents) / 100
        ).toFixed(2)} of $${(payment.amountCents / 100).toFixed(2)} (payment ${paymentId})`,
      Line: [
        {
          Amount: amount,
          DetailType: "SalesItemLineDetail",
          Description: description,
          SalesItemLineDetail: {
            Qty: 1,
            UnitPrice: amount,
          },
        },
      ],
    };

    const result = await qboRequest(
      ctx,
      "POST",
      "refundreceipt?minorversion=73",
      payload,
    );
    const qboRefundReceiptId = String(result.RefundReceipt.Id);

    await writeSyncRefSuccess(
      tenantId,
      sourceType,
      sourceId,
      qboType,
      qboRefundReceiptId,
      ctx.locationId,
    );

    await auditLog(tenantId, "QBO_REFUND_RECEIPT_CREATED", {
      paymentId,
      refundAmountCents,
      priorRefundedCents,
      qboRefundReceiptId,
      locationId: ctx.locationId ?? null,
    });

    return { qboRefundReceiptId, skipped: false };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await writeSyncRefFailure(tenantId, sourceType, sourceId, qboType, msg, locationId);
    await auditLog(tenantId, "QBO_REFUND_RECEIPT_FAILED", {
      paymentId,
      refundAmountCents,
      priorRefundedCents,
      error: msg,
      locationId: locationId ?? null,
    });
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Inventory sync status — feeds the Settings > QBO > Inventory section
// ---------------------------------------------------------------------------

export interface InventorySyncStatus {
  itemsSynced: number;
  itemsWithErrors: number;
  itemsAwaitingSync: number;
  billsSynced: number;
  billsWithErrors: number;
  adjustmentsSynced: number;
  adjustmentsWithErrors: number;
  // Partial-refund pushes mirrored to QBO as RefundReceipts. Tracked here so
  // the Settings UI can include them in the failure-count summary that drives
  // the "Retry all failures" button.
  refundReceiptsSynced: number;
  refundReceiptsWithErrors: number;
  lastItemSyncAt: Date | null;
  lastBillSyncAt: Date | null;
  lastAdjustmentSyncAt: Date | null;
  lastRefundReceiptSyncAt: Date | null;
  recentErrors: Array<{
    sourceType: string;
    sourceId: string;
    qboType: string;
    error: string;
    at: Date;
    retryCount: number;
    nextRetryAt: Date | null;
  }>;
  // Wall-clock time of the next scheduled background retry sweep (every 15
  // minutes on the quarter-hour, UTC). Null when there are no failing refs.
  nextAutomaticRetryAt: Date | null;
  // Earliest per-record nextRetryAt across all failing refs. Helps the UI
  // explain why a record might not be retried until later (after backoff).
  earliestPendingRetryAt: Date | null;
}

/**
 * Returns the next quarter-hour boundary in UTC after `from`. Aligns with the
 * cron pattern (every 15 minutes) used by the inventory-retry-sweep job so the
 * Settings card can show the user when the next attempt will run.
 */
export function nextQuarterHour(from: Date): Date {
  const next = new Date(from);
  next.setUTCSeconds(0, 0);
  const minute = next.getUTCMinutes();
  const add = 15 - (minute % 15);
  next.setUTCMinutes(minute + add);
  return next;
}

export async function getInventorySyncStatus(tenantId: string): Promise<InventorySyncStatus> {
  const refs = await (prisma as any).qboInventorySyncRef.findMany({
    where: { tenantId },
    orderBy: [{ updatedAt: "desc" }],
  });

  const status: InventorySyncStatus = {
    itemsSynced: 0,
    itemsWithErrors: 0,
    itemsAwaitingSync: 0,
    billsSynced: 0,
    billsWithErrors: 0,
    adjustmentsSynced: 0,
    adjustmentsWithErrors: 0,
    refundReceiptsSynced: 0,
    refundReceiptsWithErrors: 0,
    lastItemSyncAt: null,
    lastBillSyncAt: null,
    lastAdjustmentSyncAt: null,
    lastRefundReceiptSyncAt: null,
    recentErrors: [],
    nextAutomaticRetryAt: null,
    earliestPendingRetryAt: null,
  };

  let hasFailing = false;
  for (const r of refs) {
    if (r.qboType === "Item") {
      if (r.qboId && !r.lastError) status.itemsSynced++;
      if (r.lastError) status.itemsWithErrors++;
      if (!r.qboId && !r.lastError) status.itemsAwaitingSync++;
      if (r.lastSyncedAt && (!status.lastItemSyncAt || r.lastSyncedAt > status.lastItemSyncAt)) {
        status.lastItemSyncAt = r.lastSyncedAt;
      }
    } else if (r.qboType === "Bill") {
      if (r.qboId && !r.lastError) status.billsSynced++;
      if (r.lastError) status.billsWithErrors++;
      if (r.lastSyncedAt && (!status.lastBillSyncAt || r.lastSyncedAt > status.lastBillSyncAt)) {
        status.lastBillSyncAt = r.lastSyncedAt;
      }
    } else if (r.qboType === "JournalEntry") {
      if (r.qboId && !r.lastError) status.adjustmentsSynced++;
      if (r.lastError) status.adjustmentsWithErrors++;
      if (r.lastSyncedAt && (!status.lastAdjustmentSyncAt || r.lastSyncedAt > status.lastAdjustmentSyncAt)) {
        status.lastAdjustmentSyncAt = r.lastSyncedAt;
      }
    } else if (r.qboType === QBO_REFUND_RECEIPT_TYPE) {
      if (r.qboId && !r.lastError) status.refundReceiptsSynced++;
      if (r.lastError) status.refundReceiptsWithErrors++;
      if (
        r.lastSyncedAt &&
        (!status.lastRefundReceiptSyncAt || r.lastSyncedAt > status.lastRefundReceiptSyncAt)
      ) {
        status.lastRefundReceiptSyncAt = r.lastSyncedAt;
      }
    }
    if (r.lastError) {
      hasFailing = true;
      if (r.nextRetryAt && (!status.earliestPendingRetryAt || r.nextRetryAt < status.earliestPendingRetryAt)) {
        status.earliestPendingRetryAt = r.nextRetryAt;
      }
    }
    if (r.lastError && r.lastErrorAt && status.recentErrors.length < 10) {
      status.recentErrors.push({
        sourceType: r.sourceType,
        sourceId: r.sourceId,
        qboType: r.qboType,
        error: r.lastError,
        at: r.lastErrorAt,
        retryCount: r.retryCount ?? 0,
        nextRetryAt: r.nextRetryAt ?? null,
      });
    }
  }

  if (hasFailing) {
    status.nextAutomaticRetryAt = nextQuarterHour(new Date());
  }

  return status;
}

export async function getProductSyncStatus(
  tenantId: string,
  productId: string,
): Promise<{
  qboItemId: string | null;
  lastSyncedAt: Date | null;
  lastError: string | null;
  lastErrorAt: Date | null;
} | null> {
  const ref = await readSyncRef(tenantId, "product", productId);
  if (!ref) return null;
  return {
    qboItemId: ref.qboId,
    lastSyncedAt: ref.lastSyncedAt,
    lastError: ref.lastError,
    lastErrorAt: ref.lastErrorAt,
  };
}

export interface FailedInventorySyncRef {
  sourceType: string;
  sourceId: string;
  qboType: string;
  qboId: string | null;
  locationId: string | null;
  lastError: string;
  lastErrorAt: Date;
  retryCount: number;
  nextRetryAt: Date | null;
}

/**
 * Returns every QBO inventory sync ref for a tenant that is currently in an
 * error state (lastError set). Used by the bulk re-sync endpoint to drive a
 * "retry all failures" action from Settings → QuickBooks → Inventory Sync.
 *
 * When `dueOnly` is true, also filters out refs whose `nextRetryAt` is in the
 * future — used by the background sweep so a record under exponential backoff
 * is not retried before its scheduled time.
 */
export async function findFailedInventorySyncRefs(
  tenantId: string,
  opts: { dueOnly?: boolean; now?: Date } = {},
): Promise<FailedInventorySyncRef[]> {
  const now = opts.now ?? new Date();
  const where: Record<string, unknown> = { tenantId, lastError: { not: null } };
  if (opts.dueOnly) {
    where.OR = [{ nextRetryAt: null }, { nextRetryAt: { lte: now } }];
  }
  const refs = await (prisma as any).qboInventorySyncRef.findMany({
    where,
    orderBy: [{ lastErrorAt: "asc" }],
  });
  return refs.map((r: any) => ({
    sourceType: r.sourceType,
    sourceId: r.sourceId,
    qboType: r.qboType,
    qboId: r.qboId ?? null,
    locationId: r.locationId ?? null,
    lastError: r.lastError,
    lastErrorAt: r.lastErrorAt,
    retryCount: r.retryCount ?? 0,
    nextRetryAt: r.nextRetryAt ?? null,
  }));
}

/**
 * Returns the distinct tenant IDs that currently have at least one failing
 * inventory sync ref whose `nextRetryAt` is null or in the past. Used by the
 * background sweep to decide which tenants need a retry pass.
 */
export async function findTenantsWithDueFailedInventorySyncs(
  now: Date = new Date(),
): Promise<string[]> {
  const refs = await (prisma as any).qboInventorySyncRef.findMany({
    where: {
      lastError: { not: null },
      OR: [{ nextRetryAt: null }, { nextRetryAt: { lte: now } }],
    },
    select: { tenantId: true },
    distinct: ["tenantId"],
  });
  return refs.map((r: { tenantId: string }) => r.tenantId);
}

export async function getBulkProductSyncStatus(
  tenantId: string,
  productIds: string[],
): Promise<Record<string, { qboItemId: string | null; lastSyncedAt: Date | null; lastError: string | null; lastErrorAt: Date | null }>> {
  if (productIds.length === 0) return {};
  const refs = await (prisma as any).qboInventorySyncRef.findMany({
    where: { tenantId, sourceType: "product", sourceId: { in: productIds } },
  });
  const out: Record<string, any> = {};
  for (const r of refs) {
    out[r.sourceId] = {
      qboItemId: r.qboId ?? null,
      lastSyncedAt: r.lastSyncedAt ?? null,
      lastError: r.lastError ?? null,
      lastErrorAt: r.lastErrorAt ?? null,
    };
  }
  return out;
}

// ===========================================================================
// Pull-back from QBO — Vendors and Bills
// ---------------------------------------------------------------------------
// Bookkeepers often live in QuickBooks. When they create a Vendor or a Bill
// directly in QBO, those records were previously stranded there because the
// sync was push-only. These functions close that loop:
//
//   - Webhook path: Intuit pings /api/qbo/webhook on entity changes; the
//     handler above fetches the changed record and calls applyQboVendor /
//     applyQboBill which upsert into Helm.
//   - Pull path: pullVendorsAndBillsForTenant queries QBO for everything
//     updated since the last successful pull (per-tenant or per-location),
//     and applies each record. Safe to call repeatedly (idempotent on
//     qboVendorId / qboBillId).
//
// Existing rows are matched by qboVendorId / qboBillId and updated in place.
// Audit log entries are written for every applied change so users can see in
// the audit trail what came from QBO.
// ===========================================================================

export interface QboVendorPayload {
  Id: string;
  DisplayName?: string;
  CompanyName?: string;
  PrimaryEmailAddr?: { Address?: string };
  PrimaryPhone?: { FreeFormNumber?: string };
  BillAddr?: {
    Line1?: string;
    City?: string;
    CountrySubDivisionCode?: string;
    PostalCode?: string;
  };
  Active?: boolean;
  MetaData?: { LastUpdatedTime?: string; CreateTime?: string };
}

export interface QboBillPayload {
  Id: string;
  DocNumber?: string;
  TxnDate?: string;
  DueDate?: string;
  TotalAmt?: number;
  Balance?: number;
  VendorRef?: { value: string; name?: string };
  PrivateNote?: string;
  MetaData?: { LastUpdatedTime?: string; CreateTime?: string };
}

interface ApplyResult {
  created: number;
  updated: number;
  skipped: number;
}

function emptyApplyResult(): ApplyResult {
  return { created: 0, updated: 0, skipped: 0 };
}

function flattenAddress(addr?: QboVendorPayload["BillAddr"]): string | null {
  if (!addr) return null;
  const parts = [addr.Line1, addr.City, addr.CountrySubDivisionCode, addr.PostalCode].filter(Boolean);
  return parts.length ? parts.join(", ") : null;
}

// ---------------------------------------------------------------------------
// Vendor: upsert by qboVendorId
// ---------------------------------------------------------------------------

export async function applyQboVendor(
  tenantId: string,
  locationId: string | null,
  payload: QboVendorPayload,
  source: "webhook" | "pull",
): Promise<{ vendorId: string; created: boolean }> {
  const qboVendorId = String(payload.Id);
  const name = (payload.DisplayName ?? payload.CompanyName ?? `QBO Vendor ${qboVendorId}`).slice(0, 200);
  const email = payload.PrimaryEmailAddr?.Address ?? null;
  const phone = payload.PrimaryPhone?.FreeFormNumber ?? null;
  const address = flattenAddress(payload.BillAddr);
  const active = payload.Active !== false;
  const now = new Date();

  const existing = await prisma.vendor.findFirst({
    where: { tenantId, qboVendorId } as any,
  });

  if (existing) {
    const changed: Record<string, { from: unknown; to: unknown }> = {};
    if (existing.name !== name) changed.name = { from: existing.name, to: name };
    if ((existing.email ?? null) !== email) changed.email = { from: existing.email, to: email };
    if ((existing.phone ?? null) !== phone) changed.phone = { from: existing.phone, to: phone };
    if ((existing.address ?? null) !== address) changed.address = { from: existing.address, to: address };
    if (existing.active !== active) changed.active = { from: existing.active, to: active };

    if (Object.keys(changed).length === 0) {
      // No-op update: still bump the synced-at marker so we know we saw it.
      await prisma.vendor.update({
        where: { id: existing.id },
        data: { qboVendorSyncedAt: now } as any,
      });
      return { vendorId: existing.id, created: false };
    }

    await prisma.vendor.update({
      where: { id: existing.id },
      data: {
        name,
        email,
        phone,
        address,
        active,
        qboVendorSyncedAt: now,
        qboVendorSyncError: null,
        qboVendorSyncErrorAt: null,
      } as any,
    });

    await auditLog(tenantId, "QBO_VENDOR_PULLED", {
      vendorId: existing.id,
      qboVendorId,
      source,
      changed,
      locationId,
    });

    return { vendorId: existing.id, created: false };
  }

  const created = await prisma.vendor.create({
    data: {
      tenantId,
      name,
      email,
      phone,
      address,
      active,
      qboVendorId,
      qboVendorSyncedAt: now,
    } as any,
  });

  await auditLog(tenantId, "QBO_VENDOR_PULLED", {
    vendorId: created.id,
    qboVendorId,
    source,
    created: true,
    locationId,
  });

  return { vendorId: created.id, created: true };
}

// ---------------------------------------------------------------------------
// Bill: upsert into PurchaseOrder by qboBillId
// ---------------------------------------------------------------------------
//
// The Bill's local representation is a PurchaseOrder row marked as received
// (since a Bill in QBO means goods/services have been billed). We do NOT
// sync line items here — Helm's PO line items live in-memory in inventory.ts
// and aren't 1:1 with QBO Bill lines. The PO row holds the totals, vendor
// link, and qboBillId so future updates can find it.
// ---------------------------------------------------------------------------

export async function applyQboBill(
  tenantId: string,
  locationId: string | null,
  payload: QboBillPayload,
  source: "webhook" | "pull",
): Promise<{ purchaseOrderId: string; created: boolean }> {
  const qboBillId = String(payload.Id);
  const totalCents = Math.round((payload.TotalAmt ?? 0) * 100);
  const expectedDate = payload.DueDate ? new Date(payload.DueDate) : payload.TxnDate ? new Date(payload.TxnDate) : null;
  const poNumber = (payload.DocNumber ?? `QBO-${qboBillId}`).slice(0, 40);
  const balance = Math.round((payload.Balance ?? payload.TotalAmt ?? 0) * 100);
  const status = balance <= 0 ? "received" : "received"; // Bill exists ⇒ goods already received

  // Resolve the vendor: ensure we have a local Vendor row keyed to this QBO vendor.
  let vendorId: string | null = null;
  const qboVendorId = payload.VendorRef?.value ? String(payload.VendorRef.value) : null;
  if (qboVendorId) {
    const existingVendor = await prisma.vendor.findFirst({
      where: { tenantId, qboVendorId } as any,
    });
    if (existingVendor) {
      vendorId = existingVendor.id;
    } else {
      // Create a stub vendor — full vendor sync happens via applyQboVendor when
      // we pull the vendor itself. Stub keeps the FK valid in the meantime.
      const stub = await prisma.vendor.create({
        data: {
          tenantId,
          name: payload.VendorRef?.name?.slice(0, 200) ?? `QBO Vendor ${qboVendorId}`,
          qboVendorId,
          qboVendorSyncedAt: new Date(),
        } as any,
      });
      vendorId = stub.id;
      await auditLog(tenantId, "QBO_VENDOR_STUB_CREATED", {
        vendorId,
        qboVendorId,
        reason: "referenced_by_pulled_bill",
        source,
      });
    }
  }

  const existing = await prisma.purchaseOrder.findFirst({
    where: { tenantId, qboBillId } as any,
  });

  const now = new Date();

  if (existing) {
    const changed: Record<string, { from: unknown; to: unknown }> = {};
    if (existing.totalCents !== totalCents) changed.totalCents = { from: existing.totalCents, to: totalCents };
    if (existing.poNumber !== poNumber) changed.poNumber = { from: existing.poNumber, to: poNumber };
    if (existing.vendorId !== vendorId) changed.vendorId = { from: existing.vendorId, to: vendorId };
    if (existing.status !== status) changed.status = { from: existing.status, to: status };

    await prisma.purchaseOrder.update({
      where: { id: existing.id },
      data: {
        totalCents,
        poNumber,
        vendorId,
        status,
        expectedDate,
        qboBillSyncedAt: now,
        qboBillSyncError: null,
        qboBillSyncErrorAt: null,
      } as any,
    });

    if (Object.keys(changed).length > 0) {
      await auditLog(tenantId, "QBO_BILL_PULLED", {
        purchaseOrderId: existing.id,
        qboBillId,
        source,
        changed,
        locationId,
      });
    }

    return { purchaseOrderId: existing.id, created: false };
  }

  const created = await prisma.purchaseOrder.create({
    data: {
      tenantId,
      locationId,
      vendorId,
      poNumber,
      status,
      expectedDate,
      totalCents,
      qboBillId,
      qboBillSyncedAt: now,
    } as any,
  });

  await auditLog(tenantId, "QBO_BILL_PULLED", {
    purchaseOrderId: created.id,
    qboBillId,
    source,
    created: true,
    locationId,
  });

  return { purchaseOrderId: created.id, created: true };
}

// ---------------------------------------------------------------------------
// Pull driver — query QBO for vendors / bills updated since last watermark
// ---------------------------------------------------------------------------

// Helper: format Date as QBO query timestamp (`YYYY-MM-DDTHH:mm:ss-00:00`)
function qboTimestamp(d: Date): string {
  // QBO requires no fractional seconds on Metadata.LastUpdatedTime filters.
  return d.toISOString().replace(/\.\d{3}Z$/, "Z");
}

async function readPullWatermark(
  tenantId: string,
  locationId: string | null,
  field: "qboLastVendorPullAt" | "qboLastBillPullAt",
): Promise<Date | null> {
  if (locationId) {
    const loc = await prisma.location.findUnique({
      where: { id: locationId },
      select: { [field]: true } as any,
    });
    return ((loc as any)?.[field] as Date | null) ?? null;
  }
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { [field]: true } as any,
  });
  return ((tenant as any)?.[field] as Date | null) ?? null;
}

async function writePullWatermark(
  tenantId: string,
  locationId: string | null,
  field: "qboLastVendorPullAt" | "qboLastBillPullAt",
  at: Date,
): Promise<void> {
  if (locationId) {
    await prisma.location.update({
      where: { id: locationId },
      data: { [field]: at } as any,
    });
    return;
  }
  await prisma.tenant.update({
    where: { id: tenantId },
    data: { [field]: at } as any,
  });
}

async function queryQboPaged<T>(
  ctx: QboCredentialContext,
  selectExpr: string,
  rowsKey: "Vendor" | "Bill" | "Account",
): Promise<T[]> {
  const PAGE_SIZE = 100;
  let startPosition = 1;
  const out: T[] = [];
  // Cap total records pulled per cycle to avoid runaway loops on bad data.
  for (let i = 0; i < 50; i++) {
    const q = `${selectExpr} STARTPOSITION ${startPosition} MAXRESULTS ${PAGE_SIZE}`;
    const path = `query?query=${encodeURIComponent(q)}&minorversion=73`;
    const result = await qboRequest(ctx, "GET", path);
    const rows: T[] = (result?.QueryResponse?.[rowsKey] as T[]) ?? [];
    out.push(...rows);
    if (rows.length < PAGE_SIZE) break;
    startPosition += PAGE_SIZE;
  }
  return out;
}

export async function pullVendorsFromQbo(
  tenantId: string,
  locationId: string | null,
): Promise<ApplyResult> {
  const ctx: QboCredentialContext = locationId ? { tenantId, locationId } : { tenantId };
  const result = emptyApplyResult();
  const startedAt = new Date();

  try {
    const since = await readPullWatermark(tenantId, locationId, "qboLastVendorPullAt");
    // First-time pull: fetch all active vendors (no watermark filter).
    const where = since ? `WHERE Metadata.LastUpdatedTime > '${qboTimestamp(since)}'` : "";
    const select = `SELECT * FROM Vendor ${where}`.trim();

    const rows = await queryQboPaged<QboVendorPayload>(ctx, select, "Vendor");
    for (const v of rows) {
      try {
        const r = await applyQboVendor(tenantId, locationId, v, "pull");
        if (r.created) result.created++;
        else result.updated++;
      } catch (err) {
        result.skipped++;
        console.error("[qbo-sync] applyQboVendor failed", { qboVendorId: v.Id, err });
      }
    }

    await writePullWatermark(tenantId, locationId, "qboLastVendorPullAt", startedAt);

    await auditLog(tenantId, "QBO_VENDORS_PULLED", {
      locationId,
      since: since?.toISOString() ?? null,
      counts: result,
    });
    return result;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await auditLog(tenantId, "QBO_VENDORS_PULL_FAILED", {
      locationId,
      error: msg,
    });
    throw err;
  }
}

export async function pullBillsFromQbo(
  tenantId: string,
  locationId: string | null,
): Promise<ApplyResult> {
  const ctx: QboCredentialContext = locationId ? { tenantId, locationId } : { tenantId };
  const result = emptyApplyResult();
  const startedAt = new Date();

  try {
    const since = await readPullWatermark(tenantId, locationId, "qboLastBillPullAt");
    const where = since ? `WHERE Metadata.LastUpdatedTime > '${qboTimestamp(since)}'` : "";
    const select = `SELECT * FROM Bill ${where}`.trim();

    const rows = await queryQboPaged<QboBillPayload>(ctx, select, "Bill");
    for (const b of rows) {
      try {
        const r = await applyQboBill(tenantId, locationId, b, "pull");
        if (r.created) result.created++;
        else result.updated++;
      } catch (err) {
        result.skipped++;
        console.error("[qbo-sync] applyQboBill failed", { qboBillId: b.Id, err });
      }
    }

    await writePullWatermark(tenantId, locationId, "qboLastBillPullAt", startedAt);

    await auditLog(tenantId, "QBO_BILLS_PULLED", {
      locationId,
      since: since?.toISOString() ?? null,
      counts: result,
    });
    return result;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await auditLog(tenantId, "QBO_BILLS_PULL_FAILED", {
      locationId,
      error: msg,
    });
    throw err;
  }
}

// Iterate every connected QBO endpoint for the tenant (per-location and
// tenant-level) and pull vendors + bills from each. Returns aggregated counts.
export interface TenantPullResult {
  vendors: ApplyResult;
  bills: ApplyResult;
  endpoints: Array<{
    scope: "tenant" | "location";
    locationId: string | null;
    vendors: ApplyResult;
    bills: ApplyResult;
    error?: string;
  }>;
}

export async function pullVendorsAndBillsForTenant(tenantId: string): Promise<TenantPullResult> {
  const out: TenantPullResult = {
    vendors: emptyApplyResult(),
    bills: emptyApplyResult(),
    endpoints: [],
  };

  const accumulate = (target: ApplyResult, source: ApplyResult) => {
    target.created += source.created;
    target.updated += source.updated;
    target.skipped += source.skipped;
  };

  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { qboAccessToken: true, qboRealmId: true } as any,
  });

  if ((tenant as any)?.qboAccessToken && (tenant as any)?.qboRealmId) {
    try {
      const v = await pullVendorsFromQbo(tenantId, null);
      const b = await pullBillsFromQbo(tenantId, null);
      out.endpoints.push({ scope: "tenant", locationId: null, vendors: v, bills: b });
      accumulate(out.vendors, v);
      accumulate(out.bills, b);
    } catch (err) {
      out.endpoints.push({
        scope: "tenant",
        locationId: null,
        vendors: emptyApplyResult(),
        bills: emptyApplyResult(),
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const locations = await prisma.location.findMany({
    where: {
      tenantId,
      qboAccessToken: { not: null },
      qboRealmId: { not: null },
    } as any,
    select: { id: true } as any,
  });

  for (const loc of locations) {
    try {
      const v = await pullVendorsFromQbo(tenantId, (loc as any).id);
      const b = await pullBillsFromQbo(tenantId, (loc as any).id);
      out.endpoints.push({ scope: "location", locationId: (loc as any).id, vendors: v, bills: b });
      accumulate(out.vendors, v);
      accumulate(out.bills, b);
    } catch (err) {
      out.endpoints.push({
        scope: "location",
        locationId: (loc as any).id,
        vendors: emptyApplyResult(),
        bills: emptyApplyResult(),
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return out;
}

// --------------------------------------------------------------------------
// Entity Sync: POS Ticket → QBO SalesReceipt (Task 8b)
// --------------------------------------------------------------------------

/**
 * Push a completed POS transaction to QuickBooks Online as a SalesReceipt.
 * Must be called after the transaction is persisted. Non-fatal — callers
 * should catch and log rather than failing the POS response.
 *
 * Payment method → DepositToAccountRef mapping:
 *   CASH              → location.bankGlAccount   (physical cash drawer)
 *   CARD / ACH / else → location.undepositedFundsGlAccount
 */
export async function syncPosTicketAsReceipt(
  posTicketId: string,
  tenantId: string,
): Promise<void> {
  // Load the transaction with line items, the shift's location, and the
  // attached customer (if any) so we can sync it to QBO before the receipt.
  const tx = await prisma.posTransaction.findFirst({
    where: { id: posTicketId, tenantId },
    include: {
      lineItems: {
        include: {
          product: {
            select: {
              id: true,
              name: true,
              qboItemId: true,
              qboItemSyncedAt: true,
            },
          },
        },
      },
      shift: {
        select: { locationId: true },
      },
      customer: true,
    },
  });

  if (!tx) {
    throw new Error(`PosTransaction ${posTicketId} not found`);
  }

  // Derive the location from the shift (PosTransaction itself has no locationId column)
  const locationId = (tx as any).shift?.locationId as string | null | undefined ?? null;

  // Resolve QBO context — prefer location-level connection if the shift has one
  const ctx = await resolveQboContext(tenantId, locationId);

  // If a customer is attached to this POS sale, ensure they're synced to QBO
  // before we push the receipt — this mirrors the invoice path so the Sales
  // Receipt can carry a CustomerRef and the customer shows up in QBO.
  //
  // Customer sync failures must NOT break the receipt push. The POS sale has
  // already been committed locally; if QBO customer sync trips up (e.g. a
  // transient network error or an unusual QBO validation issue), we log it
  // and fall back to pushing the receipt without a CustomerRef so the sale
  // still lands in QBO. An audit-log entry makes the failure recoverable.
  let qboCustomerIdForReceipt: string | null = null;
  const attachedCustomer = (tx as any).customer as { id: string; qboCustomerId?: string | null } | null;
  if (attachedCustomer) {
    try {
      if (!attachedCustomer.qboCustomerId) {
        await syncCustomer(attachedCustomer.id, tenantId, ctx.locationId ?? null);
        const refreshed = await prisma.customer.findUnique({
          where: { id: attachedCustomer.id },
          select: { qboCustomerId: true } as any,
        });
        qboCustomerIdForReceipt = ((refreshed as any)?.qboCustomerId as string | null) ?? null;
      } else {
        qboCustomerIdForReceipt = attachedCustomer.qboCustomerId;
      }
    } catch (err) {
      console.error(
        `[qbo-sync] POS customer sync failed for posTicket=${posTicketId} customer=${attachedCustomer.id}:`,
        err,
      );
      await auditLog(tenantId, "QBO_POS_CUSTOMER_SYNC_FAILED", {
        posTicketId,
        customerId: attachedCustomer.id,
        locationId: ctx.locationId ?? null,
        error: (err as Error)?.message ?? String(err),
      });
      // Leave qboCustomerIdForReceipt null — receipt push continues without
      // a CustomerRef so the sale itself still reaches QBO.
    }
  }

  // Resolve location-pinned GL accounts (cash drawer vs undeposited funds)
  const locationPinned = locationId
    ? await getLocationPostingAccounts(locationId)
    : { ar: null, undepositedFunds: null, deferredRevenue: null, defaultRevenue: null, salesTax: null };

  // For CASH payments use the cash-drawer bank account; for card/ACH use
  // undeposited funds so reconciliation can batch them by deposit date.
  let depositAccountQboId: string | null = null;
  const paymentMethod = (tx as any).status as string; // POS uses status as the payment method value

  if (paymentMethod === "CASH" && locationId) {
    // bankGlAccountId → GlAccount.qboAccountId
    const loc = await (prisma as any).location.findUnique({
      where: { id: locationId },
      select: {
        bankGlAccount: {
          select: { qboAccountId: true },
        },
      },
    });
    depositAccountQboId = loc?.bankGlAccount?.qboAccountId ?? null;
  }

  // Fall back to undepositedFunds for card/ACH, or when cash-drawer account is unmapped
  if (!depositAccountQboId && locationPinned.undepositedFunds?.qboAccountId) {
    depositAccountQboId = locationPinned.undepositedFunds.qboAccountId;
  }

  // Build SalesReceipt line items.
  //
  // QBO validates `Line.Amount === SalesItemLineDetail.UnitPrice * Qty` to the
  // cent on every SalesItemLineDetail line and rejects the entire receipt when
  // it doesn't tie. Sending the post-discount/post-tax `extendedCents` as
  // Amount while sending the pre-discount `unitPriceCents` as UnitPrice
  // violates that invariant the moment any POS line carries a discount or
  // line-level tax — which is what was happening in production
  // ("Amount calculation incorrect... Supplied value: 4.29").
  //
  // Fix: send the *pre-discount, pre-tax* line subtotal as `Amount`, and a
  // `UnitPrice` that satisfies the equality exactly. Discounts are surfaced as
  // separate `DiscountLineDetail` lines so the receipt's `TotalAmt` still
  // matches the POS ticket total. Per-line tax is already aggregated into the
  // single `tx.taxCents` total below, so removing it from item lines does not
  // double-count.
  let totalDiscountCents = 0;
  const lines: Record<string, unknown>[] = [];
  ((tx as any).lineItems as any[]).forEach((li: any, idx: number) => {
    const qboItemId = li.product?.qboItemId as string | null;
    const quantity = Math.max(1, Number(li.quantity) || 1);
    const unitPriceCents = Number(li.unitPriceCents) || 0;
    const lineSubtotalCents = unitPriceCents * quantity;
    const amount = lineSubtotalCents / 100;
    const unitPrice = unitPriceCents / 100;

    // Detect float-precision drift between (UnitPrice * Qty) and Amount —
    // e.g. 1.43 * 7 = 10.010000000000002 in IEEE-754. When QBO would round
    // the product differently than our integer subtotal, collapse to a
    // single-unit line so the equality holds exactly.
    const productMatchesCents =
      Math.round(unitPrice * quantity * 100) === lineSubtotalCents;

    const detail: Record<string, unknown> = productMatchesCents
      ? { Qty: quantity, UnitPrice: unitPrice }
      : { Qty: 1, UnitPrice: amount };
    if (qboItemId) detail.ItemRef = { value: qboItemId };

    lines.push({
      LineNum: lines.length + 1,
      Amount: amount,
      DetailType: "SalesItemLineDetail",
      Description: li.product?.name ?? `Line ${idx + 1}`,
      SalesItemLineDetail: detail,
    });

    const discountCents = Number(li.discountCents) || 0;
    if (discountCents > 0) totalDiscountCents += discountCents;
  });

  // Represent line-level discounts as a single receipt-level
  // DiscountLineDetail so per-line UnitPrice * Qty equality is preserved
  // while the receipt total still ties to the POS ticket.
  if (totalDiscountCents > 0) {
    lines.push({
      LineNum: lines.length + 1,
      Amount: totalDiscountCents / 100,
      DetailType: "DiscountLineDetail",
      Description: "POS discount",
      DiscountLineDetail: {
        PercentBased: false,
      },
    });
  }

  // Include tax as a separate line when non-zero. The transaction-level
  // `tx.taxCents` is the canonical sum of tax for the ticket; per-line
  // `taxCents` was previously folded into `extendedCents` and is now
  // intentionally excluded from item lines so we don't double-count.
  const taxCents = Number((tx as any).taxCents) || 0;
  if (taxCents > 0) {
    lines.push({
      Amount: taxCents / 100,
      DetailType: "SalesItemLineDetail",
      Description: "Sales Tax",
      SalesItemLineDetail: {
        Qty: 1,
        UnitPrice: taxCents / 100,
      },
    });
  }

  // Defense in depth: assert the receipt total ties out to the POS ticket
  // total to the cent before we send. If it doesn't, throw a clear internal
  // error rather than letting QBO reject the payload — this surfaces any
  // future drift early instead of as an opaque QBO validation message.
  const itemSumCents = ((tx as any).lineItems as any[]).reduce(
    (acc: number, li: any) => acc + (Number(li.unitPriceCents) || 0) * (Number(li.quantity) || 1),
    0,
  );
  const computedTotalCents = itemSumCents - totalDiscountCents + taxCents;
  const expectedTotalCents = Number((tx as any).totalCents) || 0;
  if (computedTotalCents !== expectedTotalCents) {
    throw new Error(
      `[qbo-sync] POS receipt total mismatch for ${posTicketId}: ` +
        `computed=${computedTotalCents} expected=${expectedTotalCents}`,
    );
  }

  const receiptData: Record<string, unknown> = {
    TxnDate: (tx as any).createdAt instanceof Date
      ? ((tx as any).createdAt as Date).toISOString().split("T")[0]
      : new Date().toISOString().split("T")[0],
    DocNumber: posTicketId.slice(0, 21),
    PrivateNote: `Helm POS ${posTicketId}`,
    Line: lines,
    TotalAmt: (tx as any).totalCents / 100,
  };

  if (depositAccountQboId) {
    receiptData.DepositToAccountRef = { value: depositAccountQboId };
  }

  if (qboCustomerIdForReceipt) {
    receiptData.CustomerRef = { value: qboCustomerIdForReceipt };
  }

  const result = await qboRequest(ctx, "POST", "salesreceipt?minorversion=73", receiptData);
  const qboSalesReceiptId = result.SalesReceipt.Id as string;

  await auditLog(tenantId, "QBO_POS_SALESRECEIPT_SYNCED", {
    posTicketId,
    qboSalesReceiptId,
    locationId: ctx.locationId ?? null,
    paymentMethod,
    ...(qboCustomerIdForReceipt
      ? { qboCustomerId: qboCustomerIdForReceipt, customerId: attachedCustomer?.id ?? null }
      : attachedCustomer
        ? { customerId: attachedCustomer.id, qboCustomerId: null }
        : {}),
  });
}
