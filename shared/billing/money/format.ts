import Decimal from 'decimal.js';

/**
 * Formats a number or Decimal into the standard Indian numbering system (e.g. ₹1,18,000.00)
 */
export function formatIndianCurrency(
  amount: string | number | Decimal,
  includeSymbol = true,
): string {
  const dec = new Decimal(amount || 0);
  const isNegative = dec.isNegative();
  const absDec = dec.abs();
  const fixedStr = absDec.toFixed(2);
  const [intPart, decPart] = fixedStr.split('.') as [string, string];

  let lastThree = intPart.slice(-3);
  const otherNumbers = intPart.slice(0, -3);

  if (otherNumbers !== '') {
    lastThree = ',' + lastThree;
  }

  const formattedInt =
    otherNumbers.replace(/\B(?=(\d{2})+(?!\d))/g, ',') + lastThree;

  const prefix = isNegative ? '-' : '';
  const absFormatted = `${formattedInt}.${decPart}`;
  return includeSymbol ? `${prefix}₹${absFormatted}` : `${prefix}${absFormatted}`;
}

/**
 * Parses an Indian formatted or standard string to Decimal
 */
export function parseAmount(input: string | number): Decimal {
  if (typeof input === 'number') return new Decimal(input);
  const clean = input.replace(/[₹,\s]/g, '');
  return new Decimal(clean || 0);
}


