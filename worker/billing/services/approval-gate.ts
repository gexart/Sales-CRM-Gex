/**
 * Approval gate for saving documents above the limits the Master Admin set (Admin → Approvals & custom fields).
 *
 * Flow: a non-admin saves a purchase bill / invoice above a limit → it is NOT saved; a pending approval request is
 * created and the API answers 409 APPROVAL_REQUIRED. When the Master Admin approves it, saving the same document
 * again (same party and amount) goes through once — the approval is used up. Master Admins are never blocked.
 */

export type GateKind = 'PURCHASE' | 'INVOICE';

export interface GateLine {
  quantityThousandths: number;
  unitPricePaise: number;
  discountPaise?: number;
}

/** Gross value of lines before discount, in paise. */
export function grossPaise(lines: GateLine[]): number {
  return lines.reduce((a, l) => a + Math.round((l.quantityThousandths * l.unitPricePaise) / 1000), 0);
}

/** Discount as basis points of the gross (2000 = 20%). */
export function discountBp(lines: GateLine[], extraDiscountPaise = 0): number {
  const gross = grossPaise(lines);
  if (gross <= 0) return 0;
  const disc = lines.reduce((a, l) => a + (l.discountPaise ?? 0), 0) + extraDiscountPaise;
  return Math.round((disc * 10000) / gross);
}

/** Stable key for "the same document": kind + party + value. */
export function gateKey(kind: GateKind, partyId: string | undefined, value: number): string {
  return `${kind}:${partyId ?? 'walk-in'}:${value}`;
}

export const isMasterAdmin = (c: any): boolean => {
  const m = c.get('membership') as { roleKey?: string; permissions?: string[] } | undefined;
  if (!m) return false;
  return m.roleKey === 'owner' || m.roleKey === 'admin' || !!m.permissions?.includes('*') || !!m.permissions?.includes('user.manage');
};

/**
 * Returns a 409 Response when approval is needed, or null to continue saving.
 * `value` is paise for PURCHASE and discount basis points for INVOICE.
 */
export async function approvalGate(_c: any, _kind: GateKind, _partyId: string | undefined, _value: number): Promise<Response | null> {
  // GexPro's per-document gate is replaced by the billing guard in worker/billing/index.ts (roles, limits, approvals).
  return null;
}
