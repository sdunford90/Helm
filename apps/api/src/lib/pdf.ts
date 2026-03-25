import puppeteer from "puppeteer";

// --------------------------------------------------------------------------
// PDF generation
// --------------------------------------------------------------------------

/**
 * Render an HTML string to a PDF buffer using a headless Chromium instance.
 */
export async function generatePdf(
  html: string,
  options?: { landscape?: boolean; format?: string },
): Promise<Buffer> {
  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "networkidle0" });

    const pdf = await page.pdf({
      format: (options?.format as any) ?? "Letter",
      landscape: options?.landscape ?? false,
      printBackground: true,
      margin: { top: "0.5in", right: "0.5in", bottom: "0.5in", left: "0.5in" },
    });

    return Buffer.from(pdf);
  } finally {
    await browser.close();
  }
}

// --------------------------------------------------------------------------
// Invoice PDF template
// --------------------------------------------------------------------------

export function invoicePdfHtml(params: {
  marinaName: string;
  logoUrl?: string;
  primaryColor: string;
  invoiceNumber: string;
  issuedDate: string;
  dueDate: string;
  customerName: string;
  customerAddress: string;
  lineItems: Array<{
    description: string;
    quantity: number;
    unitPrice: number;
    tax: number;
    total: number;
  }>;
  subtotal: number;
  taxTotal: number;
  total: number;
  paymentInstructions?: string;
  lateFeeNotice?: string;
  footerText?: string;
}): string {
  const pc = params.primaryColor;
  const fmt = (n: number) =>
    n.toLocaleString("en-US", { style: "currency", currency: "USD" });

  const logoBlock = params.logoUrl
    ? `<img src="${params.logoUrl}" alt="${params.marinaName}" style="max-height:60px;max-width:200px;" />`
    : `<span style="font-size:24px;font-weight:700;color:${pc};">${params.marinaName}</span>`;

  const rows = params.lineItems
    .map(
      (li) => `
    <tr>
      <td style="padding:8px 12px;border-bottom:1px solid #eee;">${li.description}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #eee;text-align:center;">${li.quantity}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #eee;text-align:right;">${fmt(li.unitPrice)}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #eee;text-align:right;">${fmt(li.tax)}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #eee;text-align:right;font-weight:600;">${fmt(li.total)}</td>
    </tr>`,
    )
    .join("");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #1a1a1a; font-size: 13px; line-height: 1.5; }
    table { width: 100%; border-collapse: collapse; }
  </style>
</head>
<body>
  <!-- Header -->
  <table>
    <tr>
      <td style="padding-bottom:24px;">${logoBlock}</td>
      <td style="padding-bottom:24px;text-align:right;">
        <div style="font-size:28px;font-weight:700;color:${pc};">INVOICE</div>
        <div style="color:#666;margin-top:4px;">${params.invoiceNumber}</div>
      </td>
    </tr>
  </table>

  <!-- Meta -->
  <table style="margin-bottom:24px;">
    <tr>
      <td style="width:50%;vertical-align:top;">
        <div style="font-weight:600;color:#666;font-size:11px;text-transform:uppercase;margin-bottom:4px;">Bill To</div>
        <div style="font-weight:600;">${params.customerName}</div>
        <div style="color:#555;white-space:pre-line;">${params.customerAddress}</div>
      </td>
      <td style="width:50%;vertical-align:top;text-align:right;">
        <div><span style="color:#666;">Issued:</span> ${params.issuedDate}</div>
        <div><span style="color:#666;">Due:</span> <strong>${params.dueDate}</strong></div>
      </td>
    </tr>
  </table>

  <!-- Line items -->
  <table style="margin-bottom:24px;">
    <thead>
      <tr style="background:${pc};color:#fff;">
        <th style="padding:10px 12px;text-align:left;">Description</th>
        <th style="padding:10px 12px;text-align:center;">Qty</th>
        <th style="padding:10px 12px;text-align:right;">Unit Price</th>
        <th style="padding:10px 12px;text-align:right;">Tax</th>
        <th style="padding:10px 12px;text-align:right;">Total</th>
      </tr>
    </thead>
    <tbody>
      ${rows}
    </tbody>
  </table>

  <!-- Totals -->
  <table style="width:300px;margin-left:auto;margin-bottom:32px;">
    <tr>
      <td style="padding:4px 0;">Subtotal</td>
      <td style="padding:4px 0;text-align:right;">${fmt(params.subtotal)}</td>
    </tr>
    <tr>
      <td style="padding:4px 0;">Tax</td>
      <td style="padding:4px 0;text-align:right;">${fmt(params.taxTotal)}</td>
    </tr>
    <tr style="border-top:2px solid ${pc};">
      <td style="padding:8px 0;font-size:16px;font-weight:700;">Total Due</td>
      <td style="padding:8px 0;font-size:16px;font-weight:700;text-align:right;color:${pc};">${fmt(params.total)}</td>
    </tr>
  </table>

  ${params.paymentInstructions ? `<div style="background:#f8f9fa;padding:16px;border-radius:6px;margin-bottom:16px;"><strong>Payment Instructions</strong><br/>${params.paymentInstructions}</div>` : ""}
  ${params.lateFeeNotice ? `<div style="color:#d73a49;font-size:12px;margin-bottom:16px;">${params.lateFeeNotice}</div>` : ""}
  ${params.footerText ? `<div style="font-size:11px;color:#999;border-top:1px solid #eee;padding-top:12px;margin-top:24px;">${params.footerText}</div>` : ""}
</body>
</html>`;
}

// --------------------------------------------------------------------------
// Collection packet template
// --------------------------------------------------------------------------

export function collectionPacketHtml(params: {
  customerName: string;
  balance: number;
  invoices: Array<{ number: string; date: string; amount: number; status: string }>;
  paymentHistory: Array<{ date: string; amount: number; method: string }>;
  communicationLog: Array<{ date: string; channel: string; summary: string }>;
}): string {
  const fmt = (n: number) =>
    n.toLocaleString("en-US", { style: "currency", currency: "USD" });

  const invoiceRows = params.invoices
    .map(
      (inv) =>
        `<tr><td style="padding:6px 8px;border-bottom:1px solid #eee;">${inv.number}</td><td style="padding:6px 8px;border-bottom:1px solid #eee;">${inv.date}</td><td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:right;">${fmt(inv.amount)}</td><td style="padding:6px 8px;border-bottom:1px solid #eee;">${inv.status}</td></tr>`,
    )
    .join("");

  const paymentRows = params.paymentHistory
    .map(
      (p) =>
        `<tr><td style="padding:6px 8px;border-bottom:1px solid #eee;">${p.date}</td><td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:right;">${fmt(p.amount)}</td><td style="padding:6px 8px;border-bottom:1px solid #eee;">${p.method}</td></tr>`,
    )
    .join("");

  const commRows = params.communicationLog
    .map(
      (c) =>
        `<tr><td style="padding:6px 8px;border-bottom:1px solid #eee;">${c.date}</td><td style="padding:6px 8px;border-bottom:1px solid #eee;">${c.channel}</td><td style="padding:6px 8px;border-bottom:1px solid #eee;">${c.summary}</td></tr>`,
    )
    .join("");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #1a1a1a; font-size: 12px; line-height: 1.5; padding: 20px; }
    h1 { font-size: 20px; margin-bottom: 4px; }
    h2 { font-size: 15px; margin: 24px 0 8px; color: #333; border-bottom: 2px solid #0066ff; padding-bottom: 4px; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 16px; }
    th { background: #f4f5f7; padding: 8px; text-align: left; font-size: 11px; text-transform: uppercase; color: #666; }
  </style>
</head>
<body>
  <h1>Collection Packet</h1>
  <p><strong>${params.customerName}</strong> &mdash; Outstanding balance: <strong style="color:#d73a49;">${fmt(params.balance)}</strong></p>

  <h2>Outstanding Invoices</h2>
  <table>
    <thead><tr><th>Invoice</th><th>Date</th><th style="text-align:right;">Amount</th><th>Status</th></tr></thead>
    <tbody>${invoiceRows}</tbody>
  </table>

  <h2>Payment History</h2>
  <table>
    <thead><tr><th>Date</th><th style="text-align:right;">Amount</th><th>Method</th></tr></thead>
    <tbody>${paymentRows}</tbody>
  </table>

  <h2>Communication Log</h2>
  <table>
    <thead><tr><th>Date</th><th>Channel</th><th>Summary</th></tr></thead>
    <tbody>${commRows}</tbody>
  </table>
</body>
</html>`;
}

// --------------------------------------------------------------------------
// Generic report template
// --------------------------------------------------------------------------

export function reportPdfHtml(params: {
  title: string;
  dateRange: string;
  tables: Array<{ headers: string[]; rows: string[][] }>;
}): string {
  const tableSections = params.tables
    .map((t) => {
      const ths = t.headers.map((h) => `<th style="background:#f4f5f7;padding:8px;text-align:left;font-size:11px;text-transform:uppercase;color:#666;">${h}</th>`).join("");
      const trs = t.rows
        .map(
          (row) =>
            `<tr>${row.map((cell) => `<td style="padding:6px 8px;border-bottom:1px solid #eee;">${cell}</td>`).join("")}</tr>`,
        )
        .join("");
      return `<table style="width:100%;border-collapse:collapse;margin-bottom:24px;"><thead><tr>${ths}</tr></thead><tbody>${trs}</tbody></table>`;
    })
    .join("");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #1a1a1a; font-size: 12px; line-height: 1.5; padding: 20px; }
  </style>
</head>
<body>
  <h1 style="font-size:20px;margin-bottom:4px;">${params.title}</h1>
  <p style="color:#666;margin-bottom:24px;">${params.dateRange}</p>
  ${tableSections}
  <p style="font-size:10px;color:#999;margin-top:32px;border-top:1px solid #eee;padding-top:8px;">Generated by Helm</p>
</body>
</html>`;
}
