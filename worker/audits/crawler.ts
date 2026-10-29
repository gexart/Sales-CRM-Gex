// Small, polite crawler for public website audits.
// - Fetches the homepage plus a few internal pages (MAX_PAGES), respecting robots.txt.
// - HEAD-checks a bounded sample of internal links (MAX_LINK_CHECKS).
// - Parses HTML with the Workers-native HTMLRewriter (streaming, no DOM).
// Page content is treated strictly as data; nothing in it is executed or interpreted as instructions.

export const USER_AGENT = "GexartAuditBot/1.0 (+sales research; respects robots.txt)";
export const MAX_PAGES = 5;
export const MAX_LINK_CHECKS = 25;
const TIMEOUT_MS = 10_000;

export interface PageData {
  url: string;
  finalUrl: string;
  status: number;
  timeMs: number;
  bytes: number;
  contentType: string;
  headers: Record<string, string>;
  title: string | null;
  titleCount: number;
  metaDescription: string | null;
  metaRobots: string | null;
  viewport: string | null;
  canonical: string | null;
  lang: string | null;
  favicon: boolean;
  generator: string | null;
  author: string | null;
  ogTitle: string | null;
  ogImage: string | null;
  modifiedTime: string | null;
  headings: { level: number; text: string }[];
  images: { src: string; alt: string | null; hasDims: boolean }[];
  links: { href: string; text: string; internal: boolean }[];
  jsonLd: unknown[];
  jsonLdErrors: number;
  forms: number;
  formFields: number;
  hasTel: boolean;
  hasMailto: boolean;
  lists: number;
  headScriptsBlocking: number;
  scripts: number;
  stylesheets: number;
  insecureResources: string[];
  wordCount: number;
  timeElements: number;
  /** Publicly listed contact details (mailto:/tel: links). */
  emails: string[];
  phones: string[];
  /** Script/style/iframe URLs, used for technology detection. */
  resources: string[];
  /** First ~60 KB of inline script text, used for technology detection. */
  inlineScript: string;
}

export interface CrawlOptions {
  maxPages?: number;
  maxLinkChecks?: number;
  checkHttpRedirect?: boolean;
}

export interface RobotsInfo {
  status: "found" | "missing" | "error";
  disallowAll: boolean;
  rules: { agent: string; disallow: string[]; allow: string[] }[];
  sitemaps: string[];
  aiCrawlerBlocks: string[];
}

export interface CrawlResult {
  startUrl: string;
  origin: string;
  homepage: PageData | null;
  homepageError: string | null;
  pages: PageData[];
  pageErrors: { url: string; error: string }[];
  skippedByRobots: string[];
  robots: RobotsInfo;
  sitemap: { status: "found" | "missing" | "error"; url: string | null; urlCount: number | null };
  httpRedirectsToHttps: boolean | null;
  linkChecks: { url: string; status: number | null; error?: string }[];
  linksDiscovered: number;
  scannedAt: string;
}

/** Rejects non-http(s) schemes, credentials, localhost and private/link-local IP literals. */
export function assertPublicUrl(raw: string): URL {
  const u = new URL(raw);
  if (!["http:", "https:"].includes(u.protocol)) throw new Error("Only http and https URLs can be audited");
  if (u.username || u.password) throw new Error("URLs with credentials are not allowed");
  const h = u.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".internal") || !h.includes(".") && !h.includes(":")) {
    throw new Error("Only public websites can be audited");
  }
  if (/^\d+\.\d+\.\d+\.\d+$/.test(h)) {
    const [a, b2] = h.split(".").map(Number);
    if (a === 10 || a === 127 || a === 0 || (a === 169 && b2 === 254) || (a === 172 && b2 >= 16 && b2 <= 31) || (a === 192 && b2 === 168) || a >= 224) {
      throw new Error("Private network addresses cannot be audited");
    }
  }
  if (h.includes(":")) throw new Error("IPv6 literal addresses are not supported");
  return u;
}

