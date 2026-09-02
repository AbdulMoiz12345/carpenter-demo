import 'server-only';
import * as cheerio from 'cheerio';

/**
 * DETERMINISTIC SIGNALS
 *
 * Most small-business sites publish far more than they appear to. Yoast,
 * RankMath, Wix, Squarespace and Shopify all emit JSON-LD; nearly
 * everything emits Open Graph. That data is structured, free, and more
 * reliable than anything a language model infers from prose.
 *
 * So this runs FIRST and its output is treated as ground truth. The LLM
 * then only has to do what it is actually good at — writing a headline
 * and a tagline — on a much smaller prompt.
 *
 * Everything here is best-effort. A missing signal is normal.
 */

export interface Signals {
  name?: string;
  legalName?: string;
  tagline?: string;
  description?: string;
  phone?: string;
  email?: string;
  city?: string;
  region?: string;
  street?: string;
  logo?: string;
  images: string[];
  rating?: string;
  reviewCount?: number;
  reviews: { quote: string; author: string }[];
  services: string[];
  areas: string[];
  founded?: number;
  socials: string[];
  priceRange?: string;
  /** Where each field came from, for the extraction report. */
  from: Record<string, string>;
}

const BIZ_TYPES = new Set([
  'localbusiness', 'organization', 'homeandconstructionbusiness', 'generalcontractor',
  'professionalservice', 'corporation', 'store', 'contractor', 'roofingcontractor',
  'houseparter', 'hvacbusiness', 'plumber', 'electrician', 'locksmith'
]);

function txt(v: unknown): string | undefined {
  if (typeof v === 'string') return v.trim() || undefined;
  if (Array.isArray(v)) return txt(v[0]);
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    return txt(o.name ?? o['@id'] ?? o.url ?? o.text);
  }
  return undefined;
}

function urlOf(v: unknown, base: string): string | undefined {
  const raw =
    typeof v === 'string'
      ? v
      : Array.isArray(v)
        ? urlOf(v[0], base)
        : v && typeof v === 'object'
          ? txt((v as Record<string, unknown>).url ?? (v as Record<string, unknown>).contentUrl)
          : undefined;
  if (!raw) return undefined;
  try {
    return new URL(raw, base).href;
  } catch {
    return undefined;
  }
}

/** Walk a JSON-LD graph, which is frequently nested and inconsistent. */
function flatten(node: unknown, out: Record<string, unknown>[] = []): Record<string, unknown>[] {
  if (Array.isArray(node)) {
    for (const n of node) flatten(n, out);
  } else if (node && typeof node === 'object') {
    const o = node as Record<string, unknown>;
    out.push(o);
    if (o['@graph']) flatten(o['@graph'], out);
    for (const k of ['subOrganization', 'parentOrganization', 'about', 'mainEntity', 'itemListElement', 'review']) {
      if (o[k]) flatten(o[k], out);
    }
  }
  return out;
}

function typesOf(o: Record<string, unknown>): string[] {
  const t = o['@type'];
  const arr = Array.isArray(t) ? t : [t];
  return arr.filter((x): x is string => typeof x === 'string').map((x) => x.toLowerCase());
}

