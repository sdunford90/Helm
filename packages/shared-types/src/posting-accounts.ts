// Plan 94 — Single source of truth for the 18 per-location posting-account
// pins surfaced in Settings → Accounting → Posting Accounts.
//
// Each spec carries:
//   - field:    the Location column name
//   - label:    operator-facing name
//   - group:    section heading in the UI (Cash & Banking / A/R & A/P / etc.)
//   - subType:  array of QBO AccountSubType values the dropdown should
//               filter on. Pulled from QBO's standardized list. When more
//               than one is listed, any match is acceptable.
//   - typeFilter: GLAccountType values acceptable when subType is unknown
//                 or the chart was hand-built (lower-quality fallback).
//   - required: ERROR severity in Accounting Completeness if missing.
//
// Importing the spec from one place lets the GET/PUT route, the UI panel,
// and the Accounting Completeness report stay aligned automatically when
// we add or rename a pin.

export type GlPinGroup =
  | "Cash & Banking"
  | "A/R & A/P"
  | "Sales Tax"
  | "Revenue by Stream"
  | "POS Z-out Clearing"
  | "Other";

export interface PostingAccountSpec {
  field: string;
  label: string;
  description?: string;
  group: GlPinGroup;
  subType: string[];
  typeFilter: string[];
  required: boolean;
}

