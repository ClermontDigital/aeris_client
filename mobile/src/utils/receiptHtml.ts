// Legacy HTML receipt — phone-rendered, used as the PDF_PRINT_ENABLED=false
// fallback. Kept around (not deleted on the v1.3.53 flag flip) so a flag
// revert can re-ship without server changes.
//
// Extracted from CheckoutScreen so ReceiptViewerScreen / future SaleDetail
// reprint flows share the same fallback.

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function buildReceiptHtml(receipt: {
  business_name: string;
  sale_number: string;
  date: string;
  items: Array<{name: string; quantity: number; unit_price: string; line_total: string}>;
  subtotal: string;
  tax: string;
  total: string;
  payments: Array<{method: string; amount: string}>;
  served_by: string | null;
}): string {
  const itemRows = receipt.items
    .map(
      i =>
        `<tr><td>${escapeHtml(i.name)}</td><td>${i.quantity}</td><td>${escapeHtml(i.unit_price)}</td><td>${escapeHtml(i.line_total)}</td></tr>`,
    )
    .join('');

  const paymentRows = receipt.payments
    .map(p => `<p>${escapeHtml(p.method)}: ${escapeHtml(p.amount)}</p>`)
    .join('');

  return `
    <html>
    <head><style>
      body { font-family: monospace; font-size: 12px; padding: 10px; }
      h2 { text-align: center; margin-bottom: 4px; }
      .info { text-align: center; font-size: 11px; color: #666; }
      table { width: 100%; border-collapse: collapse; margin: 8px 0; }
      td { padding: 2px 4px; }
      .sep { border-top: 1px dashed #333; margin: 6px 0; }
      .totals td:first-child { font-weight: bold; }
      .total-row td { font-size: 14px; font-weight: bold; }
    </style></head>
    <body>
      <h2>${escapeHtml(receipt.business_name)}</h2>
      <p class="info">Sale #${escapeHtml(receipt.sale_number)}</p>
      <p class="info">${escapeHtml(receipt.date)}</p>
      <div class="sep"></div>
      <table>
        <tr><th>Item</th><th>Qty</th><th>Price</th><th>Total</th></tr>
        ${itemRows}
      </table>
      <div class="sep"></div>
      <table class="totals">
        <tr><td>Subtotal</td><td>${escapeHtml(receipt.subtotal)}</td></tr>
        <tr><td>Tax</td><td>${escapeHtml(receipt.tax)}</td></tr>
        <tr class="total-row"><td>Total</td><td>${escapeHtml(receipt.total)}</td></tr>
      </table>
      <div class="sep"></div>
      ${paymentRows}
      ${receipt.served_by ? `<p class="info">Served by: ${escapeHtml(receipt.served_by)}</p>` : ''}
    </body>
    </html>
  `;
}