export function gatherSignals($: cheerio.CheerioAPI, base: string): Signals {
  const s: Signals = { images: [], reviews: [], services: [], areas: [], socials: [], from: {} };
  const set = <K extends keyof Signals>(k: K, v: Signals[K] | undefined, src: string) => {
    if (v === undefined || v === '' || (Array.isArray(v) && !v.length)) return;
    if (s[k] !== undefined && !Array.isArray(s[k]) && s.from[k as string]) return; // first wins
    s[k] = v;
    s.from[k as string] = src;
  };

  /* ── 1. JSON-LD ─────────────────────────────────────────────── */
  const nodes: Record<string, unknown>[] = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    const raw = $(el).contents().text();
    if (!raw.trim()) return;
    try {
      flatten(JSON.parse(raw), nodes);
    } catch {
      /* malformed JSON-LD is extremely common; ignore it */
    }
  });

  for (const n of nodes) {
    const types = typesOf(n);
    const isBiz = types.some((t) => BIZ_TYPES.has(t));

    if (isBiz) {
      set('name', txt(n.name), 'json-ld');
      set('legalName', txt(n.legalName), 'json-ld');
      set('description', txt(n.description), 'json-ld');
      set('phone', txt(n.telephone), 'json-ld');
      set('email', txt(n.email)?.replace(/^mailto:/, ''), 'json-ld');
      set('priceRange', txt(n.priceRange), 'json-ld');
      set('logo', urlOf(n.logo, base), 'json-ld');

      const addr = n.address as Record<string, unknown> | undefined;
      if (addr && typeof addr === 'object') {
        set('city', txt(addr.addressLocality), 'json-ld');
        set('region', txt(addr.addressRegion), 'json-ld');
        set('street', txt(addr.streetAddress), 'json-ld');
      }

      const founded = txt(n.foundingDate);
      if (founded) {
        const y = Number(founded.slice(0, 4));
        if (y > 1900 && y <= new Date().getFullYear()) set('founded', y, 'json-ld');
      }

      for (const im of Array.isArray(n.image) ? n.image : [n.image]) {
        const u = urlOf(im, base);
        if (u && !s.images.includes(u)) s.images.push(u);
      }
      if (s.images.length) s.from.images = 'json-ld';

      for (const sa of Array.isArray(n.sameAs) ? n.sameAs : [n.sameAs]) {
        const u = txt(sa);
        if (u && !s.socials.includes(u)) s.socials.push(u);
      }

      // Areas served and service catalogues are inconsistently shaped.
      for (const a of Array.isArray(n.areaServed) ? n.areaServed : [n.areaServed]) {
        const v = txt(a);
        if (v && v.length < 40 && !s.areas.includes(v)) s.areas.push(v);
      }
      const cat = n.hasOfferCatalog as Record<string, unknown> | undefined;
      const items = (cat?.itemListElement ?? n.makesOffer) as unknown;
      for (const it of Array.isArray(items) ? items : [items]) {
        const v = txt((it as Record<string, unknown>)?.itemOffered ?? it);
        if (v && v.length < 70 && !s.services.includes(v)) s.services.push(v);
      }
      if (s.services.length) s.from.services = 'json-ld';
    }

    // Ratings and reviews can hang off any node.
    if (types.includes('aggregaterating') || n.aggregateRating) {
      const ar = (n.aggregateRating ?? n) as Record<string, unknown>;
      const val = txt(ar.ratingValue);
      const cnt = Number(txt(ar.reviewCount) ?? txt(ar.ratingCount) ?? 0);
      if (val) set('rating', Number(val).toFixed(1), 'json-ld');
      if (cnt) set('reviewCount', cnt, 'json-ld');
    }

    if (types.includes('review')) {
      const body = txt(n.reviewBody) ?? txt(n.description);
      const author = txt(n.author) ?? '';
      if (body && body.length > 25) {
        s.reviews.push({ quote: body.slice(0, 240), author: author.slice(0, 60) });
        s.from.reviews = 'json-ld';
      }
    }
  }

  /* ── 2. Open Graph and friends ──────────────────────────────── */
  const meta = (sel: string) => $(sel).attr('content')?.trim() || undefined;
  set('name', meta('meta[property="og:site_name"]'), 'og');
  set('tagline', meta('meta[property="og:title"]'), 'og');
  set('description', meta('meta[property="og:description"]') ?? meta('meta[name="description"]'), 'meta');
  set('logo', urlOf(meta('meta[name="msapplication-TileImage"]'), base), 'meta');

  const ogImg = urlOf(meta('meta[property="og:image"]'), base);
  if (ogImg && !s.images.includes(ogImg)) {
    s.images.push(ogImg);
    s.from.images ??= 'og';
  }

  /* ── 3. tel: and mailto: — far better than regex on prose ───── */
  const tel = $('a[href^="tel:"]').first().attr('href');
  if (tel) set('phone', decodeURIComponent(tel.replace(/^tel:/, '')).trim(), 'tel-link');

  const mail = $('a[href^="mailto:"]').first().attr('href');
  if (mail) set('email', decodeURIComponent(mail.replace(/^mailto:/, '')).split('?')[0].trim(), 'mailto-link');

  /* ── 4. Socials ─────────────────────────────────────────────── */
  $('a[href*="facebook.com"], a[href*="instagram.com"], a[href*="linkedin.com"], a[href*="yelp.com"]').each(
    (_, el) => {
      const h = $(el).attr('href');
      if (h && !s.socials.includes(h) && s.socials.length < 6) s.socials.push(h);
    }
  );

  /* ── 5. Title fallback for the name ─────────────────────────── */
  if (!s.name) {
    const t = $('title').text().trim();
    // "Oakline Carpentry | Custom Cabinetry in Plano" -> "Oakline Carpentry"
    const head = t.split(/\s[|\u2013\u2014\u00b7-]\s/)[0].trim();
    if (head && head.length > 2 && head.length < 60) set('name', head, 'title');
  }

  /* ── 6. Services from markup, when JSON-LD had none ─────────── */
  if (!s.services.length) {
    const found: string[] = [];
    $('h2, h3').each((_, el) => {
      const h = $(el).text().trim().toLowerCase();
      if (!/service|what we (do|make|offer)|our work|specialit|expertise/.test(h)) return;
      $(el)
        .nextAll('ul, ol, div')
        .slice(0, 2)
        .find('li, h3, h4, .elementor-heading-title')
        .each((__, li) => {
          const v = $(li).text().trim().replace(/\s+/g, ' ');
          if (v.length > 3 && v.length < 70 && !found.includes(v)) found.push(v);
        });
    });
    if (found.length >= 2) set('services', found.slice(0, 8), 'headings');
  }

  /* ── 7. Reviews from common markup, when JSON-LD had none ───── */
  if (!s.reviews.length) {
    $('blockquote, [class*="testimonial"], [class*="review"]').each((_, el) => {
      if (s.reviews.length >= 3) return;
      const t = $(el).text().trim().replace(/\s+/g, ' ');
      if (t.length < 40 || t.length > 400) return;
      s.reviews.push({ quote: t.slice(0, 240), author: '' });
      s.from.reviews = 'markup';
    });
  }

  return s;
}

