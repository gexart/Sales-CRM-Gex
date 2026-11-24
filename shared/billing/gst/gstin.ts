/**
 * Indian GSTIN (Goods and Services Tax Identification Number) Utilities
 * Follows GST Council specifications and Mod-36 Checksum validation.
 */
import { getStateByCode } from '../constants/states';

const GSTIN_REGEX = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;
const MOD36_CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/**
 * Computes the Mod-36 checksum character for the first 14 characters of a GSTIN.
 */
export function calculateGstinChecksum(first14Chars: string): string {
  if (first14Chars.length !== 14) {
    throw new Error('First 14 characters required to calculate checksum');
  }

  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const char = first14Chars.charAt(i).toUpperCase();
    const val = MOD36_CHARS.indexOf(char);
    if (val === -1) {
      throw new Error(`Invalid character '${char}' in GSTIN`);
    }

    // Weight factor: 1 for odd positions, 2 for even positions (1-indexed: index 0 is 1st char, weight 1)
    const factor = i % 2 === 0 ? 1 : 2;
    const product = val * factor;
    const quotient = Math.floor(product / 36);
    const remainder = product % 36;
    sum += quotient + remainder;
  }

  const checkDigit = (36 - (sum % 36)) % 36;
  return MOD36_CHARS.charAt(checkDigit);
}

export interface GstinValidationResult {
  isValid: boolean;
  error?: string;
  stateCode?: string;
  stateName?: string;
  pan?: string;
  entityNumber?: string;
}

/**
 * Validates a GSTIN string against regex format, state existence, and Mod-36 checksum.
 */
export function validateGstin(rawGstin: string): GstinValidationResult {
  if (!rawGstin) {
    return { isValid: false, error: 'GSTIN cannot be empty' };
  }

  const gstin = rawGstin.trim().toUpperCase();

  if (gstin.length !== 15) {
    return { isValid: false, error: 'GSTIN must be exactly 15 characters long' };
  }

  if (!GSTIN_REGEX.test(gstin)) {
    return { isValid: false, error: 'Invalid GSTIN structure or characters' };
  }

  const stateCode = gstin.substring(0, 2);
  const state = getStateByCode(stateCode);
  if (!state) {
    return { isValid: false, error: `Invalid state code: ${stateCode}` };
  }

  const pan = gstin.substring(2, 12);
  const entityNumber = gstin.charAt(12);

  // Verify Mod-36 checksum
  const expectedChecksum = calculateGstinChecksum(gstin.substring(0, 14));
  const actualChecksum = gstin.charAt(14);

  if (actualChecksum !== expectedChecksum) {
    return {
      isValid: false,
      error: `Checksum mismatch: expected '${expectedChecksum}', got '${actualChecksum}'`,
      stateCode,
      stateName: state.name,
      pan,
      entityNumber,
    };
  }

  return {
    isValid: true,
    stateCode,
    stateName: state.name,
    pan,
    entityNumber,
  };
}
