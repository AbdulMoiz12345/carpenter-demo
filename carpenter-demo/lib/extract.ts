import 'server-only';
import * as cheerio from 'cheerio';
import type { Tenant } from './types';
import { isValidHex } from './theme';
import { gatherSignals, discoverPages, type Signals } from './signals';
import { readDesignDNA, type DesignDNA } from './designdna';

/**
 * Server-side extraction.
 *
 * The Python CLI is the batch tool — it runs over hundreds of prospects
 * from a laptop or CI. This is the same logic in TypeScript so it can run
 * inside the app, which is what makes live generation on a video call
 * possible without a second process.
 *
 * Everything here degrades rather than throws. Failing live, in front of
 * someone, is the worst outcome this codebase has.
 */

const UA = { 'User-Agent': 'Mozilla/5.0 (compatible; Caito360DemoBot/1.0)' };

const GENERIC = new Set([
  '#007bff', '#0d6efd', '#3b82f6', '#2563eb', '#6c757d', '#343a40',
  '#212529', '#f8f9fa', '#4267b2', '#1da1f2', '#25d366', '#ff0000',
  '#3b5998', '#c4302b', '#e60023', '#0077b5', '#ffffff', '#000000'
]);

function hexToRgb(h: string): [number, number, number] {
  let s = h.replace('#', '');
  if (s.length === 3) s = s.split('').map((c) => c + c).join('');
  return [0, 2, 4].map((i) => parseInt(s.slice(i, i + 2), 16)) as [number, number, number];
}

function lum(rgb: number[]): number {
  const f = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(rgb[0]) + 0.7152 * f(rgb[1]) + 0.0722 * f(rgb[2]);
}

/** Greys, near-white and near-black carry no brand information. */
function usable(hex: string): boolean {
  try {
    const rgb = hexToRgb(hex);
    const l = lum(rgb);
    if (l > 0.9 || l < 0.02) return false;
    const mx = Math.max(...rgb);
    const mn = Math.min(...rgb);
    return mx > 0 && (mx - mn) / mx >= 0.18;
  } catch {
    return false;
  }
}