export const POSTING_ACCOUNT_SPECS: PostingAccountSpec[] = [
  // ── Cash & Banking ──────────────────────────────────────────────────────
  {
    field: "bankGlAccountId",
    label: "Operating Bank",
    description: "The marina's main bank account. Deposits clear into here.",
    group: "Cash & Banking",
    subType: ["Checking", "Savings", "Bank"],
    typeFilter: ["ASSET"],
    required: false,
  },
  {
    field: "cashGlAccountId",
    label: "Cash Drawer",
    description: "Counted cash at the front desk. POS Z-out debits this.",
    group: "Cash & Banking",
    subType: ["CashOnHand", "Bank"],
    typeFilter: ["ASSET"],
    required: false,
  },
  {
    field: "undepositedFundsGlAccountId",
    label: "Undeposited Funds",
    description: "Holding account for checks and cash awaiting bank deposit.",
    group: "Cash & Banking",
    subType: ["UndepositedFunds"],
    typeFilter: ["ASSET"],
    required: false,
  },
  {
    field: "stripeClearingGlAccountId",
    label: "Stripe Clearing",
    description: "Card payments land here until Stripe payouts hit the bank.",
    group: "Cash & Banking",
    subType: ["OtherCurrentAssets"],
    typeFilter: ["ASSET"],
    required: false,
  },
  {
    field: "achClearingGlAccountId",
    label: "ACH Clearing",
    description: "ACH payments land here until the bank ACH credit clears.",
    group: "Cash & Banking",
    subType: ["OtherCurrentAssets"],
    typeFilter: ["ASSET"],
    required: false,
  },

  // ── A/R & A/P ───────────────────────────────────────────────────────────
  {
    field: "arGlAccountId",
    label: "Accounts Receivable",
    description: "Money customers owe — invoiced but unpaid.",
    group: "A/R & A/P",
    subType: ["AccountsReceivable"],
    typeFilter: ["ASSET"],
    required: true,
  },
  {
    field: "accountsPayableGlAccountId",
    label: "Accounts Payable",
    description: "Money owed to vendors — PO receipts post here.",
    group: "A/R & A/P",
    subType: ["AccountsPayable"],
    typeFilter: ["LIABILITY"],
    required: false,
  },

  // ── Sales Tax ───────────────────────────────────────────────────────────
  {
    field: "salesTaxGlAccountId",
    label: "Sales Tax Payable",
    description: "Sales tax collected from customers, owed to the jurisdiction.",
    group: "Sales Tax",
    subType: ["SalesTaxPayable"],
    typeFilter: ["LIABILITY"],
    required: true,
  },

  // ── Revenue by Stream ───────────────────────────────────────────────────
  {
    field: "defaultRevenueGlAccountId",
    label: "Default Revenue",
    description: "Catch-all revenue account for sellable things without a more-specific pin.",
    group: "Revenue by Stream",
    subType: ["SalesOfProductIncome", "ServiceFeeIncome", "OtherPrimaryIncome"],
    typeFilter: ["REVENUE"],
    required: true,
  },
  {
    field: "transientRevenueGlAccountId",
    label: "Transient Bookings",
    description: "Revenue from transient (overnight/weekly) slip rentals.",
    group: "Revenue by Stream",
    subType: ["SalesOfProductIncome", "ServiceFeeIncome", "OtherPrimaryIncome"],
    typeFilter: ["REVENUE"],
    required: false,
  },
  {
    field: "rampRevenueGlAccountId",
    label: "Launch Ramp",
    description: "Revenue from ramp tickets and trailer fees.",
    group: "Revenue by Stream",
    subType: ["SalesOfProductIncome", "ServiceFeeIncome", "OtherPrimaryIncome"],
    typeFilter: ["REVENUE"],
    required: false,
  },
  {
    field: "conciergeRevenueGlAccountId",
    label: "Concierge Services",
    description: "Revenue from concierge work — washes, detailing, errands.",
    group: "Revenue by Stream",
    subType: ["SalesOfProductIncome", "ServiceFeeIncome", "OtherPrimaryIncome"],
    typeFilter: ["REVENUE"],
    required: false,
  },
  {
    field: "fuelRevenueGlAccountId",
    label: "Fuel Sales",
    description: "Revenue from fuel sold at the marina pump.",
    group: "Revenue by Stream",
    subType: ["SalesOfProductIncome", "OtherPrimaryIncome"],
    typeFilter: ["REVENUE"],
    required: false,
  },
  {
    field: "electricityRevenueGlAccountId",
    label: "Electricity Passthrough",
    description: "Revenue from metered electricity billed to slip-holders.",
    group: "Revenue by Stream",
    subType: ["SalesOfProductIncome", "ServiceFeeIncome", "OtherPrimaryIncome"],
    typeFilter: ["REVENUE"],
    required: false,
  },
  {
    field: "earlyTerminationGlAccountId",
    label: "Early Termination Income",
    description: "Revenue from contract early-termination penalties.",
    group: "Revenue by Stream",
    subType: ["OtherPrimaryIncome", "ServiceFeeIncome"],
    typeFilter: ["REVENUE"],
    required: true,
  },
  {
    field: "achReturnFeeGlAccountId",
    label: "ACH Return Fee",
    description: "Revenue from fees charged when a customer ACH bounces.",
    group: "Revenue by Stream",
    subType: ["OtherPrimaryIncome", "ServiceFeeIncome"],
    typeFilter: ["REVENUE"],
    required: true,
  },

  // ── POS Z-out Clearing ──────────────────────────────────────────────────
  {
    field: "tipsPayableGlAccountId",
    label: "Tips Payable",
    description: "Tips held as a liability owed to staff until payout.",
    group: "POS Z-out Clearing",
    subType: ["OtherCurrentLiabilities"],
    typeFilter: ["LIABILITY"],
    required: false,
  },
  {
    field: "cashOverShortGlAccountId",
    label: "Cash Over / Short",
    description: "Mystery variance between counted cash and expected — expense or income.",
    group: "POS Z-out Clearing",
    subType: ["OtherMiscellaneousExpense", "OtherMiscellaneousIncome"],
    typeFilter: ["EXPENSE", "REVENUE"],
    required: false,
  },

  // ── Other ────────────────────────────────────────────────────────────────
  {
    field: "deferredRevenueGlAccountId",
    label: "Deferred Revenue",
    description: "Pre-paid contract balances recognized over time as service is delivered.",
    group: "Other",
    subType: ["OtherCurrentLiabilities"],
    typeFilter: ["LIABILITY"],
    required: false,
  },
];

export const POSTING_ACCOUNT_GROUPS: GlPinGroup[] = [
  "Cash & Banking",
  "A/R & A/P",
  "Sales Tax",
  "Revenue by Stream",
  "POS Z-out Clearing",
  "Other",
];
