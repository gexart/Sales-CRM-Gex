import { z } from 'zod';

/**
 * Billing settings (Settings → Preferences, Thermal Print, Barcode, Signatures, Notes & Terms, Auto Reminders,
 * Invoice Templates). One record per business, validated the same way in the app and the API.
 */

/** Small images are stored inline (logo, signature): PNG/JPEG/WEBP data URL, at most ~200 KB. */
export const MAX_IMAGE_DATA_URL = 280_000;
const imageDataUrl = z
  .string()
  .max(MAX_IMAGE_DATA_URL, 'Image is too large — use one under 200 KB')
  .regex(/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/, 'Use a PNG, JPG or WEBP image');

export const NOTE_DOC_TYPES = ['INVOICE', 'QUOTATION', 'PROFORMA', 'SALES_ORDER', 'DELIVERY_CHALLAN', 'PURCHASE_ORDER', 'CREDIT_NOTE'] as const;
export type NoteDocType = (typeof NOTE_DOC_TYPES)[number];

const notesTerms = z.object({ notes: z.string().max(2000).default(''), terms: z.string().max(6000).default('') });

export const billingSettingsSchema = z.object({
  preferences: z
    .object({
      defaultCreditDays: z.number().int().min(0).max(365).default(15),
      roundOff: z.boolean().default(true),
      showHsnSummary: z.boolean().default(true),
      showAmountInWords: z.boolean().default(true),
      showBankOnInvoice: z.boolean().default(true),
      showUpiOnInvoice: z.boolean().default(true),
      showDueDate: z.boolean().default(true),
      copyLabel: z.enum(['ORIGINAL FOR RECIPIENT', 'DUPLICATE FOR TRANSPORTER', 'TRIPLICATE FOR SUPPLIER', 'NONE']).default('ORIGINAL FOR RECIPIENT'),
      footerText: z.string().max(200).default('This is a digitally signed document.'),
      defaultBankAccountId: z.string().max(64).default(''),
    })
    .prefault({}),
  thermal: z
    .object({
      paperWidth: z.enum(['58', '80']).default('80'),
      showLogo: z.boolean().default(true),
      showGstin: z.boolean().default(true),
      showItemHsn: z.boolean().default(false),
      footerNote: z.string().max(120).default('Thank you! Visit again.'),
    })
    .prefault({}),
  barcode: z
    .object({
      labelSize: z.enum(['38x25', '50x25', '50x38', '100x50']).default('50x25'),
      showName: z.boolean().default(true),
      showPrice: z.boolean().default(true),
      showMrp: z.boolean().default(true),
      showBusinessName: z.boolean().default(false),
    })
    .prefault({}),
  branding: z
    .object({
      logo: imageDataUrl.or(z.literal('')).default(''),
      signature: imageDataUrl.or(z.literal('')).default(''),
      signatoryName: z.string().max(80).default(''),
    })
    .prefault({}),
  notesTerms: z.partialRecord(z.enum(NOTE_DOC_TYPES), notesTerms).prefault({}),
  reminders: z
    .object({
      enabled: z.boolean().default(true),
      daysBefore: z.array(z.number().int().min(0).max(60)).max(5).default([3]),
      daysAfter: z.array(z.number().int().min(1).max(180)).max(5).default([1, 7, 15]),
      message: z
        .string()
        .max(600)
        .default('Dear {customer}, a gentle reminder that invoice {invoice} of {amount} is due on {due}. View and pay: {link}'),
    })
    .prefault({}),
  template: z
    .object({
      id: z.string().max(40).default('classic-black'),
    })
    .prefault({}),
});

export type BillingSettings = z.infer<typeof billingSettingsSchema>;

/** Settings with every default filled in; anything invalid in storage falls back to the defaults. */
export function normalizeBillingSettings(input: unknown): BillingSettings {
  const r = billingSettingsSchema.safeParse(input ?? {});
  return r.success ? r.data : billingSettingsSchema.parse({});
}

/** Fill {customer} {invoice} {amount} {due} {link} in a reminder message. */
export function fillReminder(template: string, v: { customer: string; invoice: string; amount: string; due: string; link: string }): string {
  return template
    .replace(/\{customer\}/g, v.customer)
    .replace(/\{invoice\}/g, v.invoice)
    .replace(/\{amount\}/g, v.amount)
    .replace(/\{due\}/g, v.due)
    .replace(/\{link\}/g, v.link);
}
