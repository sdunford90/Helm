import { prisma } from "../lib/prisma.js";

// --------------------------------------------------------------------------
// QuickBooks Online Bidirectional Sync Service
//
// Each Location has its own QBO company file (realmId + tokens).
// All sync functions take a locationId to identify which QBO company to use.
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
// Token management — per location
// --------------------------------------------------------------------------

async function getLocationTokens(locationId: string): Promise<QboTokens & { tenantId: string }> {
  const location = await prisma.location.findUnique({
    where: { id: locationId },
    select: {
      tenantId: true,
      qboAccessToken: true,
      qboRefreshToken: true,
      qboRealmId: true,
      qboTokenExpiresAt: true,
      qboConnected: true,
    },
  });

  if (!location?.qboConnected || !location.qboAccessToken || !location.qboRefreshToken || !location.qboRealmId) {
    throw new Error(`QuickBooks Online is not connected for location ${locationId}`);
  }

  return {
    tenantId: location.tenantId,
    accessToken: location.qboAccessToken,
    refreshToken: location.qboRefreshToken,
    realmId: location.qboRealmId,
    expiresAt: location.qboTokenExpiresAt ?? new Date(0),
  };
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
      qboConnected: true,
      ...(companyName ? { qboCompanyName: companyName } : {}),
    },
  });
}

async function getValidLocationAccessToken(locationId: string): Promise<{ accessToken: string; realmId: string; tenantId: string }> {
  const tokens = await getLocationTokens(locationId);

  if (tokens.expiresAt.getTime() - Date.now() < 5 * 60 * 1000) {
    const newAccessToken = await refreshLocationToken(locationId);
    return { accessToken: newAccessToken, realmId: tokens.realmId, tenantId: tokens.tenantId };
  }

  return { accessToken: tokens.accessToken, realmId: tokens.realmId, tenantId: tokens.tenantId };
}

// --------------------------------------------------------------------------
// QBO API request helper — per location
// --------------------------------------------------------------------------

async function qboRequest(
  locationId: string,
  method: "GET" | "POST",
  path: string,
  body?: unknown,
  retried = false,
): Promise<any> {
  const config = getConfig();
  const { accessToken, realmId } = await getValidLocationAccessToken(locationId);
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
    await refreshLocationToken(locationId);
    return qboRequest(locationId, method, path, body, true);
  }

  if (!response.ok) {
    const errorBody = await response.text();
    console.error("[qbo-sync] API error", { status: response.status, url, errorBody });
    throw new Error(`QBO API error ${response.status}: ${errorBody}`);
  }

  return response.json();
}

// --------------------------------------------------------------------------
// OAuth Flow — per location
// --------------------------------------------------------------------------

export async function getAuthorizationUrl(locationId: string, tenantId: string, state: string): Promise<string> {
  const config = getConfig();

  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: "code",
    scope: "com.intuit.quickbooks.accounting",
    state: `${tenantId}:${locationId}:${state}`,
  });

  return `${QBO_AUTH_BASE}?${params.toString()}`;
}

export async function handleCallback(
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
    throw new Error(`QBO token exchange failed: ${response.status} — ${errorBody}`);
  }

  const data = await response.json();

  // Fetch company info to store company name
  let companyName: string | undefined;
  try {
    const tempConfig = getConfig();
    const apiBase = getApiBase(tempConfig.environment);
    const companyRes = await fetch(`${apiBase}/${realmId}/companyinfo/${realmId}?minorversion=73`, {
      headers: { Authorization: `Bearer ${data.access_token}`, Accept: "application/json" },
    });
    if (companyRes.ok) {
      const companyData = await companyRes.json();
      companyName = companyData?.CompanyInfo?.CompanyName;
    }
  } catch {
    // Non-fatal
  }

  await storeLocationTokens(locationId, data.access_token, data.refresh_token, realmId, data.expires_in, companyName);

  await auditLog(tenantId, "QBO_CONNECTED", { locationId, realmId, companyName });

  // Pull chart of accounts and kick off initial sync in background
  pullChartOfAccounts(locationId, tenantId).catch((err) => {
    console.error("[qbo-sync] Initial chart of accounts pull failed", { locationId, err });
  });

  syncAll(locationId, tenantId).catch((err) => {
    console.error("[qbo-sync] Initial full sync failed", { locationId, err });
  });
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

    if (response.status === 400 || response.status === 401) {
      await prisma.location.update({
        where: { id: locationId },
        data: {
          qboAccessToken: null,
          qboRefreshToken: null,
          qboTokenExpiresAt: null,
          qboConnected: false,
        },
      });
      await auditLog(tokens.tenantId, "QBO_DISCONNECTED", { locationId, reason: "refresh_token_expired" });
    }

    throw new Error(`QBO token refresh failed: ${response.status} — ${errorBody}`);
  }

  const data = await response.json();
  await storeLocationTokens(locationId, data.access_token, data.refresh_token, tokens.realmId, data.expires_in);

  return data.access_token;
}

