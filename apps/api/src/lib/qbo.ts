import OAuthClient from "intuit-oauth";
import { prisma } from "./prisma.js";

// ---------------------------------------------------------------------------
// QuickBooks Online Integration Client
//
// Handles OAuth 2.0 token management, customer sync, invoice sync,
// payment sync, and chart-of-accounts sync with QBO.
// ---------------------------------------------------------------------------

const QBO_BASE_URL =
  process.env.QBO_ENVIRONMENT === "production"
    ? "https://quickbooks.api.intuit.com"
    : "https://sandbox-quickbooks.api.intuit.com";

let oauthClient: OAuthClient | null = null;

function getOAuthClient(): OAuthClient {
  if (!oauthClient) {
    oauthClient = new OAuthClient({
      clientId: process.env.QBO_CLIENT_ID ?? "",
      clientSecret: process.env.QBO_CLIENT_SECRET ?? "",
      environment: (process.env.QBO_ENVIRONMENT as "sandbox" | "production") ?? "sandbox",
      redirectUri: process.env.QBO_REDIRECT_URI ?? "",
    });
  }
  return oauthClient;
}

/**
 * Generate the QBO OAuth authorization URL.
 */
export function getAuthorizationUrl(state: string): string {
  const client = getOAuthClient();
  return client.authorizeUri({
    scope: [OAuthClient.scopes.Accounting],
    state,
  });
}

/**
 * Exchange an authorization code for tokens and persist them.
 */
export async function handleCallback(
  url: string,
  tenantId: string,
): Promise<{ realmId: string }> {
  const client = getOAuthClient();
  const authResponse = await client.createToken(url);
  const token = authResponse.getJson();

  const realmId = new URL(url, "https://localhost").searchParams.get("realmId") ?? "";

  await prisma.tenant.update({
    where: { id: tenantId },
    data: {
      qboRealmId: realmId,
      qboAccessToken: token.access_token,
      qboRefreshToken: token.refresh_token,
      qboTokenExpiresAt: new Date(Date.now() + token.expires_in * 1000),
    },
  });

  return { realmId };
}

/**
 * Get a valid access token for a tenant, refreshing if expired.
 */
async function getAccessToken(tenantId: string): Promise<{ token: string; realmId: string }> {
  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } });

  if (!tenant.qboRealmId || !tenant.qboAccessToken) {
    throw new Error("QBO not connected for this tenant");
  }

  // Refresh token if expired or expiring within 5 minutes
  const expiresAt = tenant.qboTokenExpiresAt ? new Date(tenant.qboTokenExpiresAt).getTime() : 0;
  if (Date.now() > expiresAt - 5 * 60 * 1000) {
    const client = getOAuthClient();
    client.setToken({
      access_token: tenant.qboAccessToken,
      refresh_token: tenant.qboRefreshToken ?? "",
      token_type: "bearer",
      expires_in: 0,
    });

    const refreshResponse = await client.refresh();
    const newToken = refreshResponse.getJson();

    await prisma.tenant.update({
      where: { id: tenantId },
      data: {
        qboAccessToken: newToken.access_token,
        qboRefreshToken: newToken.refresh_token,
        qboTokenExpiresAt: new Date(Date.now() + newToken.expires_in * 1000),
      },
    });

    return { token: newToken.access_token, realmId: tenant.qboRealmId };
  }

  return { token: tenant.qboAccessToken, realmId: tenant.qboRealmId };
}

/**
 * Make an authenticated request to the QBO API.
 */
async function qboRequest<T>(
  tenantId: string,
  method: "GET" | "POST",
  path: string,
  body?: unknown,
): Promise<T> {
  const { token, realmId } = await getAccessToken(tenantId);
  const url = `${QBO_BASE_URL}/v3/company/${realmId}${path}`;

  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`QBO API error ${res.status}: ${err}`);
  }

  return res.json() as Promise<T>;
}

// ---------------------------------------------------------------------------
// Customer Sync
// ---------------------------------------------------------------------------

export async function syncCustomerToQbo(
  tenantId: string,
  customerId: string,
): Promise<string> {
  const customer = await prisma.customer.findUniqueOrThrow({
    where: { id: customerId },
  });

  const qboCustomer = {
    DisplayName: `${customer.firstName} ${customer.lastName}`,
    GivenName: customer.firstName,
    FamilyName: customer.lastName,
    PrimaryEmailAddr: customer.email ? { Address: customer.email } : undefined,
    PrimaryPhone: customer.phone ? { FreeFormNumber: customer.phone } : undefined,
    BillAddr: customer.address
      ? {
          Line1: customer.address,
          City: customer.city,
          CountrySubDivisionCode: customer.state,
          PostalCode: customer.zip,
        }
      : undefined,
  };

  let qboId: string;

  if (customer.qboCustomerId) {
    // Update existing
    const existing = await qboRequest<{ Customer: { SyncToken: string } }>(
      tenantId,
      "GET",
      `/customer/${customer.qboCustomerId}`,
    );
    const result = await qboRequest<{ Customer: { Id: string } }>(
      tenantId,
      "POST",
      "/customer",
      { ...qboCustomer, Id: customer.qboCustomerId, SyncToken: existing.Customer.SyncToken },
    );
    qboId = result.Customer.Id;
  } else {
    // Create new
    const result = await qboRequest<{ Customer: { Id: string } }>(
      tenantId,
      "POST",
      "/customer",
      qboCustomer,
    );
    qboId = result.Customer.Id;
    await prisma.customer.update({
      where: { id: customerId },
      data: { qboCustomerId: qboId },
    });
  }

  return qboId;
}