async function timedFetch(url: string, init: RequestInit = {}) {
  const started = Date.now();
  const res = await fetch(url, {
    ...init,
    redirect: init.redirect ?? "follow",
    headers: { "user-agent": USER_AGENT, accept: "text/html,application/xhtml+xml,*/*;q=0.8", ...(init.headers ?? {}) },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  return { res, ms: Date.now() - started };
}

// ─── robots.txt ───
const AI_CRAWLERS = ["GPTBot", "ClaudeBot", "anthropic-ai", "PerplexityBot", "Google-Extended", "CCBot"];

export function parseRobots(text: string): Omit<RobotsInfo, "status"> {
  const rules: RobotsInfo["rules"] = [];
  const sitemaps: string[] = [];
  let current: RobotsInfo["rules"] = [];
  let lastWasAgent = false;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*/, "").trim();
    const m = line.match(/^([A-Za-z-]+)\s*:\s*(.*)$/);
    if (!m) continue;
    const key = m[1].toLowerCase();
    const val = m[2].trim();
    if (key === "user-agent") {
      if (!lastWasAgent) current = [];
      const g = { agent: val.toLowerCase(), disallow: [], allow: [] };
      current.push(g);
      rules.push(g);
      lastWasAgent = true;
    } else {
      lastWasAgent = false;
      if (key === "sitemap" && val) sitemaps.push(val);
      else if (key === "disallow") current.forEach((g) => val && g.disallow.push(val));
      else if (key === "allow") current.forEach((g) => val && g.allow.push(val));
    }
  }
  const star = rules.filter((r) => r.agent === "*");
  const disallowAll = star.some((r) => r.disallow.includes("/") && !r.allow.length);
  const aiCrawlerBlocks = AI_CRAWLERS.filter((bot) => rules.some((r) => r.agent === bot.toLowerCase() && r.disallow.includes("/")));
  return { rules, sitemaps, disallowAll, aiCrawlerBlocks };
}

export function robotsAllows(robots: Pick<RobotsInfo, "rules">, path: string): boolean {
  const ours = robots.rules.filter((r) => r.agent.startsWith("gexartauditbot"));
  const groups = ours.length ? ours : robots.rules.filter((r) => r.agent === "*");
  let best: { len: number; allow: boolean } | null = null;
  for (const g of groups) {
    for (const [list, allow] of [[g.disallow, false], [g.allow, true]] as const) {
      for (const rule of list) {
        const pattern = rule.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
        const re = new RegExp(`^${pattern.endsWith("\\$") ? pattern.slice(0, -2) + "$" : pattern}`);
        if (re.test(path) && (!best || rule.length > best.len || (rule.length === best.len && allow))) best = { len: rule.length, allow };
      }
    }
  }
  return best ? best.allow : true;
}