// --------------------------------------------------------------------------
// Chart of Accounts — pull from QBO into local cache
// --------------------------------------------------------------------------

export async function pullChartOfAccounts(locationId: string, tenantId: string): Promise<number> {
  const response = await qboRequest(
    locationId,
    "GET",
    "query?query=SELECT%20*%20FROM%20Account%20MAXRESULTS%201000&minorversion=73",
  );

  const qboAccounts: any[] = response?.QueryResponse?.Account ?? [];

  let upserted = 0;
  for (const acct of qboAccounts) {
    const type = mapQboAccountType(acct.AccountType);
    if (!type) continue;

    await prisma.glAccount.upsert({
      where: {
        // Use a compound unique key: locationId + qboAccountId
        // Prisma requires a unique constraint — we use findFirst + update/create instead
        id: (await prisma.glAccount.findFirst({
          where: { locationId, qboAccountId: acct.Id },
          select: { id: true },
        }))?.id ?? "new",
      },
      create: {
        tenantId,
        locationId,
        qboAccountId: acct.Id,
        accountNumber: acct.AcctNum ?? null,
        name: acct.Name,
        type,
        subType: acct.AccountSubType ?? null,
        isDeferredRevenue: acct.Name?.toLowerCase().includes("deferred") ?? false,
      },
      update: {
        accountNumber: acct.AcctNum ?? null,
        name: acct.Name,
        type,
        subType: acct.AccountSubType ?? null,
      },
    });
    upserted++;
  }

  await prisma.location.update({
    where: { id: locationId },
    data: { qboLastSync: new Date() },
  });

  await auditLog(tenantId, "QBO_ACCOUNTS_PULLED", { locationId, count: upserted });

  return upserted;
}

function mapQboAccountType(qboType: string): string | null {
  const map: Record<string, string> = {
    Bank: "ASSET",
    "Accounts Receivable": "ASSET",
    "Other Current Asset": "ASSET",
    "Fixed Asset": "ASSET",
    "Other Asset": "ASSET",
    "Accounts Payable": "LIABILITY",
    "Credit Card": "LIABILITY",
    "Long Term Liability": "LIABILITY",
    "Other Current Liability": "LIABILITY",
    Equity: "EQUITY",
    Income: "REVENUE",
    "Other Income": "REVENUE",
    "Cost of Goods Sold": "EXPENSE",
    Expense: "EXPENSE",
    "Other Expense": "EXPENSE",
  };
  return map[qboType] ?? null;
}

// --------------------------------------------------------------------------
// Inventory Items — two-way sync
// Helm owns QOH. QBO owns cost/pricing.
// Last-write wins on catalog fields. New items in QBO appear in Helm.
// --------------------------------------------------------------------------

