import archiver from "archiver";
import { Buffer } from "node:buffer";
import { prisma } from "../lib/prisma.js";

// --------------------------------------------------------------------------
// Tenant data export
//
// Walks the tenant's rows table-by-table, writes one CSV per table into
// a ZIP archive, and stores the resulting bytes either on R2 (when
// configured) or in the TenantExport.localBlob column. Either way the
// downloadToken on the export record is the only credential needed to
// retrieve the file.
//
// Kept intentionally synchronous — for any tenant beyond the largest in
// our dev fixture the buffer fits comfortably in memory and the request
// completes in well under the platform's request budget. If a future
// tenant balloons past that, swap this for a queued worker.
// --------------------------------------------------------------------------

const EXPIRY_MS = 7 * 24 * 60 * 60 * 1000;

interface TableSpec {
  name: string;
  fetch: (tenantId: string) => Promise<Record<string, unknown>[]>;
}

// Tables included in the export. Anything missing here is intentionally
// omitted (e.g. internal queue state, per-tenant audit logs are exported
// in their own file but admin audit logs are not).
const TABLES: TableSpec[] = [
  { name: "tenant",          fetch: (id) => prisma.tenant.findMany({ where: { id } }).then(asPlain) },
  { name: "users",           fetch: (id) => prisma.user.findMany({ where: { tenantId: id } }).then(asPlain) },
  { name: "locations",       fetch: (id) => prisma.location.findMany({ where: { tenantId: id } }).then(asPlain) },
  { name: "customers",       fetch: (id) => prisma.customer.findMany({ where: { tenantId: id } }).then(asPlain) },
  { name: "boats",           fetch: (id) => prisma.boat.findMany({ where: { tenantId: id } }).then(asPlain) },
  { name: "slips",           fetch: (id) => prisma.slip.findMany({ where: { tenantId: id } }).then(asPlain) },
  { name: "slip_contracts",  fetch: (id) => prisma.slipContract.findMany({ where: { tenantId: id } }).then(asPlain) },
  { name: "invoices",        fetch: (id) => prisma.invoice.findMany({ where: { tenantId: id } }).then(asPlain) },
  { name: "invoice_line_items", fetch: (id) => prisma.invoiceLineItem.findMany({ where: { invoice: { tenantId: id } } }).then(asPlain) },
  { name: "payments",        fetch: (id) => prisma.payment.findMany({ where: { tenantId: id } }).then(asPlain) },
  { name: "leads",           fetch: (id) => prisma.lead.findMany({ where: { tenantId: id } }).then(asPlain) },
  { name: "waitlist_entries",fetch: (id) => prisma.waitlistEntry.findMany({ where: { tenantId: id } }).then(asPlain) },
  { name: "transient_bookings",fetch: (id) => prisma.transientBooking.findMany({ where: { tenantId: id } }).then(asPlain) },
  { name: "ramp_tickets",    fetch: (id) => prisma.rampTicket.findMany({ where: { tenantId: id } }).then(asPlain) },
  { name: "concierge_requests",fetch: (id) => prisma.conciergeRequest.findMany({ where: { tenantId: id } }).then(asPlain) },
  { name: "pos_transactions",fetch: (id) => prisma.posTransaction.findMany({ where: { tenantId: id } }).then(asPlain) },
  { name: "products",        fetch: (id) => prisma.product.findMany({ where: { tenantId: id } }).then(asPlain) },
  { name: "dock_walks",      fetch: (id) => prisma.dockWalk.findMany({ where: { tenantId: id } }).then(asPlain) },
  { name: "dock_walk_items", fetch: (id) => prisma.dockWalkItem.findMany({ where: { dockWalk: { tenantId: id } } }).then(asPlain) },
  { name: "support_tickets", fetch: (id) => prisma.supportTicket.findMany({ where: { tenantId: id } }).then(asPlain) },
  { name: "audit_logs",      fetch: (id) => prisma.auditLog.findMany({ where: { tenantId: id } }).then(asPlain) },
  { name: "saas_invoices",   fetch: (id) => prisma.saasInvoice.findMany({ where: { tenantId: id } }).then(asPlain) },
];

function asPlain(rows: unknown): Record<string, unknown>[] {
  return rows as Record<string, unknown>[];
}

