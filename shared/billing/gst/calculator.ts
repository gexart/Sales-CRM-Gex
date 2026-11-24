import Decimal from 'decimal.js';

// Configure Decimal for half-up rounding (Indian GST & SME accounting standard)
Decimal.set({
  precision: 28,
  rounding: Decimal.ROUND_HALF_UP,
});

export interface GstLineItemInput {
  quantity: string | number | Decimal;
  unitPrice: string | number | Decimal; // rate per unit
  isTaxInclusive: boolean;
  taxRatePercent: string | number | Decimal; // e.g. "18" for 18%
  discountPercent?: string | number | Decimal; // e.g. "5" for 5%
  discountAmount?: string | number | Decimal; // fixed discount per line
  cessPercent?: string | number | Decimal; // e.g. "12" for 12%
}

export interface GstCalculationContext {
  sellerStateCode: string;
  placeOfSupplyStateCode: string;
  isExportOrSez?: boolean;
  isZeroRated?: boolean;
}

export interface GstLineCalculationResult {
  quantity: Decimal;
  unitPrice: Decimal;
  grossAmount: Decimal;
  discountAmount: Decimal;
  taxableAmount: Decimal;
  taxRatePercent: Decimal;
  cgstRatePercent: Decimal;
  cgstAmount: Decimal;
  sgstRatePercent: Decimal;
  sgstAmount: Decimal;
  igstRatePercent: Decimal;
  igstAmount: Decimal;
  cessRatePercent: Decimal;
  cessAmount: Decimal;
  totalTaxAmount: Decimal;
  totalLineAmount: Decimal;
  isIntraState: boolean;
}

export interface GstDocumentCalculationResult {
  lines: GstLineCalculationResult[];
  taxableSubtotal: Decimal;
  cgstTotal: Decimal;
  sgstTotal: Decimal;
  igstTotal: Decimal;
  cessTotal: Decimal;
  taxTotal: Decimal;
  extraDiscountAmount: Decimal;
  netBeforeRoundOff: Decimal;
  roundOffAmount: Decimal;
  grandTotal: Decimal;
}

/**
 * Calculates GST breakdown for a single line item.
 */
export function calculateLineGst(
  item: GstLineItemInput,
  context: GstCalculationContext,
): GstLineCalculationResult {
  const qty = new Decimal(item.quantity);
  const price = new Decimal(item.unitPrice);
  const taxRate = new Decimal(item.taxRatePercent || 0);
  const cessRate = new Decimal(item.cessPercent || 0);

  const isIntraState =
    !context.isExportOrSez &&
    context.sellerStateCode.padStart(2, '0') ===
      context.placeOfSupplyStateCode.padStart(2, '0');

  const grossLine = qty.mul(price);
  let discount = new Decimal(0);

  if (item.discountAmount) {
    discount = new Decimal(item.discountAmount);
  } else if (item.discountPercent) {
    const discPct = new Decimal(item.discountPercent);
    discount = grossLine.mul(discPct).div(100);
  }

  const effectiveTotal = grossLine.minus(discount);

  let taxableAmount: Decimal;

  const totalRateFactor = new Decimal(1).plus(taxRate.plus(cessRate).div(100));

  if (item.isTaxInclusive) {
    // If tax is inclusive: taxable = effectiveTotal / (1 + totalTaxRate / 100)
    taxableAmount = effectiveTotal.div(totalRateFactor);
  } else {
    // Tax is exclusive: taxable = effectiveTotal, tax = taxable * (taxRate / 100)
    taxableAmount = effectiveTotal;
  }

  let cgstRate = new Decimal(0);
  let cgstAmount = new Decimal(0);
  let sgstRate = new Decimal(0);
  let sgstAmount = new Decimal(0);
  let igstRate = new Decimal(0);
  let igstAmount = new Decimal(0);
  let cessAmount = new Decimal(0);

  if (context.isZeroRated) {
    // Zero-rated export or SEZ: no tax applied
  } else if (isIntraState) {
    cgstRate = taxRate.div(2);
    sgstRate = taxRate.div(2);
    cgstAmount = taxableAmount.mul(cgstRate).div(100);
    sgstAmount = taxableAmount.mul(sgstRate).div(100);
  } else {
    igstRate = taxRate;
    igstAmount = taxableAmount.mul(igstRate).div(100);
  }

  if (cessRate.greaterThan(0) && !context.isZeroRated) {
    cessAmount = taxableAmount.mul(cessRate).div(100);
  }

  const calculatedTaxTotal = cgstAmount.plus(sgstAmount).plus(igstAmount).plus(cessAmount);
  const totalLineAmount = taxableAmount.plus(calculatedTaxTotal);

  return {
    quantity: qty,
    unitPrice: price,
    grossAmount: grossLine.toDecimalPlaces(2, Decimal.ROUND_HALF_UP),
    discountAmount: discount.toDecimalPlaces(2, Decimal.ROUND_HALF_UP),
    taxableAmount: taxableAmount.toDecimalPlaces(2, Decimal.ROUND_HALF_UP),
    taxRatePercent: taxRate,
    cgstRatePercent: cgstRate,
    cgstAmount: cgstAmount.toDecimalPlaces(2, Decimal.ROUND_HALF_UP),
    sgstRatePercent: sgstRate,
    sgstAmount: sgstAmount.toDecimalPlaces(2, Decimal.ROUND_HALF_UP),
    igstRatePercent: igstRate,
    igstAmount: igstAmount.toDecimalPlaces(2, Decimal.ROUND_HALF_UP),
    cessRatePercent: cessRate,
    cessAmount: cessAmount.toDecimalPlaces(2, Decimal.ROUND_HALF_UP),
    totalTaxAmount: calculatedTaxTotal.toDecimalPlaces(2, Decimal.ROUND_HALF_UP),
    totalLineAmount: totalLineAmount.toDecimalPlaces(2, Decimal.ROUND_HALF_UP),
    isIntraState,
  };
}