export async function syncInventoryItems(locationId: string, tenantId: string): Promise<{ pulled: number; pushed: number }> {
  let pulled = 0;
  let pushed = 0;

  // 1. Pull all inventory items from QBO
  const response = await qboRequest(
    locationId,
    "GET",
    "query?query=SELECT%20*%20FROM%20Item%20WHERE%20Type%3D%27Inventory%27%20MAXRESULTS%201000&minorversion=73",
  );

  const qboItems: any[] = response?.QueryResponse?.Item ?? [];

  for (const qboItem of qboItems) {
    const existing = await prisma.product.findFirst({
      where: { tenantId, qboItemId: qboItem.Id },
    });

    if (existing) {
      // Update cost/pricing from QBO (QBO is authoritative for these)
      await prisma.product.update({
        where: { id: existing.id },
        data: {
          priceCents: Math.round((qboItem.UnitPrice ?? 0) * 100),
          costCents: Math.round((qboItem.PurchaseCost ?? 0) * 100),
          name: qboItem.Name,
        },
      });
    } else {
      // New item in QBO — create in Helm
      await prisma.product.create({
        data: {
          tenantId,
          qboItemId: qboItem.Id,
          name: qboItem.Name,
          sku: qboItem.Sku ?? null,
          priceCents: Math.round((qboItem.UnitPrice ?? 0) * 100),
          costCents: Math.round((qboItem.PurchaseCost ?? 0) * 100),
          trackInventory: true,
          costingMethod: "WAC",
        },
      });

      // Create inventory record for this location
      const newProduct = await prisma.product.findFirst({
        where: { tenantId, qboItemId: qboItem.Id },
        select: { id: true },
      });
      if (newProduct) {
        await prisma.inventory.create({
          data: {
            tenantId,
            productId: newProduct.id,
            locationId,
            qtyOnHand: Math.round(qboItem.QtyOnHand ?? 0),
          },
        });
      }
    }
    pulled++;
  }

  // 2. Push QOH from Helm → QBO for all tracked products at this location
  const inventoryRecords = await prisma.inventory.findMany({
    where: { tenantId, locationId },
    include: {
      product: { select: { id: true, qboItemId: true, name: true } },
    },
  });

  for (const inv of inventoryRecords) {
    if (!inv.product.qboItemId) continue;

    try {
      // Fetch current QBO item to get SyncToken
      const qboItem = await qboRequest(locationId, "GET", `item/${inv.product.qboItemId}?minorversion=73`);
      const item = qboItem.Item;

      await qboRequest(locationId, "POST", "item?minorversion=73", {
        Id: item.Id,
        SyncToken: item.SyncToken,
        sparse: true,
        QtyOnHand: inv.qtyOnHand,
        InvStartDate: item.InvStartDate,
      });

      pushed++;
    } catch (err) {
      console.error("[qbo-sync] QOH push failed", { productId: inv.product.id, err });
    }
  }

  await prisma.location.update({ where: { id: locationId }, data: { qboLastSync: new Date() } });
  await auditLog(tenantId, "QBO_INVENTORY_SYNCED", { locationId, pulled, pushed });

  return { pulled, pushed };
}

// --------------------------------------------------------------------------
// Entity Sync: Customer
// --------------------------------------------------------------------------

export async function syncCustomer(customerId: string, locationId: string, tenantId: string): Promise<void> {
  const customer = await prisma.customer.findFirst({
    where: { id: customerId, tenantId },
  });

  if (!customer) throw new Error(`Customer ${customerId} not found`);

  const qboCustomerData: Record<string, unknown> = {
    GivenName: customer.firstName || "",
    FamilyName: customer.lastName || "",
    DisplayName: `${customer.firstName || ""} ${customer.lastName || ""}`.trim() || customer.email,
    PrimaryEmailAddr: customer.email ? { Address: customer.email } : undefined,
    PrimaryPhone: customer.phone ? { FreeFormNumber: customer.phone } : undefined,
    CompanyName: (customer as any).company || undefined,
  };

  let result: any;

  if (customer.qboCustomerId) {
    const existing = await qboRequest(locationId, "GET", `customer/${customer.qboCustomerId}?minorversion=73`);
    qboCustomerData.Id = customer.qboCustomerId;
    qboCustomerData.SyncToken = existing.Customer.SyncToken;
    qboCustomerData.sparse = true;
    result = await qboRequest(locationId, "POST", "customer?minorversion=73", qboCustomerData);
  } else {
    result = await qboRequest(locationId, "POST", "customer?minorversion=73", qboCustomerData);
    await prisma.customer.update({
      where: { id: customerId },
      data: { qboCustomerId: result.Customer.Id },
    });
  }

  await auditLog(tenantId, "QBO_CUSTOMER_SYNCED", { customerId, qboCustomerId: result.Customer.Id });
}

// --------------------------------------------------------------------------
// Entity Sync: Invoice
// --------------------------------------------------------------------------