// ─── HTML parsing ───
async function parsePage(url: string, res: Response, ms: number): Promise<PageData> {
  const finalUrl = res.url || url;
  const base = new URL(finalUrl);
  const headers: Record<string, string> = {};
  res.headers.forEach((v, k) => (headers[k.toLowerCase()] = v));
  const d: PageData = {
    url, finalUrl, status: res.status, timeMs: ms, bytes: 0, contentType: headers["content-type"] ?? "", headers,
    title: null, titleCount: 0, metaDescription: null, metaRobots: null, viewport: null, canonical: null, lang: null, favicon: false,
    generator: null, author: null, ogTitle: null, ogImage: null, modifiedTime: null, headings: [], images: [], links: [], jsonLd: [],
    jsonLdErrors: 0, forms: 0, formFields: 0, hasTel: false, hasMailto: false, lists: 0, headScriptsBlocking: 0, scripts: 0, stylesheets: 0,
    insecureResources: [], wordCount: 0, timeElements: 0, emails: [], phones: [], resources: [], inlineScript: "",
  };
  if (!/html/i.test(d.contentType)) {
    d.bytes = (await res.arrayBuffer()).byteLength;
    return d;
  }
  let inHead = false;
  let titleBuf = "";
  let heading: { level: number; text: string } | null = null;
  let link: { href: string; text: string; internal: boolean } | null = null;
  let ld: string | null = null;
  let bodyWords = 0;
  let inlineScript = false;
  let scriptWords = 0;
  const words = (s: string) => (s.match(/[\p{L}\p{N}]+/gu) ?? []).length;
  const abs = (v: string) => {
    try {
      return new URL(v, base).toString();
    } catch {
      return null;
    }
  };
  const insecure = (v: string | null) => {
    if (base.protocol === "https:" && v && v.startsWith("http://") && d.insecureResources.length < 10) d.insecureResources.push(v);
  };

  const rw = new HTMLRewriter()
    .on("html", { element: (e) => void (d.lang = e.getAttribute("lang")) })
    .on("head", { element: (e) => { inHead = true; e.onEndTag(() => void (inHead = false)); } })
    .on("title", { element: () => void d.titleCount++, text: (t) => void (titleBuf += t.text) })
    .on("meta", {
      element: (e) => {
        const name = (e.getAttribute("name") ?? e.getAttribute("property") ?? "").toLowerCase();
        const content = e.getAttribute("content");
        if (name === "description") d.metaDescription = content;
        else if (name === "robots") d.metaRobots = content;
        else if (name === "viewport") d.viewport = content;
        else if (name === "generator") d.generator = content;
        else if (name === "author") d.author = content;
        else if (name === "og:title") d.ogTitle = content;
        else if (name === "og:image") d.ogImage = content;
        else if (name === "article:modified_time" || name === "og:updated_time") d.modifiedTime = content;
      },
    })
    .on("link", {
      element: (e) => {
        const rel = (e.getAttribute("rel") ?? "").toLowerCase();
        const href = e.getAttribute("href");
        if (rel.split(/\s+/).includes("canonical")) d.canonical = href ? abs(href) : null;
        if (rel.includes("icon")) d.favicon = true;
        if (href && d.resources.length < 200) d.resources.push(abs(href) ?? href);
        if (rel.includes("stylesheet")) {
          d.stylesheets++;
          insecure(href ? abs(href) : null);
        }
      },
    })
    .on("img", {
      element: (e) => {
        const src = e.getAttribute("src") ?? e.getAttribute("data-src") ?? "";
        d.images.push({ src: abs(src) ?? src, alt: e.getAttribute("alt"), hasDims: e.hasAttribute("width") && e.hasAttribute("height") });
        insecure(abs(src));
      },
    })
    .on("a[href]", {
      element: (e) => {
        const href = e.getAttribute("href") ?? "";
        if (href.startsWith("tel:")) {
          d.hasTel = true;
          const num = decodeURIComponent(href.slice(4)).trim();
          if (num && d.phones.length < 10 && !d.phones.includes(num)) d.phones.push(num);
        }
        if (href.startsWith("mailto:")) {
          d.hasMailto = true;
          const addr = decodeURIComponent(href.slice(7).split("?")[0]).trim().toLowerCase();
          if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(addr) && d.emails.length < 10 && !d.emails.includes(addr)) d.emails.push(addr);
        }
        if (/wa\.me\/|api\.whatsapp\.com/i.test(href)) d.resources.push(href);
        const u = abs(href);
        if (!u || !/^https?:/.test(u)) return;
        const h = new URL(u);
        h.hash = "";
        link = { href: h.toString(), text: "", internal: h.hostname.replace(/^www\./, "") === base.hostname.replace(/^www\./, "") };
        d.links.push(link);
      },
      text: (t) => {
        if (link && link.text.length < 120) link.text += t.text;
      },
    })
    .on("form", { element: () => void d.forms++ })
    .on("time", { element: () => void d.timeElements++ })
    .on("script", {
      element: (e) => {
        d.scripts++;
        const src = e.getAttribute("src");
        if (src && d.resources.length < 200) d.resources.push(abs(src) ?? src);
        // Text chunks only reach this handler while inside a <script>, so tracking the latest element is enough.
        inlineScript = !src;
        insecure(src ? abs(src) : null);
        const type = (e.getAttribute("type") ?? "").toLowerCase();
        if (inHead && src && !e.hasAttribute("async") && !e.hasAttribute("defer") && type !== "module") d.headScriptsBlocking++;
        if (type === "application/ld+json") {
          ld = "";
          e.onEndTag(() => {
            try {
              const parsed = JSON.parse(ld ?? "");
              d.jsonLd.push(...(Array.isArray(parsed) ? parsed : [parsed]));
            } catch {
              d.jsonLdErrors++;
            }
            ld = null;
          });
        }
      },
      text: (t) => {
        if (ld !== null) ld += t.text;
        else if (inlineScript && d.inlineScript.length < 60_000) d.inlineScript += t.text;
        scriptWords += words(t.text);
      },
    })
    .on("style", { text: (t) => void (scriptWords += words(t.text)) })
    .on("body", { text: (t) => void (bodyWords += words(t.text)) });

  // HTMLRewriter does not support comma-separated selector lists, so register each tag.
  for (const tag of ["h1", "h2", "h3", "h4", "h5", "h6"]) {
    rw.on(tag, {
      element: (e) => {
        heading = { level: Number(e.tagName.slice(1)), text: "" };
        d.headings.push(heading);
      },
      text: (t) => {
        if (heading) heading.text += t.text;
      },
    });
  }
  for (const tag of ["input", "textarea", "select"]) rw.on(tag, { element: (e) => void (e.getAttribute("type") !== "hidden" && d.formFields++) });
  for (const tag of ["ul", "ol"]) rw.on(tag, { element: () => void d.lists++ });
  rw.on("iframe", { element: (e) => void (e.getAttribute("src") && d.resources.push(abs(e.getAttribute("src")!) ?? "")) });

  const buf = await rw.transform(res).arrayBuffer();
  d.bytes = buf.byteLength;
  d.title = titleBuf.trim().replace(/\s+/g, " ") || null;
  d.headings.forEach((h) => (h.text = h.text.trim().replace(/\s+/g, " ")));
  d.links.forEach((l) => (l.text = l.text.trim().replace(/\s+/g, " ")));
  d.wordCount = Math.max(0, bodyWords - scriptWords);
  return d;
}

