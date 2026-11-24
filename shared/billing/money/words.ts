import Decimal from 'decimal.js';

const ONES = [
  '',
  'One',
  'Two',
  'Three',
  'Four',
  'Five',
  'Six',
  'Seven',
  'Eight',
  'Nine',
  'Ten',
  'Eleven',
  'Twelve',
  'Thirteen',
  'Fourteen',
  'Fifteen',
  'Sixteen',
  'Seventeen',
  'Eighteen',
  'Nineteen',
];

const TENS = [
  '',
  '',
  'Twenty',
  'Thirty',
  'Forty',
  'Fifty',
  'Sixty',
  'Seventy',
  'Eighty',
  'Ninety',
];

function convertTwoDigits(n: number): string {
  if (n < 20) return ONES[n] || '';
  const ten = Math.floor(n / 10);
  const one = n % 10;
  return `${TENS[ten]}${one ? ' ' + ONES[one] : ''}`;
}

function convertThreeDigits(n: number): string {
  const hundred = Math.floor(n / 100);
  const rest = n % 100;
  let res = '';
  if (hundred > 0) {
    res += `${ONES[hundred]} Hundred`;
    if (rest > 0) res += ' ';
  }
  if (rest > 0) {
    res += convertTwoDigits(rest);
  }
  return res;
}

/**
 * Converts a decimal amount to Indian words ("Rupees One Lakh Eighteen Thousand Only")
 */
export function amountInWords(amount: string | number | Decimal): string {
  const dec = new Decimal(amount || 0).abs();
  const fixed = dec.toFixed(2);
  const [rupeesStr, paiseStr] = fixed.split('.') as [string, string];

  let rupees = parseInt(rupeesStr, 10);
  const paise = parseInt(paiseStr, 10);

  if (rupees === 0 && paise === 0) {
    return 'Rupees Zero Only';
  }

  let words = '';

  const crore = Math.floor(rupees / 10000000);
  rupees %= 10000000;

  const lakh = Math.floor(rupees / 100000);
  rupees %= 100000;

  const thousand = Math.floor(rupees / 1000);
  rupees %= 1000;

  const hundredAndRest = rupees;

  if (crore > 0) {
    words += `${convertThreeDigits(crore)} Crore `;
  }
  if (lakh > 0) {
    words += `${convertTwoDigits(lakh)} Lakh `;
  }
  if (thousand > 0) {
    words += `${convertTwoDigits(thousand)} Thousand `;
  }
  if (hundredAndRest > 0) {
    words += `${convertThreeDigits(hundredAndRest)} `;
  }

  words = words.trim();

  let finalStr = words ? `Rupees ${words}` : '';

  if (paise > 0) {
    const paiseWords = convertTwoDigits(paise);
    if (finalStr) {
      finalStr += ` and ${paiseWords} Paise`;
    } else {
      finalStr = `${paiseWords} Paise`;
    }
  }

  return `${finalStr} Only`;
}