export async function syncInvoice(invoiceId: string, locationId: string, tenantId: string): Promise<void> {
  const invoice = await prisma.invoice.findFirst({
    where: { id: invoiceId, tenantId },
    include: { lineItems: true, customer: true },
  });

  if (!invoice) throw new Error(`Invoice ${invoiceId} not found`);

  if (!invoice.customer.qboCustomerId) {
    await syncCustomer(invoice.customer.id, locationId, tenantId);
    const updated = await prisma.customer.findUnique({ where: { id: invoice.customer.id } });
    if (!updated?.qboCustomerId) throw new Error("Failed to sync customer to QBO before invoice sync");
    (invoice.customer as any).qboCustomerId = updated.qboCustomerId;
  }

  const lineItems = invoice.lineItems.map((item: any, idx: number) => ({
    LineNum: idx + 1,
    Amount: (item.extendedCents + item.taxCents) / 100,
    DetailType: "SalesItemLineDetail",
    Description: item.description || "",
    SalesItemLineDetail: {
      Qty: item.quantity || 1,
      UnitPrice: item.unitPriceCents / 100,
    },
  }));

  const qboInvoiceData: Record<string, unknown> = {
    CustomerRef: { value: invoice.customer.qboCustomerId },
    Line: lineItems,
    DueDate: invoice.dueDate.toISOString().split("T")[0],
    TxnDate: invoice.issuedDate.toISOString().split("T")[0],
    DocNumber: invoice.invoiceNumber,
  };

  let result: any;

  if (invoice.qboInvoiceId) {
    const existing = await qboRequest(locationId, "GET", `invoice/${invoice.qboInvoiceId}?minorversion=73`);
    qboInvoiceData.Id = invoice.qboInvoiceId;
    qboInvoiceData.SyncToken = existing.Invoice.SyncToken;
    qboInvoiceData.sparse = true;
    result = await qboRequest(locationId, "POST", "invoice?minorversion=73", qboInvoiceData);
  } else {
    result = await qboRequest(locationId, "POST", "invoice?minorversion=73", qboInvoiceData);
    await prisma.invoice.update({ where: { id: invoiceId }, data: { qboInvoiceId: result.Invoice.Id } });
  }

  await auditLog(tenantId, "QBO_INVOICE_SYNCED", { invoiceId, qboInvoiceId: result.Invoice.Id });
}

// --------------------------------------------------------------------------
// Entity Sync: Payment
// --------------------------------------------------------------------------

export async function syncPayment(paymentId: string, locationId: string, tenantId: string): Promise<void> {
  const payment = await prisma.payment.findFirst({
    where: { id: paymentId, tenantId },
    include: { customer: true, invoice: true },
  });

  if (!payment) throw new Error(`Payment ${paymentId} not found`);

  if (!payment.customer.qboCustomerId) {
    await syncCustomer(payment.customer.id, locationId, tenantId);
    const updated = await prisma.customer.findUnique({ where: { id: payment.customer.id } });
    (payment.customer as any).qboCustomerId = updated?.qboCustomerId;
  }

  if (!payment.customer.qboCustomerId) throw new Error("Customer has no QBO ID after sync attempt");

  if (payment.invoice?.qboInvoiceId) {
    const qboPaymentData: Record<string, unknown> = {
      CustomerRef: { value: payment.customer.qboCustomerId },
      TotalAmt: payment.amountCents / 100,
      TxnDate: payment.postedDate.toISOString().split("T")[0],
      Line: [
        {
          Amount: payment.amountCents / 100,
          LinkedTxn: [{ TxnId: payment.invoice.qboInvoiceId, TxnType: "Invoice" }],
        },
      ],
    };

    const result = await qboRequest(locationId, "POST", "payment?minorversion=73", qboPaymentData);
    await prisma.payment.update({ where: { id: paymentId }, data: { qboPaymentId: result.Payment.Id } });
    await auditLog(tenantId, "QBO_PAYMENT_SYNCED", { paymentId, qboPaymentId: result.Payment.Id });
  } else {
    const qboReceiptData: Record<string, unknown> = {
      CustomerRef: { value: payment.customer.qboCustomerId },
      TotalAmt: payment.amountCents / 100,
      TxnDate: payment.postedDate.toISOString().split("T")[0],
      Line: [
        {
          Amount: payment.amountCents / 100,
          DetailType: "SalesItemLineDetail",
          Description: `Payment ${paymentId}`,
          SalesItemLineDetail: { Qty: 1, UnitPrice: payment.amountCents / 100 },
        },
      ],
    };

    const result = await qboRequest(locationId, "POST", "salesreceipt?minorversion=73", qboReceiptData);
    await prisma.payment.update({ where: { id: paymentId }, data: { qboPaymentId: result.SalesReceipt.Id } });
    await auditLog(tenantId, "QBO_PAYMENT_SYNCED", { paymentId, type: "SalesReceipt" });
  }
}

