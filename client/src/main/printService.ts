import { BrowserWindow } from 'electron';
import type { DailyZReport, ReceiptData } from '@aeris/shared';
import { PrintReceiptResult } from '../shared-types/ipc';
import { getRelayClient } from './relayBridge';
import { settingsStore } from './settingsStore';
import { logger } from './logger';

// Renders a self-contained receipt HTML in a hidden BrowserWindow and
// drives webContents.print({ silent: true }). The window stays sandboxed
// (contextIsolation + nodeIntegration false + javascript: false): the
// receipt is static markup, no scripts, no remote assets — the renderer's
// CSP would block them anyway and we keep parity here.

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function buildReceiptHtml(receipt: ReceiptData): string {
  const itemsRows = receipt.items
    .map(
      (it) => `
        <tr>
          <td class="i">${escapeHtml(it.name)}</td>
          <td class="q">${it.quantity}</td>
          <td class="t">${escapeHtml(it.line_total)}</td>
        </tr>`,
    )
    .join('');
  const paymentsRows = receipt.payments
    .map(
      (p) => `
        <div class="row">
          <span>${escapeHtml(p.method)}</span>
          <span>${escapeHtml(p.amount)}</span>
        </div>`,
    )
    .join('');
  const servedBy = receipt.served_by
    ? `<div class="served">Served by ${escapeHtml(receipt.served_by)}</div>`
    : '';

  // 80mm thermal-paper friendly: high contrast, monospace, narrow column.
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Receipt ${escapeHtml(receipt.sale_number)}</title>
<style>
  @page { margin: 6mm; size: 80mm auto; }
  * { box-sizing: border-box; }
  body { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 12px; color: #000; background: #fff; margin: 0; padding: 0; }
  .receipt { width: 100%; max-width: 72mm; margin: 0 auto; padding: 4mm 0; }
  .center { text-align: center; }
  .business { font-size: 14px; font-weight: 700; }
  .addr { font-size: 11px; }
  .meta { display: flex; justify-content: space-between; margin-top: 6px; font-size: 11px; }
  .sep { border-top: 1px dashed #000; margin: 6px 0; }
  table { width: 100%; border-collapse: collapse; }
  th, td { padding: 2px 0; font-weight: 400; }
  th { text-align: left; font-size: 11px; border-bottom: 1px solid #000; }
  td.i { text-align: left; }
  td.q { text-align: right; width: 18%; }
  td.t { text-align: right; width: 30%; }
  .row { display: flex; justify-content: space-between; }
  .total { font-weight: 700; font-size: 13px; }
  .served { text-align: center; margin-top: 8px; font-size: 11px; }
  .footer { text-align: center; margin-top: 10px; font-size: 11px; }
</style></head>
<body><div class="receipt">
  <div class="center business">${escapeHtml(receipt.business_name)}</div>
  <div class="center addr">${escapeHtml(receipt.business_address)}</div>
  <div class="meta">
    <span>Sale #${escapeHtml(receipt.sale_number)}</span>
    <span>${escapeHtml(receipt.date)}</span>
  </div>
  <div class="sep"></div>
  <table>
    <thead><tr><th>Item</th><th class="q">Qty</th><th class="t">Total</th></tr></thead>
    <tbody>${itemsRows}</tbody>
  </table>
  <div class="sep"></div>
  <div class="row"><span>Subtotal</span><span>${escapeHtml(receipt.subtotal)}</span></div>
  <div class="row"><span>Tax</span><span>${escapeHtml(receipt.tax)}</span></div>
  <div class="row total"><span>Total</span><span>${escapeHtml(receipt.total)}</span></div>
  ${paymentsRows ? `<div class="sep"></div>${paymentsRows}` : ''}
  ${servedBy}
  <div class="footer">Thank you</div>
</div></body></html>`;
}

function buildTestReceiptHtml(): string {
  const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Aeris Test Page</title>
<style>
  @page { margin: 6mm; size: 80mm auto; }
  body { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 12px; color: #000; background: #fff; margin: 0; padding: 4mm; }
  .center { text-align: center; }
  .title { font-size: 14px; font-weight: 700; }
  .sep { border-top: 1px dashed #000; margin: 8px 0; }
</style></head>
<body>
  <div class="center title">AERIS TEST PRINT</div>
  <div class="sep"></div>
  <div>If you can read this, your printer is wired up correctly.</div>
  <div class="sep"></div>
  <div class="center">${escapeHtml(now)}</div>
</body></html>`;
}

interface PrintHtmlAttempt {
  deviceName?: string;
}

async function printHtml(html: string, attempt: PrintHtmlAttempt): Promise<void> {
  const win = new BrowserWindow({
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // The receipt is static — disabling the script engine removes the
      // attack surface entirely.
      javascript: false,
    },
  });

  // Defence-in-depth: even with javascript:false, refuse window.open() and
  // block any in-window navigation away from the data: URL we just loaded.
  // Mirrors the policy on the main BrowserWindow in window.ts.
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e: { preventDefault: () => void }) => {
    e.preventDefault();
  });

  try {
    const dataUrl =
      'data:text/html;charset=utf-8;base64,' +
      Buffer.from(html, 'utf8').toString('base64');
    await win.loadURL(dataUrl);

    await new Promise<void>((resolve, reject) => {
      try {
        const wc = win.webContents as unknown as {
          print: (
            opts: {
              silent: boolean;
              deviceName?: string;
              printBackground?: boolean;
            },
            cb: (success: boolean, failureReason?: string) => void,
          ) => void;
        };
        wc.print(
          {
            silent: true,
            ...(attempt.deviceName ? { deviceName: attempt.deviceName } : {}),
            printBackground: true,
          },
          (success, failureReason) => {
            if (success) resolve();
            else reject(new Error(failureReason || 'print failed'));
          },
        );
      } catch (err) {
        reject(err as Error);
      }
    });
  } finally {
    try {
      if (!win.isDestroyed()) {
        (win as unknown as { destroy: () => void }).destroy();
      }
    } catch (e) {
      logger.warn('[printService] destroy threw', e);
    }
  }
}

