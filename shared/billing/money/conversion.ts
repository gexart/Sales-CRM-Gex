import Decimal from 'decimal.js';

/**
 * Converts a rupee amount (string, number, or Decimal) to integer paise.
 * e.g., ₹118.50 -> 11850 paise
 */
export function rupeesToPaise(rupees: string | number | Decimal): number {
  const d = new Decimal(rupees || 0);
  return d.mul(100).toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toNumber();
}

/**
 * Converts integer paise to a Decimal rupee amount.
 * e.g., 11850 paise -> Decimal(118.50)
 */
export function paiseToRupees(paise: number | bigint): Decimal {
  return new Decimal(paise.toString()).div(100);
}

/**
 * Converts a quantity (e.g. 1.500 kg) to integer thousandths.
 * e.g. 1.5 -> 1500
 */
export function qtyToThousandths(qty: string | number | Decimal): number {
  const d = new Decimal(qty || 0);
  return d.mul(1000).toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toNumber();
}

/**
 * Converts integer thousandths to Decimal quantity.
 * e.g. 1500 -> Decimal(1.500)
 */
export function thousandthsToQty(thousandths: number | bigint): Decimal {
  return new Decimal(thousandths.toString()).div(1000);
}

/**
 * Converts a percentage rate (e.g. 18%) to basis points (e.g. 1800 bps).
 * e.g. 18 -> 1800
 */
export function rateToBasisPoints(ratePercent: string | number | Decimal): number {
  const d = new Decimal(ratePercent || 0);
  return d.mul(100).toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toNumber();
}

/**
 * Converts basis points to Decimal percentage rate.
 * e.g. 1800 bps -> Decimal(18.00)
 */
export function basisPointsToRate(basisPoints: number | bigint): Decimal {
  return new Decimal(basisPoints.toString()).div(100);
}