function escapeCsv(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString();
  let str: string;
  if (typeof value === "object") {
    try { str = JSON.stringify(value); } catch { str = String(value); }
  } else {
    str = String(value);
  }
  if (/[",\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function toCsv(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return "";
  // Union of keys across all rows so partial-shape rows still serialise.
  const headers: string[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    for (const k of Object.keys(row)) {
      if (!seen.has(k)) {
        seen.add(k);
        headers.push(k);
      }
    }
  }
  const lines = [headers.join(",")];
  for (const row of rows) {
    lines.push(headers.map((h) => escapeCsv(row[h])).join(","));
  }
  return lines.join("\n");
}

interface BuildResult {
  buffer: Buffer;
  rowCounts: Record<string, number>;
}

async function buildArchive(tenantId: string): Promise<BuildResult> {
  const archive = archiver("zip", { zlib: { level: 6 } });
  const chunks: Buffer[] = [];

  // Read directly from the archive's read side. Collect chunks and a
  // single completion promise so we know exactly when the zip is done.
  const done = new Promise<void>((resolve, reject) => {
    archive.on("data", (c: Buffer) => chunks.push(c));
    archive.on("end", () => resolve());
    archive.on("warning", (err) => {
      // ENOENT etc. are warnings, not fatal
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") reject(err);
    });
    archive.on("error", reject);
  });

  const rowCounts: Record<string, number> = {};

  archive.append(
    [
      `Helm tenant export`,
      `Tenant ID: ${tenantId}`,
      `Generated at: ${new Date().toISOString()}`,
      ``,
      `One CSV per table; column set is the union of fields present across the`,
      `exported rows. Date columns are ISO-8601, JSON columns are inlined as`,
      `JSON strings. This export does NOT include uploaded files (boat photos,`,
      `insurance documents, etc.) — those continue to live in object storage.`,
      ``,
    ].join("\n"),
    { name: "README.txt" },
  );

  for (const spec of TABLES) {
    let rows: Record<string, unknown>[];
    try {
      rows = await spec.fetch(tenantId);
    } catch (err) {
      // A table may not exist if a future migration is rolled back — skip
      // it rather than fail the whole export.
      // eslint-disable-next-line no-console
      console.warn(`[tenant-export] failed to read ${spec.name}:`, err);
      continue;
    }
    rowCounts[spec.name] = rows.length;
    archive.append(toCsv(rows), { name: `${spec.name}.csv` });
  }

  // finalize() tells archiver no more entries are coming. The 'end' event
  // on the read side fires once the trailing central directory is flushed.
  archive.finalize().catch(() => undefined);
  await done;

  return { buffer: Buffer.concat(chunks), rowCounts };
}

interface ExportArgs {
  tenantId: string;
  requestedById: string;
  requestedByEmail: string;
}

/**
 * Create + run a tenant export. Returns the persisted TenantExport row.
 * The download URL is the API endpoint plus the export's download token.
 */
export async function runTenantExport(args: ExportArgs) {
  const record = await prisma.tenantExport.create({
    data: {
      tenantId: args.tenantId,
      requestedById: args.requestedById,
      requestedByEmail: args.requestedByEmail,
      status: "RUNNING",
      startedAt: new Date(),
    },
  });

  try {
    const { buffer, rowCounts } = await buildArchive(args.tenantId);
    const expiresAt = new Date(Date.now() + EXPIRY_MS);

    return await prisma.tenantExport.update({
      where: { id: record.id },
      data: {
        status: "COMPLETED",
        completedAt: new Date(),
        fileSizeBytes: buffer.byteLength,
        rowCounts,
        expiresAt,
        // Always store the bytes locally; if R2 is wired in later the
        // upload can populate storageKey too. Keeping a local copy means
        // download works in any environment without external storage.
        localBlob: new Uint8Array(buffer),
      },
    });
  } catch (err) {
    return await prisma.tenantExport.update({
      where: { id: record.id },
      data: {
        status: "FAILED",
        completedAt: new Date(),
        errorMsg: (err as Error).message ?? "export failed",
      },
    });
  }
}

/**
 * Strip the heavy `localBlob` column from a TenantExport row so the API
 * can return metadata-only views without serialising megabytes of bytes.
 */
export function publicExportView<
  T extends { localBlob?: Buffer | Uint8Array | null },
>(row: T): Omit<T, "localBlob"> {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { localBlob, ...rest } = row;
  return rest;
}