// ---------------------------------------------------------------------------
// Invoice Sync
// ---------------------------------------------------------------------------

export async function syncInvoiceToQbo(
  tenantId: string,
  invoiceId: string,
): Promise<string> {
  const invoice = await prisma.invoice.findUniqueOrThrow({
    where: { id: invoiceId },
    include: { lineItems: true, customer: true },
  });

  // Ensure customer is synced first
  let qboCustomerRef = invoice.customer?.qboCustomerId;
  if (!qboCustomerRef && invoice.customerId) {
    qboCustomerRef = await syncCustomerToQbo(tenantId, invoice.customerId);
  }

  const qboInvoice = {
    CustomerRef: { value: qboCustomerRef },
    DueDate: invoice.dueDate?.toISOString().slice(0, 10),
    Line: invoice.lineItems.map((li) => ({
      Amount: li.amountCents / 100,
      Description: li.description,
      DetailType: "SalesItemLineDetail",
      SalesItemLineDetail: {
        ItemRef: li.qboItemId ? { value: li.qboItemId } : undefined,
        Qty: 1,
        UnitPrice: li.amountCents / 100,
      },
    })),
  };

  let qboId: string;

  if (invoice.qboInvoiceId) {
    const existing = await qboRequest<{ Invoice: { SyncToken: string } }>(
      tenantId,
      "GET",
      `/invoice/${invoice.qboInvoiceId}`,
    );
    const result = await qboRequest<{ Invoice: { Id: string } }>(
      tenantId,
      "POST",
      "/invoice",
      { ...qboInvoice, Id: invoice.qboInvoiceId, SyncToken: existing.Invoice.SyncToken },
    );
    qboId = result.Invoice.Id;
  } else {
    const result = await qboRequest<{ Invoice: { Id: string } }>(
      tenantId,
      "POST",
      "/invoice",
      qboInvoice,
    );
    qboId = result.Invoice.Id;
    await prisma.invoice.update({
      where: { id: invoiceId },
      data: { qboInvoiceId: qboId },
    });
  }

  return qboId;
}

// ---------------------------------------------------------------------------
// Payment Sync
// ---------------------------------------------------------------------------

export async function syncPaymentToQbo(
  tenantId: string,
  paymentId: string,
): Promise<string> {
  const payment = await prisma.payment.findUniqueOrThrow({
    where: { id: paymentId },
    include: { invoice: true },
  });

  const qboPayment = {
    TotalAmt: payment.amountCents / 100,
    CustomerRef: payment.invoice?.customerId
      ? { value: (await prisma.customer.findUnique({ where: { id: payment.invoice.customerId } }))?.qboCustomerId }
      : undefined,
    Line: payment.invoiceId
      ? [
          {
            Amount: payment.amountCents / 100,
            LinkedTxn: payment.invoice?.qboInvoiceId
              ? [{ TxnId: payment.invoice.qboInvoiceId, TxnType: "Invoice" }]
              : [],
          },
        ]
      : [],
  };

  const result = await qboRequest<{ Payment: { Id: string } }>(
    tenantId,
    "POST",
    "/payment",
    qboPayment,
  );

  return result.Payment.Id;
}

// ---------------------------------------------------------------------------
// Chart of Accounts Sync
// ---------------------------------------------------------------------------

interface QboAccount {
  Id: string;
  Name: string;
  AccountType: string;
  AccountSubType: string;
  CurrentBalance: number;
  Active: boolean;
}

export async function syncChartOfAccounts(tenantId: string): Promise<number> {
  const result = await qboRequest<{ QueryResponse: { Account: QboAccount[] } }>(
    tenantId,
    "GET",
    "/query?query=SELECT * FROM Account MAXRESULTS 1000",
  );

  const accounts = result.QueryResponse.Account || [];
  let synced = 0;

  for (const acct of accounts) {
    await prisma.glAccount.upsert({
      where: {
        tenantId_accountNumber: {
          tenantId,
          accountNumber: acct.Id,
        },
      },
      update: {
        name: acct.Name,
        qboAccountId: acct.Id,
      },
      create: {
        tenantId,
        accountNumber: acct.Id,
        name: acct.Name,
        accountType: mapQboAccountType(acct.AccountType),
        subType: acct.AccountSubType,
        qboAccountId: acct.Id,
      },
    });
    synced++;
  }

  return synced;
}

function mapQboAccountType(qboType: string): string {
  const mapping: Record<string, string> = {
    Bank: "ASSET",
    "Accounts Receivable": "ASSET",
    "Other Current Asset": "ASSET",
    "Fixed Asset": "ASSET",
    "Other Asset": "ASSET",
    "Accounts Payable": "LIABILITY",
    "Credit Card": "LIABILITY",
    "Other Current Liability": "LIABILITY",
    "Long Term Liability": "LIABILITY",
    Equity: "EQUITY",
    Income: "REVENUE",
    "Other Income": "REVENUE",
    Expense: "EXPENSE",
    "Other Expense": "EXPENSE",
    "Cost of Goods Sold": "EXPENSE",
  };
  return mapping[qboType] ?? "EXPENSE";
}

/**
 * Disconnect QBO for a tenant.
 */
export async function disconnectQbo(tenantId: string): Promise<void> {
  await prisma.tenant.update({
    where: { id: tenantId },
    data: {
      qboRealmId: null,
      qboAccessToken: null,
      qboRefreshToken: null,
      qboTokenExpiresAt: null,
    },
  });
}
