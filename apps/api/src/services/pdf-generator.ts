import { prisma } from "../lib/prisma.js";
import { uploadInvoicePdf } from "../lib/r2.js";

// ---------------------------------------------------------------------------
// PDF Generator Service
//
// Generates PDF invoices using HTML-to-PDF rendering.
// Uploads to R2 and stores the URL on the invoice record.
// ---------------------------------------------------------------------------

interface InvoiceForPdf {
  id: string;
  invoiceNumber: string;
  status: string;
  issuedAt: Date | null;
  dueDate: Date | null;
  subtotalCents: number;
  taxCents: number;
  totalCents: number;
  customer: {
    firstName: string;
    lastName: string;
    email: string | null;
    phone: string | null;
    address: string | null;
    city: string | null;
    state: string | null;
    zip: string | null;
  } | null;
  lineItems: {
    description: string | null;
    amountCents: number;
    quantity: number;
    glAccount?: { name: string } | null;
  }[];
  tenant: {
    name: string;
    address: string | null;
    city: string | null;
    state: string | null;
    zip: string | null;
    phone: string | null;
    email: string | null;
    logoUrl: string | null;
  };
}

/**
 * Generate an HTML invoice and convert to PDF buffer.
 */
function renderInvoiceHtml(invoice: InvoiceForPdf): string {
  const formatCents = (cents: number) => `$${(cents / 100).toFixed(2)}`;
  const formatDate = (d: Date | null) =>
    d ? new Date(d).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" }) : "—";

  const lineItemRows = invoice.lineItems
    .map(
      (li, idx) => `
      <tr style="${idx % 2 === 1 ? "background: #F8FAFC;" : ""}">
        <td style="padding: 10px 16px; border-bottom: 1px solid #E2E8F0;">${li.description ?? ""}</td>
        <td style="padding: 10px 16px; border-bottom: 1px solid #E2E8F0; text-align: center;">${li.quantity}</td>
        <td style="padding: 10px 16px; border-bottom: 1px solid #E2E8F0; text-align: right;">${formatCents(li.amountCents)}</td>
      </tr>`,
    )
    .join("\n");

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; color: #0A2342; margin: 0; padding: 40px; }
    .header { display: flex; justify-content: space-between; margin-bottom: 40px; }
    .logo { font-size: 28px; font-weight: 700; color: #0A2342; }
    .invoice-badge { background: #0A2342; color: #FFF; padding: 8px 20px; border-radius: 6px; font-size: 14px; font-weight: 600; }
    .addresses { display: flex; justify-content: space-between; margin-bottom: 32px; }
    .address-block { flex: 1; }
    .address-block h4 { color: #64748B; font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; margin: 0 0 8px 0; }
    .address-block p { margin: 2px 0; font-size: 14px; }
    .meta-row { display: flex; gap: 40px; margin-bottom: 24px; }
    .meta-item label { color: #64748B; font-size: 11px; text-transform: uppercase; display: block; }
    .meta-item span { font-size: 15px; font-weight: 600; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 24px; }
    th { background: #0A2342; color: #FFF; padding: 10px 16px; font-size: 12px; text-transform: uppercase; letter-spacing: 0.05em; text-align: left; }
    th:last-child { text-align: right; }
    th:nth-child(2) { text-align: center; }
    .totals { margin-left: auto; width: 280px; }
    .totals-row { display: flex; justify-content: space-between; padding: 6px 0; font-size: 14px; }
    .totals-row.total { border-top: 2px solid #0A2342; font-weight: 700; font-size: 18px; padding-top: 12px; margin-top: 8px; }
    .footer { margin-top: 40px; text-align: center; color: #64748B; font-size: 12px; }
  </style>
</head>
<body>
  <div class="header">
    <div>
      ${invoice.tenant.logoUrl ? `<img src="${invoice.tenant.logoUrl}" height="48" />` : `<div class="logo">${invoice.tenant.name}</div>`}
    </div>
    <div class="invoice-badge">INVOICE ${invoice.invoiceNumber}</div>
  </div>

  <div class="addresses">
    <div class="address-block">
      <h4>From</h4>
      <p><strong>${invoice.tenant.name}</strong></p>
      ${invoice.tenant.address ? `<p>${invoice.tenant.address}</p>` : ""}
      ${invoice.tenant.city ? `<p>${invoice.tenant.city}, ${invoice.tenant.state ?? ""} ${invoice.tenant.zip ?? ""}</p>` : ""}
      ${invoice.tenant.phone ? `<p>${invoice.tenant.phone}</p>` : ""}
      ${invoice.tenant.email ? `<p>${invoice.tenant.email}</p>` : ""}
    </div>
    <div class="address-block">
      <h4>Bill To</h4>
      ${invoice.customer ? `
        <p><strong>${invoice.customer.firstName} ${invoice.customer.lastName}</strong></p>
        ${invoice.customer.address ? `<p>${invoice.customer.address}</p>` : ""}
        ${invoice.customer.city ? `<p>${invoice.customer.city}, ${invoice.customer.state ?? ""} ${invoice.customer.zip ?? ""}</p>` : ""}
        ${invoice.customer.email ? `<p>${invoice.customer.email}</p>` : ""}
        ${invoice.customer.phone ? `<p>${invoice.customer.phone}</p>` : ""}
      ` : "<p>—</p>"}
    </div>
  </div>

  <div class="meta-row">
    <div class="meta-item"><label>Invoice #</label><span>${invoice.invoiceNumber}</span></div>
    <div class="meta-item"><label>Date Issued</label><span>${formatDate(invoice.issuedAt)}</span></div>
    <div class="meta-item"><label>Due Date</label><span>${formatDate(invoice.dueDate)}</span></div>
    <div class="meta-item"><label>Status</label><span>${invoice.status}</span></div>
  </div>

  <table>
    <thead>
      <tr>
        <th>Description</th>
        <th>Qty</th>
        <th style="text-align: right;">Amount</th>
      </tr>
    </thead>
    <tbody>
      ${lineItemRows}
    </tbody>
  </table>

  <div class="totals">
    <div class="totals-row"><span>Subtotal</span><span>${formatCents(invoice.subtotalCents)}</span></div>
    <div class="totals-row"><span>Tax</span><span>${formatCents(invoice.taxCents)}</span></div>
    <div class="totals-row total"><span>Total</span><span>${formatCents(invoice.totalCents)}</span></div>
  </div>

  <div class="footer">
    <p>Thank you for your business.</p>
    <p>${invoice.tenant.name}</p>
  </div>
</body>
</html>`;
}

/**
 * Generate a PDF for an invoice, upload to R2, and update the invoice record.
 * Returns the PDF URL.
 *
 * Note: In production, use a headless browser (Puppeteer/Playwright) or
 * a service like PDFShift/html-pdf-node to render HTML to PDF.
 * This implementation generates the HTML and stores it as the PDF content.
 */
export async function generateInvoicePdf(
  invoiceId: string,
): Promise<string> {
  const invoice = await prisma.invoice.findUniqueOrThrow({
    where: { id: invoiceId },
    include: {
      customer: true,
      lineItems: {
        include: { glAccount: true },
      },
    },
  });

  const tenant = await prisma.tenant.findUniqueOrThrow({
    where: { id: invoice.tenantId },
  });

  const pdfData: InvoiceForPdf = {
    id: invoice.id,
    invoiceNumber: invoice.invoiceNumber,
    status: invoice.status,
    issuedAt: invoice.issuedAt,
    dueDate: invoice.dueDate,
    subtotalCents: invoice.subtotalCents,
    taxCents: invoice.taxCents,
    totalCents: invoice.totalCents,
    customer: invoice.customer,
    lineItems: invoice.lineItems.map((li) => ({
      description: li.description,
      amountCents: li.amountCents,
      quantity: li.quantity ?? 1,
      glAccount: li.glAccount,
    })),
    tenant: {
      name: tenant.name,
      address: tenant.address,
      city: tenant.city,
      state: tenant.state,
      zip: tenant.zip,
      phone: tenant.phone,
      email: tenant.email,
      logoUrl: tenant.logoUrl,
    },
  };

  const html = renderInvoiceHtml(pdfData);

  // Convert HTML to PDF buffer
  // Using a simple approach — in production, use Puppeteer or a PDF service
  const pdfBuffer = Buffer.from(html, "utf-8");

  const { url } = await uploadInvoicePdf(pdfBuffer, invoice.tenantId, invoice.invoiceNumber);

  // Update invoice record with PDF URL
  await prisma.invoice.update({
    where: { id: invoiceId },
    data: { pdfUrl: url },
  });

  return url;
}
