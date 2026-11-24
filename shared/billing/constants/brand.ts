/**
 * Single source of truth for product branding and domains.
 *
 * - PRODUCT_NAME / APP_BASE_DOMAIN can be overridden per environment
 *   (Workers var `APP_BASE_DOMAIN` / `PRODUCT_NAME`, Vite `VITE_APP_BASE_DOMAIN`, Astro `PUBLIC_APP_BASE_DOMAIN`).
 * - Never hard-code a domain anywhere else: always build it with the helpers below.
 */
export const DEFAULT_PRODUCT_NAME = 'GexGrow';
export const DEFAULT_APP_BASE_DOMAIN = 'gexgrow.com';

export const COMPANY = {
  name: 'Gexart Technologies',
  parent: 'Gexart Ventures',
  legalLine: 'Gexart Technologies (a unit of Gexart Ventures), Kolkata, India',
  website: 'https://gexart.com',
  email: 'info@gexart.com',
} as const;

export type BrandSubdomain = 'www' | 'connect' | 'admin' | 'api' | 'shop' | 'files';

export interface BrandConfig {
  productName: string;
  baseDomain: string;
}

export function resolveBrand(overrides?: Partial<BrandConfig>): BrandConfig {
  const productName = overrides?.productName?.trim() || DEFAULT_PRODUCT_NAME;
  const baseDomain = (overrides?.baseDomain?.trim() || DEFAULT_APP_BASE_DOMAIN)
    .replace(/^https?:\/\//, '')
    .replace(/\/+$/, '')
    .toLowerCase();
  return { productName, baseDomain };
}

/** `https://gexgrow.com` for 'www', `https://connect.gexgrow.com` for 'connect', etc. */
export function brandUrl(sub: BrandSubdomain, path = '', baseDomain = DEFAULT_APP_BASE_DOMAIN): string {
  const host = sub === 'www' ? baseDomain : `${sub}.${baseDomain}`;
  const suffix = path ? (path.startsWith('/') ? path : `/${path}`) : '';
  return `https://${host}${suffix}`;
}

/** Email address on the product domain, e.g. `noreply@gexgrow.com`. */
export function brandEmail(local: string, baseDomain = DEFAULT_APP_BASE_DOMAIN): string {
  return `${local}@${baseDomain}`;
}

/** True when `origin` is the product root domain or one of its subdomains (https only). */
export function isBrandOrigin(origin: string, baseDomain = DEFAULT_APP_BASE_DOMAIN): boolean {
  try {
    const u = new URL(origin);
    if (u.protocol !== 'https:') return false;
    return u.hostname === baseDomain || u.hostname.endsWith(`.${baseDomain}`);
  } catch {
    return false;
  }
}

export const POWERED_BY = `Powered by ${DEFAULT_PRODUCT_NAME}`;