export async function printReceipt(saleId: number): Promise<PrintReceiptResult> {
  let receipt: ReceiptData;
  try {
    receipt = await getRelayClient().getReceipt(saleId);
  } catch (err) {
    const message = (err as Error)?.message || 'Could not load receipt';
    logger.warn('[printService] getReceipt failed', { saleId, message });
    return { ok: false, message };
  }

  const html = buildReceiptHtml(receipt);
  return printWithFallback(html);
}

export async function printTestReceipt(): Promise<PrintReceiptResult> {
  return printWithFallback(buildTestReceiptHtml());
}

function formatMoneyCents(cents: number): string {
  const dollars = (cents || 0) / 100;
  return `$${dollars.toFixed(2)}`;
}

export function buildZReportHtml(
  report: DailyZReport,
  workspaceName: string,
): string {
  const paymentRows = Object.entries(report.payment_method_breakdown || {})
    .map(
      ([method, cents]) => `
        <tr>
          <td>${escapeHtml(method)}</td>
          <td class="r">${escapeHtml(formatMoneyCents(cents as number))}</td>
        </tr>`,
    )
    .join('');
  const staffRows = Object.entries(report.sales_by_staff || {})
    .map(
      ([staff, count]) => `
        <tr>
          <td>${escapeHtml(staff)}</td>
          <td class="r">${count}</td>
        </tr>`,
    )
    .join('');
  // Hourly section is optional — only render the table if data is present.
  const hourlyEntries = Object.entries(report.hourly_breakdown || {});
  const hourlyRows = hourlyEntries
    .map(
      ([hour, count]) => `
        <tr>
          <td>${escapeHtml(hour)}:00</td>
          <td class="r">${count}</td>
        </tr>`,
    )
    .join('');

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Daily Z-report ${escapeHtml(report.date)}</title>
<style>
  @page { margin: 10mm; size: A4; }
  * { box-sizing: border-box; }
  body { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 12px; color: #000; background: #fff; margin: 0; padding: 0; }
  .report { max-width: 180mm; margin: 0 auto; padding: 6mm 0; }
  .center { text-align: center; }
  .business { font-size: 18px; font-weight: 700; }
  .title { font-size: 14px; font-weight: 700; margin-top: 4px; }
  .date { font-size: 12px; margin-top: 2px; }
  .sep { border-top: 1px dashed #000; margin: 8px 0; }
  .section-title { font-size: 13px; font-weight: 700; margin: 10px 0 4px; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 4px; }
  th, td { padding: 3px 6px; font-weight: 400; text-align: left; }
  th { font-size: 11px; border-bottom: 1px solid #000; }
  td.r, th.r { text-align: right; }
  .row { display: flex; justify-content: space-between; padding: 2px 0; }
  .row.total { font-weight: 700; border-top: 1px solid #000; padding-top: 4px; margin-top: 4px; }
</style></head>
<body><div class="report">
  <div class="center business">${escapeHtml(workspaceName)}</div>
  <div class="center title">Daily Z-report</div>
  <div class="center date">${escapeHtml(report.date)}</div>
  <div class="sep"></div>
  <div class="section-title">Totals</div>
  <div class="row"><span>Sales count</span><span>${report.completed_sales}</span></div>
  <div class="row"><span>Pending sales</span><span>${report.pending_sales}</span></div>
  <div class="row"><span>Items sold</span><span>${report.total_items_sold}</span></div>
  <div class="row"><span>Unique customers</span><span>${report.unique_customers}</span></div>
  <div class="row"><span>GST</span><span>${escapeHtml(formatMoneyCents(report.total_gst_cents))}</span></div>
  <div class="row"><span>Discounts</span><span>${escapeHtml(formatMoneyCents(report.total_discount_cents))}</span></div>
  <div class="row"><span>Average sale</span><span>${escapeHtml(formatMoneyCents(report.average_sale_cents))}</span></div>
  <div class="row total"><span>Revenue</span><span>${escapeHtml(formatMoneyCents(report.total_revenue_cents))}</span></div>
  ${
    paymentRows
      ? `<div class="section-title">Payment methods</div>
  <table><thead><tr><th>Method</th><th class="r">Total</th></tr></thead><tbody>${paymentRows}</tbody></table>`
      : ''
  }
  ${
    staffRows
      ? `<div class="section-title">Staff</div>
  <table><thead><tr><th>Staff</th><th class="r">Sales</th></tr></thead><tbody>${staffRows}</tbody></table>`
      : ''
  }
  ${
    hourlyRows
      ? `<div class="section-title">Hourly breakdown</div>
  <table><thead><tr><th>Hour</th><th class="r">Sales</th></tr></thead><tbody>${hourlyRows}</tbody></table>`
      : ''
  }
</div></body></html>`;
}

export async function printZReport(date?: string): Promise<PrintReceiptResult> {
  let report: DailyZReport;
  try {
    report = await getRelayClient().getDailyZReport(date, undefined);
  } catch (err) {
    const message = (err as Error)?.message || 'Could not load Z-report';
    logger.warn('[printService] getDailyZReport failed', { date, message });
    return { ok: false, message };
  }

  const workspaceName = settingsStore.get().workspaceCode || 'Aeris';
  const html = buildZReportHtml(report, workspaceName);
  return printWithFallback(html);
}

async function printWithFallback(html: string): Promise<PrintReceiptResult> {
  const configured = settingsStore.get().printerName;
  const deviceName = configured && configured.trim() !== '' ? configured : undefined;

  try {
    await printHtml(html, { deviceName });
    return { ok: true };
  } catch (err) {
    const firstMessage = (err as Error)?.message || 'print failed';
    if (!deviceName) {
      logger.warn('[printService] system-default print failed', { firstMessage });
      return { ok: false, message: firstMessage };
    }
    // Configured printer not found / rejected the job — retry once on the
    // OS default so a stale settings entry can't block printing entirely.
    logger.warn('[printService] configured printer failed; retrying default', {
      deviceName,
      firstMessage,
    });
    try {
      await printHtml(html, {});
      return { ok: true };
    } catch (err2) {
      const secondMessage = (err2 as Error)?.message || 'print failed';
      return { ok: false, message: secondMessage };
    }
  }
}
