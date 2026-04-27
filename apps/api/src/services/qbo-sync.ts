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
  tenantId: string,
): Promise<void> {
  if (!payload?.eventNotifications) return;

  for (const notification of payload.eventNotifications) {
    const realmId = notification.realmId;

    // Find tenant by realmId
    const tenant = await prisma.tenant.findFirst({
      where: { qboRealmId: realmId } as any,
    });

    if (!tenant) {
      console.warn("[qbo-sync] Unknown realmId in webhook", { realmId });
      continue;
    }

    const effectiveTenantId = tenant.id;

    for (const entity of notification.dataChangeEvent?.entities || []) {
      const { name, id, operation } = entity;

      try {
        if (name === "Customer" && (operation === "Create" || operation === "Update")) {
          // Fetch QBO customer and update our records
          const qboCustomer = await qboRequest(
            effectiveTenantId,
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
            });
          }
        }

        if (name === "Invoice" && operation === "Update") {
          // Fetch QBO invoice and update status
          const qboInvoice = await qboRequest(
            effectiveTenantId,
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
            });
          }
        }

        if (name === "Payment" && operation === "Create") {
          await auditLog(effectiveTenantId, "QBO_WEBHOOK_PAYMENT_RECEIVED", {
            qboPaymentId: id,
            operation,
          });
        }
      } catch (err) {
        console.error("[qbo-sync] Webhook entity processing failed", {
          name,
          id,
          operation,
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
