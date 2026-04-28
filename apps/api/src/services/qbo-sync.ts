import { prisma } from "../lib/prisma.js";

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
interface QboCredentialContext {
  tenantId: string;
  locationId?: string;
}

async function qboRequest(
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
    return { tenantId };
  }
  const location = await prisma.location.findUnique({
    where: { id: locationId },
    select: { qboRealmId: true, qboAccessToken: true },
  });
  if (location?.qboRealmId && location?.qboAccessToken) {
    return { tenantId, locationId };
  }
  // Location has no QBO credentials — throw a descriptive error
  throw new Error(`QuickBooks Online is not connected for location ${locationId}. Please connect QBO in Settings > Locations before syncing.`);
}

export async function syncCustomer(customerId: string, tenantId: string, locationId?: string | null): Promise<void> {
  const customer = await prisma.customer.findFirst({
    where: { id: customerId, tenantId },
  });

  if (!customer) {
    throw new Error(`Customer ${customerId} not found`);
  }

  const ctx = locationId ? await resolveQboContext(tenantId, locationId) : { tenantId };

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
    // Create new QBO customer
    result = await qboRequest(ctx, "POST", "customer?minorversion=73", qboCustomerData);

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

  const lineItems = (invoice as any).lineItems?.map((item: any, idx: number) => ({
    LineNum: idx + 1,
    Amount: item.totalCents / 100,
    DetailType: "SalesItemLineDetail",
    Description: item.description || "",
    SalesItemLineDetail: {
      Qty: item.quantity || 1,
      UnitPrice: item.unitPriceCents / 100,
      ...(item.qboItemId ? { ItemRef: { value: item.qboItemId } } : {}),
    },
  })) || [];

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

export async function handleQboWebhook(
  payload: any,
  _tenantId?: string,
): Promise<void> {
  if (!payload?.eventNotifications) return;

  for (const notification of payload.eventNotifications) {
    const realmId = notification.realmId;

    // Resolve which Helm location/tenant owns this realm.
    // Per-Location QBO connections are now primary, so check Location first
    // and fall back to Tenant for legacy tenant-level connections.
    let effectiveTenantId: string | null = null;
    let effectiveLocationId: string | null = null;

    const location = await prisma.location.findFirst({
      where: { qboRealmId: realmId } as any,
      select: { id: true, tenantId: true },
    });

    if (location) {
      effectiveTenantId = location.tenantId;
      effectiveLocationId = location.id;
    } else {
      const tenant = await prisma.tenant.findFirst({
        where: { qboRealmId: realmId } as any,
        select: { id: true },
      });
      if (tenant) {
        effectiveTenantId = tenant.id;
      }
    }

    if (!effectiveTenantId) {
      console.warn("[qbo-sync] Unknown realmId in webhook", { realmId });
      continue;
    }

    // Build credential context once per notification — location-scoped
    // when the realm belongs to a Location, tenant-scoped otherwise.
    const ctx: QboCredentialContext = effectiveLocationId
      ? { tenantId: effectiveTenantId, locationId: effectiveLocationId }
      : { tenantId: effectiveTenantId };

    for (const entity of notification.dataChangeEvent?.entities || []) {
      const { name, id, operation } = entity;

      try {
        if (name === "Customer" && (operation === "Create" || operation === "Update")) {
          // Fetch QBO customer and update our records
          const qboCustomer = await qboRequest(
            ctx,
            "GET",
            `customer/${id}?minorversion=73`,
          );

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
          // Fetch QBO invoice and update status
          const qboInvoice = await qboRequest(
            ctx,
            "GET",
            `invoice/${id}?minorversion=73`,
          );

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
      } catch (err) {
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
  // Local GlAccount IDs — translated to QBO account IDs at push time.
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
    },
    update: {
      qboType,
      qboId,
      locationId: locationId ?? null,
      lastSyncedAt: now,
      lastError: null,
      lastErrorAt: null,
    },
  });
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
  await (prisma as any).qboInventorySyncRef.upsert({
    where: { tenantId_sourceType_sourceId: { tenantId, sourceType, sourceId } },
    create: {
      tenantId,
      locationId: locationId ?? null,
      sourceType,
      sourceId,
      qboType,
      qboId: null,
      lastError: errorMessage.slice(0, 1000),
      lastErrorAt: now,
    },
    update: {
      qboType,
      locationId: locationId ?? null,
      lastError: errorMessage.slice(0, 1000),
      lastErrorAt: now,
    },
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
    const incomeAcctRef = await resolveQboAccountId(tenantId, input.incomeGlAccountId, "Income");
    const assetAcctRef = await resolveQboAccountId(tenantId, input.inventoryAssetGlAccountId, "Inventory Asset");
    const cogsAcctRef = await resolveQboAccountId(tenantId, input.cogsGlAccountId, "Cost of Goods Sold");

    const existingRef = await readSyncRef(tenantId, sourceType, input.productId);

    const qboPayload: Record<string, unknown> = {
      Name: input.name.slice(0, 100),
      Sku: input.sku ?? undefined,
      Description: input.description ?? undefined,
      Type: "Inventory",
      TrackQtyOnHand: true,
      QtyOnHand: input.qoh ?? 0,
      InvStartDate: new Date().toISOString().split("T")[0],
      UnitPrice: input.priceCents / 100,
      PurchaseCost: input.costCents / 100,
      IncomeAccountRef: { value: incomeAcctRef },
      AssetAccountRef: { value: assetAcctRef },
      ExpenseAccountRef: { value: cogsAcctRef },
    };

    let result: any;
    if (existingRef?.qboId) {
      // Update — fetch SyncToken first (QBO requires it on every update).
      const existing = await qboRequest(ctx, "GET", `item/${existingRef.qboId}?minorversion=73`);
      qboPayload.Id = existingRef.qboId;
      qboPayload.SyncToken = existing.Item.SyncToken;
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
  lastItemSyncAt: Date | null;
  lastBillSyncAt: Date | null;
  lastAdjustmentSyncAt: Date | null;
  recentErrors: Array<{
    sourceType: string;
    sourceId: string;
    qboType: string;
    error: string;
    at: Date;
  }>;
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
    lastItemSyncAt: null,
    lastBillSyncAt: null,
    lastAdjustmentSyncAt: null,
    recentErrors: [],
  };

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
    }
    if (r.lastError && r.lastErrorAt && status.recentErrors.length < 10) {
      status.recentErrors.push({
        sourceType: r.sourceType,
        sourceId: r.sourceId,
        qboType: r.qboType,
        error: r.lastError,
        at: r.lastErrorAt,
      });
    }
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
