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
 * Subtotal, tax and grand total with Gross Up calculation.
 *
 * Rumus Gross Up:
 * Final (Gross) = Subtotal / (1 - (taxRate / 100))
 * taxAmount = grandTotal - subtotal
 *
 * Nilai subtotal adalah nilai bersih yang diterima perusahaan (target closing sales).
 * Nilai grandTotal dibulatkan ke satuan Rupiah penuh terdekat (Math.round).
 * Ketika dipotong pajak sebesar rate% oleh brand/klien, sisa yang diterima perusahaan
 * tepat sama dengan nilai subtotal.
 */
export function computeTotals(
  items: TotalsInput[],
  taxRate: number | null,
): Totals {
  const subtotal = items.reduce((sum, i) => sum + (Number(i.price) || 0), 0);
  const rate = taxRate === null || Number.isNaN(taxRate) ? 0 : taxRate;

  if (rate <= 0 || rate >= 100) {
    const roundedSubtotal = Math.round(subtotal);
    return {
      subtotal: roundedSubtotal,
      taxRate,
      taxAmount: 0,
      grandTotal: roundedSubtotal,
    };
  }

  // Gross up formula: grandTotal = subtotal / (1 - rate / 100)
  const grandTotal = Math.round(subtotal / (1 - rate / 100));
  const taxAmount = grandTotal - Math.round(subtotal);

  return {
    subtotal: Math.round(subtotal),
    taxRate,
    taxAmount,
    grandTotal,
  };
}