/**
 * Calculates document totals across all lines with round-off support.
 */
export function calculateDocumentGst(
  items: GstLineItemInput[],
  context: GstCalculationContext,
  extraDiscount: string | number | Decimal = 0,
  enableRoundOff = true,
): GstDocumentCalculationResult {
  const lineResults = items.map((item) => calculateLineGst(item, context));

  let taxableSubtotal = new Decimal(0);
  let cgstTotal = new Decimal(0);
  let sgstTotal = new Decimal(0);
  let igstTotal = new Decimal(0);
  let cessTotal = new Decimal(0);
  let taxTotal = new Decimal(0);

  for (const line of lineResults) {
    taxableSubtotal = taxableSubtotal.plus(line.taxableAmount);
    cgstTotal = cgstTotal.plus(line.cgstAmount);
    sgstTotal = sgstTotal.plus(line.sgstAmount);
    igstTotal = igstTotal.plus(line.igstAmount);
    cessTotal = cessTotal.plus(line.cessAmount);
    taxTotal = taxTotal.plus(line.totalTaxAmount);
  }

  const extraDisc = new Decimal(extraDiscount || 0);
  const netBeforeRoundOff = taxableSubtotal.plus(taxTotal).minus(extraDisc);

  let grandTotal = netBeforeRoundOff.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
  let roundOffAmount = new Decimal(0);

  if (enableRoundOff) {
    const rounded = netBeforeRoundOff.toDecimalPlaces(0, Decimal.ROUND_HALF_UP);
    roundOffAmount = rounded.minus(netBeforeRoundOff).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
    grandTotal = rounded.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
  }

  return {
    lines: lineResults,
    taxableSubtotal: taxableSubtotal.toDecimalPlaces(2, Decimal.ROUND_HALF_UP),
    cgstTotal: cgstTotal.toDecimalPlaces(2, Decimal.ROUND_HALF_UP),
    sgstTotal: sgstTotal.toDecimalPlaces(2, Decimal.ROUND_HALF_UP),
    igstTotal: igstTotal.toDecimalPlaces(2, Decimal.ROUND_HALF_UP),
    cessTotal: cessTotal.toDecimalPlaces(2, Decimal.ROUND_HALF_UP),
    taxTotal: taxTotal.toDecimalPlaces(2, Decimal.ROUND_HALF_UP),
    extraDiscountAmount: extraDisc.toDecimalPlaces(2, Decimal.ROUND_HALF_UP),
    netBeforeRoundOff: netBeforeRoundOff.toDecimalPlaces(2, Decimal.ROUND_HALF_UP),
    roundOffAmount,
    grandTotal,
  };
}