// --------------------------------------------------------------------------
// Journal Entry — posts to QBO for a specific location
// --------------------------------------------------------------------------

export async function postJournalEntry(
  locationId: string,
  tenantId: string,
  entries: JournalLineEntry[],
): Promise<void> {
  const totalDebits = entries.reduce((sum, e) => sum + e.debitCents, 0);
  const totalCredits = entries.reduce((sum, e) => sum + e.creditCents, 0);

  if (totalDebits !== totalCredits) {
    throw new Error(`Journal entry is unbalanced: debits=${totalDebits} credits=${totalCredits}`);
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

  const result = await qboRequest(locationId, "POST", "journalentry?minorversion=73", {
    TxnDate: new Date().toISOString().split("T")[0],
    Line: lines,
    PrivateNote: `Helm auto-posted journal entry — location ${locationId}`,
  });

  await auditLog(tenantId, "QBO_JOURNAL_ENTRY_CREATED", {
    locationId,
    qboJournalEntryId: result.JournalEntry.Id,
    totalAmount: totalDebits / 100,
  });
}

// --------------------------------------------------------------------------
// Full Sync — per location
// --------------------------------------------------------------------------

export async function syncAll(
  locationId: string,
  tenantId: string,
): Promise<{ synced: number; failed: number }> {
  let synced = 0;
  let failed = 0;
  const BATCH_SIZE = 50;

  await auditLog(tenantId, "QBO_FULL_SYNC_STARTED", { locationId });

  // 1. Pull chart of accounts
  try {
    const count = await pullChartOfAccounts(locationId, tenantId);
    synced += count;
  } catch (err) {
    failed++;
    console.error("[qbo-sync] Chart of accounts pull failed", { locationId, err });
  }

  // 2. Two-way inventory sync
  try {
    const { pulled, pushed } = await syncInventoryItems(locationId, tenantId);
    synced += pulled + pushed;
  } catch (err) {
    failed++;
    console.error("[qbo-sync] Inventory sync failed", { locationId, err });
  }

  // 3. Sync customers
  const customers = await prisma.customer.findMany({
    where: { tenantId },
    select: { id: true },
    orderBy: { createdAt: "asc" },
  });

  for (let i = 0; i < customers.length; i += BATCH_SIZE) {
    const results = await Promise.allSettled(
      customers.slice(i, i + BATCH_SIZE).map((c) => syncCustomer(c.id, locationId, tenantId)),
    );
    for (const r of results) {
      if (r.status === "fulfilled") synced++;
      else { failed++; console.error("[qbo-sync] Customer sync failed", r.reason); }
    }
  }

  // 4. Sync invoices
  const invoices = await prisma.invoice.findMany({
    where: { tenantId },
    select: { id: true },
    orderBy: { createdAt: "asc" },
  });

  for (let i = 0; i < invoices.length; i += BATCH_SIZE) {
    const results = await Promise.allSettled(
      invoices.slice(i, i + BATCH_SIZE).map((inv) => syncInvoice(inv.id, locationId, tenantId)),
    );
    for (const r of results) {
      if (r.status === "fulfilled") synced++;
      else { failed++; console.error("[qbo-sync] Invoice sync failed", r.reason); }
    }
  }

  // 5. Sync completed payments
  const payments = await prisma.payment.findMany({
    where: { tenantId, status: "COMPLETED" },
    select: { id: true },
    orderBy: { createdAt: "asc" },
  });

  for (let i = 0; i < payments.length; i += BATCH_SIZE) {
    const results = await Promise.allSettled(
      payments.slice(i, i + BATCH_SIZE).map((p) => syncPayment(p.id, locationId, tenantId)),
    );
    for (const r of results) {
      if (r.status === "fulfilled") synced++;
      else { failed++; console.error("[qbo-sync] Payment sync failed", r.reason); }
    }
  }

  await prisma.location.update({ where: { id: locationId }, data: { qboLastSync: new Date() } });
  await auditLog(tenantId, "QBO_FULL_SYNC_COMPLETED", { locationId, synced, failed });

  return { synced, failed };
}

// --------------------------------------------------------------------------
// Scheduled sync — runs every 30 min for all connected locations
// --------------------------------------------------------------------------

export async function runScheduledSync(): Promise<void> {
  const connectedLocations = await prisma.location.findMany({
    where: { qboConnected: true },
    select: { id: true, tenantId: true, name: true },
  });

  console.log(`[qbo-sync] Scheduled sync starting for ${connectedLocations.length} locations`);

  for (const loc of connectedLocations) {
    try {
      // Pull accounts + inventory sync only (not full entity sync every 30 min)
      await pullChartOfAccounts(loc.id, loc.tenantId);
      await syncInventoryItems(loc.id, loc.tenantId);
      console.log(`[qbo-sync] Scheduled sync complete for ${loc.name}`);
    } catch (err) {
      console.error(`[qbo-sync] Scheduled sync failed for ${loc.name}`, err);
    }
  }
}

// --------------------------------------------------------------------------
// Webhook Handler — finds location by realmId
// --------------------------------------------------------------------------

export async function handleQboWebhook(payload: any): Promise<void> {
  if (!payload?.eventNotifications) return;

  for (const notification of payload.eventNotifications) {
    const realmId = notification.realmId;

    const location = await prisma.location.findFirst({
      where: { qboRealmId: realmId },
      select: { id: true, tenantId: true },
    });

    if (!location) {
      console.warn("[qbo-sync] Unknown realmId in webhook", { realmId });
      continue;
    }

    for (const entity of notification.dataChangeEvent?.entities || []) {
      const { name, id, operation } = entity;

      try {
        if (name === "Customer" && (operation === "Create" || operation === "Update")) {
          const qboCustomer = await qboRequest(location.id, "GET", `customer/${id}?minorversion=73`);
          const customer = qboCustomer.Customer;
          const existing = await prisma.customer.findFirst({
            where: { tenantId: location.tenantId, qboCustomerId: id },
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
          }
        }

        if (name === "Invoice" && operation === "Update") {
          const qboInvoice = await qboRequest(location.id, "GET", `invoice/${id}?minorversion=73`);
          const invoice = qboInvoice.Invoice;
          const existing = await prisma.invoice.findFirst({
            where: { tenantId: location.tenantId, qboInvoiceId: id },
          });

          if (existing) {
            const balance = Math.round((invoice.Balance ?? 0) * 100);
            await prisma.invoice.update({
              where: { id: existing.id },
              data: {
                balanceCents: balance,
                status: balance <= 0 ? "PAID" : existing.status,
              },
            });
          }
        }

        if (name === "Item" && (operation === "Create" || operation === "Update")) {
          // New or updated item in QBO — sync back to Helm
          await syncInventoryItems(location.id, location.tenantId);
        }
      } catch (err) {
        console.error("[qbo-sync] Webhook entity processing failed", { name, id, operation, err });
      }
    }
  }
}

// --------------------------------------------------------------------------
// Disconnect — per location
// --------------------------------------------------------------------------

export async function disconnect(locationId: string, tenantId: string): Promise<void> {
  await prisma.location.update({
    where: { id: locationId },
    data: {
      qboAccessToken: null,
      qboRefreshToken: null,
      qboRealmId: null,
      qboTokenExpiresAt: null,
      qboConnected: false,
      qboCompanyName: null,
    },
  });

  await auditLog(tenantId, "QBO_DISCONNECTED", { locationId, reason: "manual_disconnect" });
}

// --------------------------------------------------------------------------
// Status — per location
// --------------------------------------------------------------------------

export async function getLocationStatus(locationId: string): Promise<{
  connected: boolean;
  companyName: string | null;
  realmId: string | null;
  lastSync: Date | null;
  tokenExpiresAt: Date | null;
}> {
  const location = await prisma.location.findUnique({
    where: { id: locationId },
    select: {
      qboConnected: true,
      qboCompanyName: true,
      qboRealmId: true,
      qboLastSync: true,
      qboTokenExpiresAt: true,
    },
  });

  return {
    connected: location?.qboConnected ?? false,
    companyName: location?.qboCompanyName ?? null,
    realmId: location?.qboRealmId ?? null,
    lastSync: location?.qboLastSync ?? null,
    tokenExpiresAt: location?.qboTokenExpiresAt ?? null,
  };
}
