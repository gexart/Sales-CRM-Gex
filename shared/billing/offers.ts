import { z } from 'zod';

/**
 * POS offers / promotions. Pure maths in integer paise, used by the API (authoritative) and the POS screen (preview).
 * Rule: offers do not stack — the single offer giving the biggest discount is applied.
 */

const base = {
  id: z.string().min(1).max(40),
  name: z.string().trim().min(2).max(80),
  active: z.boolean().default(true),
  /** inclusive YYYY-MM-DD bounds (India date) */
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  /** 0 = Sunday … 6 = Saturday; empty/absent = every day */
  days: z.array(z.number().int().min(0).max(6)).max(7).optional(),
  /** happy hour, minutes after midnight (India time); both or neither */
  fromMinute: z.number().int().min(0).max(1439).optional(),
  toMinute: z.number().int().min(1).max(1440).optional(),
  /** when set, the offer applies only if the cashier enters this code */
  couponCode: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9-]{3,20}$/, 'Coupon: 3–20 letters, digits or -')
    .optional(),
  minBillPaise: z.number().int().min(0).default(0),
};

export const offerSchema = z.discriminatedUnion('kind', [
  z.object({ ...base, kind: z.literal('PERCENT_BILL'), percentBp: z.number().int().min(1).max(10000), maxDiscountPaise: z.number().int().min(0).optional() }),
  z.object({ ...base, kind: z.literal('FLAT_BILL'), amountPaise: z.number().int().min(1) }),
  z.object({ ...base, kind: z.literal('BUY_X_GET_Y'), itemId: z.string().min(1).max(64), buyQty: z.number().int().min(1).max(1000), freeQty: z.number().int().min(1).max(1000) }),
  z.object({ ...base, kind: z.literal('ITEM_PERCENT'), itemIds: z.array(z.string().min(1).max(64)).min(1).max(500), percentBp: z.number().int().min(1).max(10000) }),
]);
export type Offer = z.infer<typeof offerSchema>;
export const offersListSchema = z.array(offerSchema).max(100);

export interface OfferCartLine {
  itemId: string;
  quantityThousandths: number;
  /** price of one unit, paise */
  unitPricePaise: number;
}

export interface AppliedOffer {
  offerId: string;
  name: string;
  discountPaise: number;
}

/** India calendar date (YYYY-MM-DD), weekday and minute-of-day for an instant. */
function istClock(now: Date) {
  const ist = new Date(now.getTime() + 330 * 60_000);
  return { date: ist.toISOString().slice(0, 10), day: ist.getUTCDay(), minute: ist.getUTCHours() * 60 + ist.getUTCMinutes() };
}

export function isOfferLive(o: Offer, now: Date, couponCode?: string | null): boolean {
  if (!o.active) return false;
  const t = istClock(now);
  if (o.startDate && t.date < o.startDate) return false;
  if (o.endDate && t.date > o.endDate) return false;
  if (o.days && o.days.length > 0 && !o.days.includes(t.day)) return false;
  if (o.fromMinute !== undefined && o.toMinute !== undefined) {
    const inWindow = o.fromMinute <= o.toMinute ? t.minute >= o.fromMinute && t.minute < o.toMinute : t.minute >= o.fromMinute || t.minute < o.toMinute;
    if (!inWindow) return false;
  }
  if (o.couponCode) return (couponCode ?? '').trim().toUpperCase() === o.couponCode;
  return true;
}

/** Discount (paise) one offer gives on this cart; 0 if it does not apply. Never more than the bill. */
export function offerDiscount(o: Offer, lines: OfferCartLine[]): number {
  const bill = lines.reduce((s, l) => s + Math.round((l.unitPricePaise * l.quantityThousandths) / 1000), 0);
  if (bill <= 0 || bill < o.minBillPaise) return 0;
  let d = 0;
  switch (o.kind) {
    case 'PERCENT_BILL':
      d = Math.floor((bill * o.percentBp) / 10000);
      if (o.maxDiscountPaise !== undefined) d = Math.min(d, o.maxDiscountPaise);
      break;
    case 'FLAT_BILL':
      d = o.amountPaise;
      break;
    case 'BUY_X_GET_Y': {
      const line = lines.find((l) => l.itemId === o.itemId);
      if (!line) return 0;
      const units = Math.floor(line.quantityThousandths / 1000);
      const groups = Math.floor(units / (o.buyQty + o.freeQty));
      d = groups * o.freeQty * line.unitPricePaise;
      break;
    }
    case 'ITEM_PERCENT':
      d = lines
        .filter((l) => o.itemIds.includes(l.itemId))
        .reduce((s, l) => s + Math.floor((Math.round((l.unitPricePaise * l.quantityThousandths) / 1000) * o.percentBp) / 10000), 0);
      break;
  }
  return Math.max(0, Math.min(d, bill));
}

/** The best live offer for this cart (no stacking), or null. */
export function bestOffer(offers: readonly Offer[], lines: OfferCartLine[], now: Date, couponCode?: string | null): AppliedOffer | null {
  let best: AppliedOffer | null = null;
  for (const o of offers) {
    if (!isOfferLive(o, now, couponCode)) continue;
    const d = offerDiscount(o, lines);
    if (d > 0 && (!best || d > best.discountPaise)) best = { offerId: o.id, name: o.name, discountPaise: d };
  }
  return best;
}

/** True when a coupon code was entered but matches no live coupon offer (to tell the cashier). */
export function isUnknownCoupon(offers: readonly Offer[], couponCode: string | null | undefined, now: Date): boolean {
  const code = (couponCode ?? '').trim().toUpperCase();
  if (!code) return false;
  return !offers.some((o) => o.couponCode === code && isOfferLive(o, now, code));
}
