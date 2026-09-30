/**
 * Document arithmetic, shared by the server action and the live preview.
 *
 * This lives outside the `'use server'` module because Next.js only permits
 * async exports from those, and because the form needs the same calculation in
 * the browser to render its preview. One definition, used twice, is the only
 * way the preview and the stored document cannot drift apart - a second
 * implementation is how a preview starts promising a total the invoice does not
 * deliver.
 */

export interface TotalsInput {
  price: number;
}

export interface Totals {
  subtotal: number;
  taxRate: number | null;
  taxAmount: number;
  grandTotal: number;
}

/**
 * Subtotal, tax and grand total.
 *
 * The tax RATE is typed by the user; the multiplication is done here. That
 * split is deliberate. The TNT sample has `PPN 11%` struck through with a
 * different figure in its place and HYPE quotes 0,5%, so the rate is a business
 * decision that may change again. The arithmetic is not, and a document that
 * carries a real bank account cannot be allowed to add up wrongly.
 */
export function computeTotals(
  items: TotalsInput[],
  taxRate: number | null,
): Totals {
  const subtotal = items.reduce((sum, i) => sum + (Number(i.price) || 0), 0);
  const rate = taxRate === null || Number.isNaN(taxRate) ? 0 : taxRate;
  const taxAmount = (subtotal * rate) / 100;

  return {
    subtotal: round2(subtotal),
    taxRate,
    taxAmount: round2(taxAmount),
    // Below a cent the extra precision is noise, and a printed total the client
    // cannot reproduce with their own addition loses the argument.
    grandTotal: round2(subtotal + taxAmount),
  };
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}
