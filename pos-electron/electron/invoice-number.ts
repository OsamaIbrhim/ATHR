/**
 * The number printed on the receipt and stored as the invoice number:
 * `{terminal_code}-{sequence, 6 digits}` (e.g. `POS1-000123`). It is generated
 * on the device, so it works offline, and the server keeps it verbatim. Same
 * format as the backend's `derivedInvoiceNumber` (used when a till sends none).
 */
export function invoiceNumberFor(terminalCode: string, terminalSequence: string): string {
  // The server accepts letters, digits, '.', '_' and '-'; a terminal code only ever has those.
  const code = terminalCode.replace(/[^A-Za-z0-9._-]/g, '')
  return `${code}-${terminalSequence.padStart(6, '0')}`
}