function harvest(text: string): Map<string, number> {
  const counts = new Map<string, number>();
  const bump = (c: string) => counts.set(c, (counts.get(c) ?? 0) + 1);

  const hexes = text.match(/#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})\b/g) ?? [];
  for (const h of hexes) bump(h.toLowerCase());

  const rgbs = text.match(/rgba?\(\s*\d+\s*,\s*\d+\s*,\s*\d+/g) ?? [];
  for (const r of rgbs) {
    const nums = r.match(/\d+/g);
    if (!nums || nums.length < 3) continue;
    bump('#' + nums.slice(0, 3).map((n) => Number(n).toString(16).padStart(2, '0')).join(''));
  }
  return counts;
}

export interface Draft {
  company: string;
  short: string;
  headline: [string, string];
  tagline: string;
  city: string;
  nearby: string[];
  phone: string;
  since: number;
  logo: Tenant['logo'];
  colors: { primary: string };
  services: { name: string; tag: string }[];
  work: { title: string; where: string }[];
  images: string[];
  testimonials: { quote: string; author: string }[];
  credentials: string[];
  email: string;
  rating: string;
  reviewCount: number;
  design: DesignDNA;
  notes: string[];
}

/**
 * A short, human name for tight spaces — nav, SMS copy, the wordmark.
 *
 * Never truncates mid-word: "Loganconstructio" looks like a bug, which
 * is worse than a name being slightly long. Run-on hostname guesses get
 * split on capitals where possible ("LoganConstruction" -> "Logan").
 */
export function shortName(company: string): string {
  const clean = company.trim().replace(/\s+/g, ' ');

  const words = clean.split(' ');
  const first = words[0] ?? '';
  if (!first) return 'Demo';

  // Two words read better than one when the first is an initial or a
  // number: "M. Hale" rather than "M.", "360 Carpentry" rather than "360".
  const stub = first.replace(/[.\-]/g, '');
  const base = (stub.length <= 3 || /^\d+$/.test(stub)) && words[1] ? `${first} ${words[1]}` : first;

  if (base.length <= 18) return base;

  // A run-on hostname guess: split on an internal capital if there is one.
  const parts = base.replace(/([a-z])([A-Z])/g, '$1 $2').split(' ');
  if (parts.length > 1 && parts[0].length >= 3) return parts[0];

  return base.slice(0, 18);
}

export function slugify(name: string): string {
  const s = name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/[\s_]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return s || 'demo';
}

/* ── the logo chain ───────────────────────────────────────────────── */

/**
 * Containers a logo actually lives in. Matching only <header> and <nav>
 * missed most real sites: WordPress uses .site-branding, Elementor uses
 * .elementor-widget-theme-site-logo, Squarespace .header-title-logo, and
 * plenty of themes just use a div called .masthead.
 */
const HEADER_SEL = [
  'header', 'nav', '.header', '#header', '.site-header', '#masthead', '.masthead',
  '.navbar', '.site-branding', '.branding', '.logo', '.site-logo', '.custom-logo-link',
  '.header-title-logo', '[class*="site-logo"]', '[class*="header-logo"]',
  '[class*="theme-site-logo"]', '[id*="logo"]'
].join(', ');

/** Words that mean "this image is the brand", not just any picture. */
const LOGO_HINT = /logo|brand|identity|masthead|wordmark|lockup/i;

function logoCandidates($: cheerio.CheerioAPI, base: string): { url: string; from: string }[] {
  const abs = (v: string) => {
    try {
      return new URL(v, base).href;
    } catch {
      return '';
    }
  };
  const out: { url: string; from: string }[] = [];
  const push = (u: string, from: string) => {
    if (u) out.push({ url: u, from });
  };

  // 1. apple-touch-icon — usually a clean square PNG at a usable size.
  $('link[rel*="apple-touch-icon"]').each((_, el) => {
    const h = $(el).attr('href');
    if (h) push(abs(h), 'apple-touch-icon');
  });

  // 2. Declared icons, largest first. A 16px favicon rendered at 34px
  //    looks worse than a generated wordmark, so small ones are skipped.
  const icons: { url: string; size: number }[] = [];
  $('link[rel~="icon"], link[rel="shortcut icon"]').each((_, el) => {
    const h = $(el).attr('href');
    if (!h) return;
    const sizes = $(el).attr('sizes') ?? '';
    const size = Number(sizes.split('x')[0]) || (/\.svg($|\?)/i.test(h) ? 512 : 0);
    icons.push({ url: abs(h), size });
  });
  for (const i of icons.sort((a, b) => b.size - a.size)) {
    if (i.size >= 96) push(i.url, 'icon-link');
  }

  // 3. An <img> in anything header-shaped. Broadened well beyond
  //    <header>/<nav>, which is what was missing most logos.
  $(HEADER_SEL).find('img').each((_, el) => {
    const $el = $(el);
    const src =
      $el.attr('src') ?? $el.attr('data-src') ?? fromSrcset($el.attr('srcset')) ?? '';
    if (!src || src.startsWith('data:')) return;
    const hay = [src, $el.attr('alt') ?? '', $el.attr('class') ?? ''].join(' ');
    // Inside a branding container, the first image usually IS the logo,
    // so a hint is a bonus rather than a requirement.
    push(abs(src), LOGO_HINT.test(hay) ? 'header-logo' : 'header-img');
  });

  // 4. Anywhere on the page, if it names itself.
  $('img').each((_, el) => {
    const $el = $(el);
    const src = $el.attr('src') ?? $el.attr('data-src') ?? '';
    if (!src || src.startsWith('data:')) return;
    const hay = [src, $el.attr('alt') ?? '', $el.attr('class') ?? '', $el.attr('id') ?? ''].join(' ');
    if (LOGO_HINT.test(hay)) push(abs(src), 'named-logo');
  });

  // 5. CSS background images on branding elements — how a lot of themes
  //    and page builders serve a logo.
  $(HEADER_SEL).each((_, el) => {
    const style = $(el).attr('style') ?? '';
    const m = style.match(/background(?:-image)?\s*:[^;]*url\((['"]?)([^'")]+)\1\)/i);
    if (m) push(abs(m[2]), 'css-background');
  });

  // 6. og:image LAST among images. It is the social share card, which for
  //    a trade business is normally a project photo rather than a logo —
  //    so it must not outrank an actual logo.
  $('meta[property="og:image"]').each((_, el) => {
    const c = $(el).attr('content');
    if (c) push(abs(c), 'og-image');
  });

  const seen = new Set<string>();
  return out.filter((c) => c.url && !seen.has(c.url) && seen.add(c.url)).slice(0, 12);
}

/**
 * Inline SVG logos cannot be linked to, so serialise one to a data URI.
 * Scripts and event handlers are stripped: an SVG is executable, and this
 * one ends up in an <img> on a page we serve.
 */
function inlineSvgLogo($: cheerio.CheerioAPI): string | null {
  let found: string | null = null;
  $(HEADER_SEL).find('svg').each((_, el) => {
    if (found) return;
    const $el = $(el);
    // Skip icon-sized glyphs — hamburgers, chevrons, social marks.
    const vb = ($el.attr('viewBox') ?? '').split(/[\s,]+/).map(Number);
    const w = vb[2] || Number($el.attr('width')) || 0;
    if (w && w < 40) return;
    if ($el.find('script').length) return;

    let markup = $.html($el);
    if (markup.length > 40_000) return;
    markup = markup.replace(/\son\w+\s*=\s*(['"])[^'"]*\1/gi, '');
    if (!/xmlns=/.test(markup)) {
      markup = markup.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"');
    }
    found = 'data:image/svg+xml;base64,' + Buffer.from(markup, 'utf8').toString('base64');
  });
  return found;
}

/* ── project photos ─────────────────────────────────────────────── */

/**
 * The weakest thing a demo can show is an empty photo slot. A carpenter's
 * own site is usually full of project shots, so use theirs — their work,
 * shown back to them, is the strongest signal the page was made for them.
 *
 * Hotlinked rather than copied. Fine for a demo the owner themselves is
 * looking at; mirror to Blob before showing demos to third parties.
 */
const IMG_SKIP =
  /logo|icon|favicon|sprite|badge|avatar|placeholder|spacer|pixel|banner-ad|1x1|blank|loader|arrow|star|quote|flag|payment|visa|mastercard/i;
const IMG_GOOD = /gallery|project|portfolio|work|photo|image|upload|wp-content|media|slide/i;
const LAZY_ATTRS = ['src', 'data-src', 'data-lazy-src', 'data-original', 'data-lazy', 'data-echo'];

/** srcset lists several widths; the last entry is the largest. */
function fromSrcset(v: string | undefined): string | undefined {
  if (!v) return undefined;
  const last = v.split(',').pop()?.trim().split(/\s+/)[0];
  return last || undefined;
}

function harvestImages($: cheerio.CheerioAPI, base: string, logoUrl: string | null): string[] {
  const abs = (u: string) => {
    try {
      return new URL(u, base).href;
    } catch {
      return '';
    }
  };

  const scored: { url: string; score: number }[] = [];
  const seen = new Set<string>();

  // <picture><source srcset> comes before <img> and usually carries the
  // better asset.
  $('picture source[srcset]').each((_, el) => {
    const raw = fromSrcset($(el).attr('srcset'));
    if (!raw || raw.startsWith('data:')) return;
    const url = abs(raw);
    if (!url || seen.has(url) || IMG_SKIP.test(url) || /\.svg($|\?)/i.test(url)) return;
    seen.add(url);
    scored.push({ url, score: 4 });
  });

  $('img').each((_, el) => {
    const $el = $(el);
    // Lazy-loading themes park the real URL on a data attribute and leave
    // src as a placeholder, so check srcset and every known variant.
    let raw = fromSrcset($el.attr('srcset')) ?? fromSrcset($el.attr('data-srcset')) ?? '';
    if (!raw) {
      for (const a of LAZY_ATTRS) {
        const v = $el.attr(a);
        if (v && !v.startsWith('data:') && !/placeholder|blank/i.test(v)) {
          raw = v;
          break;
        }
      }
    }
    if (!raw || raw.startsWith('data:')) return;

    const url = abs(raw);
    if (!url || seen.has(url) || url === logoUrl) return;
    if (/\.svg($|\?)/i.test(url)) return; // icons, not photos
    if (IMG_SKIP.test(url)) return;

    const alt = $el.attr('alt') ?? '';
    const w = Number($el.attr('width') ?? 0);
    const h = Number($el.attr('height') ?? 0);
    if ((w && w < 200) || (h && h < 150)) return; // thumbnails and icons

    let score = 0;
    if (IMG_GOOD.test(url)) score += 3;
    if (alt.length > 4 && !IMG_SKIP.test(alt)) score += 2;
    if (w >= 600 || h >= 400) score += 2;
    // Sections that exist to show work.
    if ($el.closest('[class*="gallery"], [class*="portfolio"], [class*="project"], [id*="gallery"]').length) {
      score += 4;
    }

    seen.add(url);
    scored.push({ url, score });
  });

  // Also pick up CSS background images, which is how many themes do heroes.
  $('[style*="background-image"]').each((_, el) => {
    const m = ($(el).attr('style') ?? '').match(/url\((['"]?)([^'")]+)\1\)/);
    if (!m) return;
    const url = abs(m[2]);
    if (!url || seen.has(url) || IMG_SKIP.test(url) || /\.svg($|\?)/i.test(url)) return;
    seen.add(url);
    scored.push({ url, score: 2 });
  });

  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, 12)
    .map((x) => x.url);
}

/** Confirm the URLs actually serve images before putting them on a page. */
async function verifyImages(urls: string[], want = 6): Promise<string[]> {
  const out: string[] = [];
  const checks = urls.slice(0, 10).map(async (url) => {
    try {
      const r = await fetch(url, { method: 'HEAD', headers: UA, signal: AbortSignal.timeout(4000) });
      const type = r.headers.get('content-type') ?? '';
      const len = Number(r.headers.get('content-length') ?? 0);
      // Under ~8KB is almost always an icon or a tracking pixel.
      if (r.ok && type.startsWith('image/') && (!len || len > 8000)) return url;
    } catch {
      /* unreachable image, skip it */
    }
    return null;
  });
  for (const r of await Promise.all(checks)) {
    if (r && out.length < want) out.push(r);
  }
  return out;
}

async function pickLogo(cands: { url: string; from: string }[]): Promise<Tenant['logo']> {
  for (const c of cands) {
    try {
      const r = await fetch(c.url, { headers: UA, signal: AbortSignal.timeout(6000) });
      if (!r.ok) continue;
      const type = r.headers.get('content-type') ?? '';
      const looksImage = /\.(png|jpe?g|webp|svg|gif|avif|ico)($|\?)/i.test(c.url);
      // Some servers serve images as octet-stream; the extension is a
      // better signal than a lazily configured content-type header.
      if (!type.startsWith('image/') && !looksImage) continue;
      const len = Number(r.headers.get('content-length') ?? 0);
      if (len && len < 500) continue; // a favicon in disguise
      return { type: 'image', url: c.url, from: c.from as never };
    } catch {
      continue;
    }
  }
  // Sixth step: a generated wordmark. This is why extraction never fails.
  return { type: 'wordmark' };
}

/* ── Claude ───────────────────────────────────────────────────────── */

const SYSTEM = `You write short website copy for small trade businesses, and classify them, using only their own website text.

Rules:
- Output ONE JSON object, nothing else. No prose, no markdown fences.
- Never invent facts. Use null or [] when something is not stated.
- headline: exactly two lines that read as one sentence. US English. Name the trade and the city. HARD LIMIT 34 characters per line — count them. No trailing punctuation on line one.
- tagline: one or two plain sentences a tradesperson would recognise as their own, under 200 characters. Never "premier", "leading", "quality" or "solutions".
- services: things the business says it does, in their words, lightly tidied, Title Case, 2-6 items. tag = price or basis if stated, else "".
- nearby: up to 4 neighbourhoods or nearby towns they mention serving.
- credentials: up to 4 short trust facts STATED on the page, 3-5 words each — "Licensed & insured", "Family owned since 1994", "Free estimates". Return [] if none are stated.
- work: real project names described on the page, else [].
- in_niche: true only for genuine carpentry, joinery, cabinetry, millwork or finish carpentry. A general contractor listing carpentry among twenty trades is false.`;

const SHAPE = `{"headline":["",""],"tagline":"","nearby":[],"services":[{"name":"","tag":""}],"work":[{"title":"","where":""}],"credentials":[""],"in_niche":true,"reject_reason":null}`;

type AnalyseResult =
  | { ok: true; facts: Record<string, unknown> }
  | { ok: false; why: string };

/**
 * Called via plain fetch rather than the SDK.
 *
 * A dynamic `await import()` of the SDK inside a function is fragile in
 * a serverless bundle — if it fails to resolve at runtime the call
 * throws and, before this rewrite, was indistinguishable from a missing
 * key. Direct fetch has no bundling surface and the failure modes are
 * visible.
 */
async function analyse(text: string, hintName: string, known: Signals): Promise<AnalyseResult> {
  const key = process.env.ANTHROPIC_API_KEY?.trim();
  if (!key) return { ok: false, why: 'ANTHROPIC_API_KEY is not set on this deployment.' };

  const model = process.env.EXTRACTOR_MODEL ?? 'claude-sonnet-4-6';

  let res: Response;
  try {
    res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        model,
        max_tokens: 1400,
        system: SYSTEM,
        messages: [
          {
            role: 'user',
            content:
              `Business: ${known.name ?? hintName ?? 'unknown'}\n` +
              `City: ${known.city ?? 'unknown'}\n` +
              (known.services.length ? `Known services: ${known.services.join(', ')}\n` : '') +
              `\nThese facts are already confirmed — do not contradict them.\n\n` +
              `Return JSON matching exactly this shape:\n${SHAPE}\n\n` +
              `Website text:\n---\n${text.slice(0, 12000)}\n---`
          }
        ]
      }),
      signal: AbortSignal.timeout(45_000)
    });
  } catch (e) {
    const name = (e as Error).name;
    return {
      ok: false,
      why: name === 'TimeoutError'
        ? 'Claude did not respond within 45s.'
        : `Could not reach Claude (${name}).`
    };
  }

  if (!res.ok) {
    // Surface the real reason — auth, credit and model errors all look
    // identical from the outside otherwise.
    let detail = `HTTP ${res.status}`;
    try {
      const body = (await res.json()) as { error?: { type?: string; message?: string } };
      if (body.error?.message) detail = `${body.error.type ?? res.status}: ${body.error.message}`;
    } catch { /* keep the status code */ }
    console.error('[extract] anthropic call failed', detail);
    return { ok: false, why: `Claude rejected the request — ${detail}` };
  }

  try {
    const json = (await res.json()) as { content?: { type: string; text?: string }[] };
    const raw = (json.content ?? [])
      .map((b) => (b.type === 'text' ? b.text ?? '' : ''))
      .join('');
    const cleaned = raw.replace(/^```(?:json)?/, '').replace(/```$/, '').trim();
    return { ok: true, facts: JSON.parse(cleaned) };
  } catch (e) {
    console.error('[extract] could not parse Claude output', (e as Error).message);
    return { ok: false, why: 'Claude replied but the output was not valid JSON.' };
  }
}

/* ── entry point ──────────────────────────────────────────────────── */

export async function extractFromUrl(rawUrl: string): Promise<Draft> {
  const url = /^https?:\/\//.test(rawUrl) ? rawUrl : `https://${rawUrl}`;
  const notes: string[] = [];

  const res = await fetch(url, { headers: UA, signal: AbortSignal.timeout(12_000) });
  if (!res.ok) throw new Error(`site returned ${res.status}`);
  const html = await res.text();
  const $ = cheerio.load(html);

  /* ── 1. Deterministic signals from the homepage ──────────────── */
  const sig = gatherSignals($, url);

  /* ── 2. Follow the site's own navigation, not guessed paths ──── */
  const pages = discoverPages($, url, 4);
  let extraText = '';

  await Promise.all(
    pages.map(async (p) => {
      try {
        const r = await fetch(p, { headers: UA, signal: AbortSignal.timeout(8000) });
        if (!r.ok) return;
        const $$ = cheerio.load(await r.text());
        // Merge signals — a services page often carries the catalogue
        // and a reviews page the testimonials.
        const more = gatherSignals($$, p);
        for (const k of ['phone', 'email', 'city', 'rating', 'logo'] as const) {
          if (sig[k] === undefined && more[k] !== undefined) {
            (sig as unknown as Record<string, unknown>)[k] = more[k];
            sig.from[k] = `${more.from[k] ?? 'page'} (${new URL(p).pathname})`;
          }
        }
        if (!sig.services.length && more.services.length) {
          sig.services = more.services;
          sig.from.services = `${more.from.services} (${new URL(p).pathname})`;
        }
        if (sig.reviews.length < 3 && more.reviews.length) {
          sig.reviews = [...sig.reviews, ...more.reviews].slice(0, 3);
          sig.from.reviews = more.from.reviews ?? 'page';
        }
        for (const im of more.images) if (!sig.images.includes(im)) sig.images.push(im);

        const clone = cheerio.load($$.html());
        clone('script, style, noscript, svg').remove();
        extraText +=
          '\n' + clone('body').text().split('\n').map((l) => l.trim()).filter(Boolean).join('\n');
      } catch {
        /* a subpage that will not load is not a failure */
      }
    })
  );
  if (pages.length) notes.push(`Read ${pages.length + 1} pages from their own navigation.`);

  /* ── 3. Their stylesheets, for colour and design DNA ─────────── */
  const cssParts: string[] = [];
  $('style').each((_, el) => {
    cssParts.push($(el).contents().text());
  });
  const sheets = $('link[rel="stylesheet"][href]')
    .toArray()
    .map((el) => $(el).attr('href'))
    .filter((h): h is string => Boolean(h))
    .slice(0, 4);
  await Promise.all(
    sheets.map(async (href) => {
      try {
        const u = new URL(href, url).href;
        const r = await fetch(u, { headers: UA, signal: AbortSignal.timeout(7000) });
        if (r.ok) cssParts.push((await r.text()).slice(0, 400_000));
      } catch {
        /* a stylesheet that will not load is not a failure */
      }
    })
  );
  const css = cssParts.join('\n');

  /* ── 4. Colour ───────────────────────────────────────────────── */
  let primary = '';
  let colorFrom = '';
  const theme = $('meta[name="theme-color"]').attr('content')?.trim();
  if (theme && isValidHex(theme) && usable(theme)) {
    primary = theme.toLowerCase();
    colorFrom = 'theme-color';
  }
  if (!primary) {
    const weighted = ['header', 'nav', 'footer', 'style']
      .flatMap((sel) => $(sel).toArray().map((el) => $.html(el)))
      .join('\n');
    const ranked = [...harvest(weighted + '\n' + css + '\n' + html).entries()].sort((a, b) => b[1] - a[1]);
    for (const [hex] of ranked) {
      if (GENERIC.has(hex)) continue;
      if (usable(hex)) {
        primary = hex;
        colorFrom = 'frequency';
        break;
      }
    }
  }
  if (!primary) {
    primary = '#8b5e34';
    colorFrom = 'fallback';
    notes.push('No usable brand colour found — using a neutral default.');
  }

  /* ── 5. Text for the LLM ─────────────────────────────────────── */
  const $text = cheerio.load(html);
  $text('script, style, noscript, svg').remove();
  const text =
    $text('body').text().split('\n').map((l) => l.trim()).filter(Boolean).join('\n') + extraText;

  const host = new URL(url).hostname.replace(/^www\./, '');
  const guess = host
    .split('.')[0]
    .replace(/-/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\b\w/g, (c) => c.toUpperCase());

  /* ── 6. Logo: JSON-LD first, then the chain ──────────────────── */
  let logo: Tenant['logo'] = { type: 'wordmark' };
  if (sig.logo) {
    const ok = await pickLogo([{ url: sig.logo, from: 'json-ld' as never }]);
    if (ok.type === 'image') logo = ok;
  }
  if (logo.type === 'wordmark') logo = await pickLogo(logoCandidates($, url));
  if (logo.type === 'wordmark') {
    const svg = inlineSvgLogo($);
    if (svg) logo = { type: 'image', url: svg, from: 'inline-svg' as never };
  }
  if (logo.type === 'wordmark') {
    notes.push('No logo found — a wordmark will be generated.');
  }

  /* ── 7. Photos ───────────────────────────────────────────────── */
  const harvested = harvestImages($text2(html), url, logo.type === 'image' ? logo.url : null);
  const candidates = [...sig.images, ...harvested].filter((v, i, a) => a.indexOf(v) === i);
  const images = await verifyImages(candidates);
  notes.push(
    images.length
      ? `Found ${images.length} project photo${images.length === 1 ? '' : 's'}.`
      : 'No usable project photos — the page will lead with reviews instead.'
  );

  /* ── 8. Their design language ────────────────────────────────── */
  const slugGuess = slugify(sig.name ?? guess);
  const design = readDesignDNA($, html, css, slugGuess, images.length);
  const dnaBits = ['display', 'body', 'radius', 'accent', 'upper']
    .filter((k) => design.from[k] && design.from[k] !== 'default')
    .map((k) => k);
  notes.push(
    dnaBits.length
      ? `Design mirrored from their site: ${dnaBits.join(', ')}. Hero: ${design.layout}.`
      : `No design signals in their CSS — using defaults. Hero: ${design.layout}.`
  );

  /* ── 9. LLM: copy and classification only ────────────────────── */
  const analysis = await analyse(text, guess, sig);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const facts: any = analysis.ok ? analysis.facts : null;
  if (!analysis.ok) notes.push(`Copy is generic — ${analysis.why}`);
  if (facts?.in_niche === false) {
    notes.push(`Flagged as outside the niche: ${facts.reject_reason ?? 'no carpentry signals'}`);
  }

  /* ── 8. Merge. Signals beat the model on every hard fact. ───── */
  const company = sig.name ?? facts?.company ?? guess;
  const city = sig.city ?? facts?.city ?? '';

  const services = (
    sig.services.length
      ? sig.services.map((n) => ({ name: n, tag: '' }))
      : (facts?.services ?? [])
          .filter((x: { name?: string }) => x?.name)
          .map((x: { name: string; tag?: string }) => ({ name: x.name, tag: x.tag ?? '' }))
  ).slice(0, 6);

  const nearby = (sig.areas.length ? sig.areas : (facts?.nearby ?? [])).slice(0, 4);

  const testimonials = sig.reviews
    .filter((r) => r.quote.length > 25)
    .slice(0, 3)
    .map((r) => ({ quote: r.quote.slice(0, 240), author: r.author.slice(0, 60) }));

  const credentials: string[] = [
    ...(facts?.credentials ?? []).filter((c: string) => c && c.length < 40),
    ...(sig.priceRange ? [sig.priceRange] : [])
  ].slice(0, 4);

  const headline: [string, string] =
    Array.isArray(facts?.headline) && facts.headline.length === 2
      ? [String(facts.headline[0]), String(facts.headline[1])]
      : ['Custom carpentry', city ? `and cabinetry in ${city}` : 'and cabinetry'];

  // Report what came from where — a demo built entirely on fallbacks is
  // weaker than it looks, and that should be visible before it goes out.
  const provenance = ['name', 'phone', 'city', 'services', 'reviews', 'rating']
    .filter((k) => sig.from[k])
    .map((k) => `${k}:${sig.from[k]}`);
  if (provenance.length) notes.push(`Structured data: ${provenance.join(', ')}.`);
  notes.push(`Colour via ${colorFrom}. Logo via ${logo.type === 'image' ? logo.from : 'generated wordmark'}.`);

  return {
    company,
    // Always derived, never asked for. When `short` was part of the
    // model's output it once came back as headline text, which then
    // appeared as the business name in the nav.
    short: shortName(company),
    headline,
    tagline: facts?.tagline ?? sig.description?.slice(0, 300) ?? '',
    city,
    nearby,
    phone: sig.phone ?? facts?.phone ?? '',
    since: sig.founded ?? facts?.since ?? 0,
    logo,
    colors: { primary, ...(design.accent ? { accent: design.accent } : {}) },
    design,
    services: services.length
      ? services
      : [
          { name: 'Custom cabinetry', tag: '' },
          { name: 'Built-ins and closets', tag: '' },
          { name: 'Trim and finish carpentry', tag: '' },
          { name: 'Interior doors', tag: '' }
        ],
    work: (facts?.work ?? [])
      .slice(0, 3)
      .map((w: { title: string; where?: string }) => ({ title: w.title, where: w.where || city })),
    images,
    testimonials,
    credentials,
    email: sig.email ?? '',
    rating: sig.rating ?? '',
    reviewCount: sig.reviewCount ?? 0,
    notes
  };
}

/** A second parse, because the text pass strips <img>. */
function $text2(html: string): cheerio.CheerioAPI {
  return cheerio.load(html);
}
