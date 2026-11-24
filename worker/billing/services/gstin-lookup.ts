import { INDIAN_STATES, validateGstin } from '@billing/shared';

/** What the app shows after a GSTIN is typed. Only `source: 'gst_network'` results contain names/addresses. */
export interface GstinDetails {
  gstin: string;
  valid: boolean;
  error?: string;
  stateCode?: string;
  stateName?: string;
  pan?: string;
  source: 'checksum_only' | 'gst_network';
  /** true when a GST data provider is configured */
  providerConfigured: boolean;
  legalName?: string;
  tradeName?: string;
  /** Active / Cancelled / Suspended as reported by the GST network */
  status?: string;
  registrationType?: string;
  registrationDate?: string;
  address?: string;
  pincode?: string;
}

interface PortalAddress {
  bno?: string; bnm?: string; flno?: string; st?: string; loc?: string; dst?: string; city?: string; stcd?: string; pncd?: string;
}

/** Map GST-portal taxpayer JSON (field names used by the GST network and GSPs) to our shape. */
export function mapPortalTaxpayer(raw: unknown): Partial<GstinDetails> {
  const r = (raw && typeof raw === 'object' && 'data' in (raw as Record<string, unknown>) ? (raw as { data: unknown }).data : raw) as Record<string, unknown>;
  if (!r || typeof r !== 'object') return {};
  const a = ((r.pradr as { addr?: PortalAddress } | undefined)?.addr ?? {}) as PortalAddress;
  const parts = [a.bno, a.bnm, a.flno, a.st, a.loc, a.city || a.dst, a.stcd].map((x) => (typeof x === 'string' ? x.trim() : '')).filter(Boolean);
  const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
  return {
    legalName: str(r.lgnm),
    tradeName: str(r.tradeNam),
    status: str(r.sts),
    registrationType: str(r.dty),
    registrationDate: str(r.rgdt),
    address: parts.length ? parts.join(', ') : undefined,
    pincode: str(a.pncd),
  };
}

const CACHE_TTL_SECONDS = 30 * 24 * 3600;

/**
 * GSTIN → details. Always validates the checksum and derives state + PAN locally. When a provider is
 * configured (GSTIN_API_URL + GSTIN_API_KEY) also fetches legal name, trade name, address and status,
 * cached in KV for 30 days. Never invents names when no provider is configured.
 */
export async function lookupGstin(
  gstinInput: string,
  env: { GSTIN_API_URL?: string; GSTIN_API_KEY?: string; CACHE?: KVNamespace },
  fetchImpl: typeof fetch = fetch,
): Promise<GstinDetails> {
  const gstin = gstinInput.trim().toUpperCase();
  const v = validateGstin(gstin);
  const providerConfigured = Boolean(env.GSTIN_API_URL && env.GSTIN_API_KEY);
  if (!v.isValid) return { gstin, valid: false, error: v.error ?? 'Invalid GSTIN', source: 'checksum_only', providerConfigured };
  const base: GstinDetails = {
    gstin,
    valid: true,
    stateCode: v.stateCode,
    stateName: v.stateName ?? INDIAN_STATES.find((s) => s.code === v.stateCode)?.name,
    pan: v.pan,
    source: 'checksum_only',
    providerConfigured,
  };
  if (!providerConfigured) return base;

  const cacheKey = `gstin:v1:${gstin}`;
  try {
    const cached = await env.CACHE?.get(cacheKey, 'json');
    if (cached) return { ...base, ...(cached as Partial<GstinDetails>), source: 'gst_network' };
  } catch {
    /* cache miss */
  }
  try {
    const res = await fetchImpl(`${env.GSTIN_API_URL!.replace(/\/+$/, '')}/${encodeURIComponent(gstin)}`, {
      headers: { 'x-api-key': env.GSTIN_API_KEY!, Accept: 'application/json' },
    });
    if (!res.ok) return base;
    const mapped = mapPortalTaxpayer(await res.json());
    if (!mapped.legalName && !mapped.tradeName) return base;
    try {
      await env.CACHE?.put(cacheKey, JSON.stringify(mapped), { expirationTtl: CACHE_TTL_SECONDS });
    } catch {
      /* caching is best-effort */
    }
    return { ...base, ...mapped, source: 'gst_network' };
  } catch {
    return base;
  }
}