/**
 * Follow the site's own navigation instead of guessing paths.
 *
 * Guessing /services, /about and /our-work misses anything that calls
 * itself /what-we-do, /portfolio, /galeria or /cabinet-shop — which is
 * most sites.
 */
export function discoverPages($: cheerio.CheerioAPI, base: string, limit = 4): string[] {
  const WANT = /service|about|work|project|gallery|portfolio|product|cabinet|contact|review|testimonial/i;
  const SKIP = /blog|news|privacy|terms|cart|checkout|account|login|\.(pdf|jpg|png|zip)$/i;

  const origin = new URL(base).origin;
  const scored: { url: string; score: number }[] = [];
  const seen = new Set<string>([base.replace(/\/$/, '')]);

  $('nav a[href], header a[href], footer a[href], a[href]').each((_, el) => {
    const href = $(el).attr('href');
    if (!href || href.startsWith('#') || /^(mailto|tel|javascript):/i.test(href)) return;

    let u: URL;
    try {
      u = new URL(href, base);
    } catch {
      return;
    }
    if (u.origin !== origin) return;

    const clean = (u.origin + u.pathname).replace(/\/$/, '');
    if (seen.has(clean) || SKIP.test(clean)) return;

    const label = $(el).text().trim();
    let score = 0;
    if (WANT.test(u.pathname)) score += 3;
    if (WANT.test(label)) score += 2;
    if ($(el).closest('nav, header').length) score += 2;
    if (u.pathname.split('/').filter(Boolean).length === 1) score += 1; // top-level
    if (score === 0) return;

    seen.add(clean);
    scored.push({ url: u.href, score });
  });

  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((x) => x.url);
}