/** JSON-LD @type values, flattened through @graph. */
export function schemaTypes(page: PageData | null): string[] {
  const out: string[] = [];
  const walk = (n: unknown) => {
    if (!n || typeof n !== "object") return;
    if (Array.isArray(n)) return n.forEach(walk);
    const o = n as Record<string, unknown>;
    const t = o["@type"];
    if (typeof t === "string") out.push(t);
    else if (Array.isArray(t)) out.push(...t.filter((x): x is string => typeof x === "string"));
    if (o["@graph"]) walk(o["@graph"]);
    if (o.mainEntity) walk(o.mainEntity);
  };
  page?.jsonLd.forEach(walk);
  return out;
}

const PRIORITY_PATHS = /(about|contact|service|product|solution|pricing|faq|blog|course|admission|rooms|menu)/i;

export async function crawl(start: string, onProgress?: (p: number) => Promise<void>, opts: CrawlOptions = {}): Promise<CrawlResult> {
  const maxPages = opts.maxPages ?? MAX_PAGES;
  const maxLinkChecks = opts.maxLinkChecks ?? MAX_LINK_CHECKS;
  const startUrl = assertPublicUrl(start);
  const origin = startUrl.origin;
  const result: CrawlResult = {
    startUrl: startUrl.toString(), origin, homepage: null, homepageError: null, pages: [], pageErrors: [], skippedByRobots: [],
    robots: { status: "error", disallowAll: false, rules: [], sitemaps: [], aiCrawlerBlocks: [] },
    sitemap: { status: "missing", url: null, urlCount: null }, httpRedirectsToHttps: null, linkChecks: [], linksDiscovered: 0,
    scannedAt: new Date().toISOString(),
  };

  // robots.txt first, so it governs everything else.
  try {
    const { res } = await timedFetch(`${origin}/robots.txt`, { headers: { accept: "text/plain" } });
    if (res.ok && /text\/plain|octet-stream/i.test(res.headers.get("content-type") ?? "text/plain")) {
      result.robots = { status: "found", ...parseRobots(await res.text()) };
    } else {
      await res.body?.cancel();
      result.robots.status = res.status === 404 || res.status === 410 || res.ok ? "missing" : "error";
    }
  } catch {
    result.robots.status = "error";
  }
  await onProgress?.(10);

  if (!robotsAllows(result.robots, startUrl.pathname)) {
    result.skippedByRobots.push(startUrl.toString());
    result.homepageError = "robots.txt disallows auditing this page";
    return result;
  }

  try {
    const { res, ms } = await timedFetch(startUrl.toString());
    result.homepage = await parsePage(startUrl.toString(), res, ms);
    result.pages.push(result.homepage);
  } catch (e) {
    result.homepageError = e instanceof Error ? e.message : "Request failed";
    return result;
  }
  await onProgress?.(30);

  // Does plain http redirect to https?
  if (startUrl.protocol === "https:" && opts.checkHttpRedirect !== false) {
    try {
      const { res } = await timedFetch(`http://${startUrl.host}/`, { redirect: "manual", method: "HEAD" });
      const loc = res.headers.get("location") ?? "";
      result.httpRedirectsToHttps = res.status >= 300 && res.status < 400 && loc.startsWith("https://");
    } catch {
      result.httpRedirectsToHttps = null;
    }
  }

  // Sitemap: robots-declared first, then /sitemap.xml.
  const sitemapUrl = result.robots.sitemaps[0] ?? `${origin}/sitemap.xml`;
  try {
    const { res } = await timedFetch(sitemapUrl, { headers: { accept: "application/xml,text/xml" } });
    if (res.ok) {
      const text = (await res.text()).slice(0, 2_000_000);
      const isXml = /<(urlset|sitemapindex)[\s>]/i.test(text);
      result.sitemap = isXml ? { status: "found", url: sitemapUrl, urlCount: (text.match(/<loc>/gi) ?? []).length } : { status: "missing", url: sitemapUrl, urlCount: null };
    } else {
      await res.body?.cancel();
      result.sitemap = { status: res.status === 404 ? "missing" : "error", url: sitemapUrl, urlCount: null };
    }
  } catch {
    result.sitemap = { status: "error", url: sitemapUrl, urlCount: null };
  }
  await onProgress?.(40);

  // Pick additional internal pages, favouring key business pages.
  const home = result.homepage;
  const homeHost = new URL(home.finalUrl).hostname;
  const internal = [...new Set(home.links.filter((l) => l.internal).map((l) => l.href))].filter((h) => {
    const u = new URL(h);
    return u.hostname === homeHost && !/\.(pdf|jpe?g|png|gif|webp|svg|zip|mp4|docx?|xlsx?)$/i.test(u.pathname) && u.toString() !== home.finalUrl;
  });
  const ranked = [...internal].sort((a, b) => Number(PRIORITY_PATHS.test(b)) - Number(PRIORITY_PATHS.test(a)) || a.length - b.length);
  for (const href of ranked) {
    if (result.pages.length >= maxPages) break;
    const path = new URL(href).pathname;
    if (!robotsAllows(result.robots, path)) {
      result.skippedByRobots.push(href);
      continue;
    }
    try {
      const { res, ms } = await timedFetch(href);
      result.pages.push(await parsePage(href, res, ms));
    } catch (e) {
      result.pageErrors.push({ url: href, error: e instanceof Error ? e.message : "Request failed" });
    }
    await onProgress?.(40 + result.pages.length * 8);
  }

  // Bounded internal link check across all crawled pages.
  const allInternal = [...new Set(result.pages.flatMap((p) => p.links.filter((l) => l.internal).map((l) => l.href)))];
  result.linksDiscovered = allInternal.length;
  const fetched = new Map(result.pages.map((p) => [p.url, p.status]));
  const toCheck = allInternal.filter((u) => !fetched.has(u) && robotsAllows(result.robots, new URL(u).pathname)).slice(0, maxLinkChecks);
  for (const [u, s] of fetched) if (allInternal.includes(u)) result.linkChecks.push({ url: u, status: s });
  for (let i = 0; i < toCheck.length; i += 5) {
    const batch = toCheck.slice(i, i + 5);
    const out = await Promise.all(
      batch.map(async (u) => {
        try {
          let { res } = await timedFetch(u, { method: "HEAD" });
          if (res.status === 405 || res.status === 501) {
            ({ res } = await timedFetch(u));
            await res.body?.cancel();
          }
          return { url: u, status: res.status };
        } catch (e) {
          return { url: u, status: null, error: e instanceof Error ? e.message : "Request failed" };
        }
      }),
    );
    result.linkChecks.push(...out);
  }
  await onProgress?.(90);
  return result;
}
