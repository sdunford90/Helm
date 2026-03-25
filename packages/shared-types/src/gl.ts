/** Type of general ledger account. */
export enum GLAccountType {
  ASSET = 'ASSET',
  LIABILITY = 'LIABILITY',
  EQUITY = 'EQUITY',
  REVENUE = 'REVENUE',
  EXPENSE = 'EXPENSE',
}

/** A general ledger account. */
export interface GLAccount {
  id: string;
  tenantId: string;
  /** Account code (e.g. "4010", "5200"). */
  code: string;
  /** Account name (e.g. "Slip Revenue", "Fuel Expense"). */
  name: string;
  /** Account type classification. */
  type: GLAccountType;
  /** Parent account ID for sub-accounts (null = top-level). */
  parentId: string | null;
  /** Whether this account is active. */
  active: boolean;
  /** Description of the account's purpose. */
  description: string | null;
  /** QuickBooks Online account ID for sync. */
  qboAccountId: string | null;
  /** Current balance in cents (debit-positive for assets/expenses, credit-positive for liabilities/equity/revenue). */
  balanceCents: number;
  createdAt: string;
  updatedAt: string;
}

/** A general ledger journal entry (double-entry line). */
export interface GLEntry {
  id: string;
  tenantId: string;
  /** The GL account this entry posts to. */
  accountId: string;
  /** Journal entry batch / transaction reference. */
  journalId: string;
  /** Entry date (ISO date string). */
  entryDate: string;
  /** Debit amount in cents (0 if credit). */
  debitCents: number;
  /** Credit amount in cents (0 if debit). */
  creditCents: number;
  /** Description / memo for this entry. */
  memo: string | null;
  /** Source document type (e.g. "INVOICE", "PAYMENT", "ADJUSTMENT"). */
  sourceType: string | null;
  /** Source document ID. */
  sourceId: string | null;
  /** ID of the user who created the entry. */
  createdBy: string;
  /** Whether this entry has been posted (vs. pending). */
  posted: boolean;
  createdAt: string;
}
