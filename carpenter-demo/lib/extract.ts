import 'server-only';
import * as cheerio from 'cheerio';
import type { Tenant } from './types';
import { isValidHex } from './theme';

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
  const first = company.trim().split(/\s+/)[0];
  if (first.length <= 18) return first;

  const parts = first.replace(/([a-z])([A-Z])/g, '$1 $2').split(' ');
  if (parts.length > 1 && parts[0].length >= 3) return parts[0];

  return first;
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

function logoCandidates($: cheerio.CheerioAPI, base: string): { url: string; from: string }[] {
  const abs = (s: string) => {
    try {
      return new URL(s, base).href;
    } catch {
      return '';
    }
  };
  const out: { url: string; from: string }[] = [];

  $('link[rel*="apple-touch-icon"]').each((_, el) => {
    const h = $(el).attr('href');
    if (h) out.push({ url: abs(h), from: 'apple-touch-icon' });
  });
  $('meta[property="og:image"]').each((_, el) => {
    const c = $(el).attr('content');
    if (c) out.push({ url: abs(c), from: 'og-image' });
  });
  $('header img, nav img').each((_, el) => {
    const src = $(el).attr('src') ?? '';
    const hay = [src, $(el).attr('alt') ?? '', $(el).attr('class') ?? ''].join(' ').toLowerCase();
    if (src && hay.includes('logo')) out.push({ url: abs(src), from: 'header-img' });
  });
  $('img').each((_, el) => {
    const src = $(el).attr('src') ?? '';
    if (src.toLowerCase().includes('logo')) out.push({ url: abs(src), from: 'header-img' });
  });

  const seen = new Set<string>();
  return out.filter((c) => c.url && !seen.has(c.url) && seen.add(c.url)).slice(0, 6);
}

/**
 * PROJECT PHOTOS
 *
 * The weakest thing a demo can show is an empty photo slot. A carpenter's
 * own site is usually full of project shots, so use theirs — their work,
 * shown back to them, is the strongest possible signal the page was made
 * for them.
 *
 * These are hotlinked rather than copied. Fine for a demo the owner
 * themselves is looking at; if demos ever get shown to third parties,
 * mirror them to Blob instead.
 */
const IMG_SKIP = /logo|icon|favicon|sprite|badge|avatar|placeholder|spacer|pixel|banner-ad|1x1|blank/i;
const IMG_GOOD = /gallery|project|portfolio|work|photo|image|upload|wp-content|media|slide/i;

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

  $('img').each((_, el) => {
    const $el = $(el);
    // srcset gives the largest variant; take the last entry.
    const srcset = $el.attr('srcset') ?? '';
    const fromSet = srcset ? srcset.split(',').pop()?.trim().split(/\s+/)[0] : '';
    const raw = fromSet || $el.attr('src') || $el.attr('data-src') || '';
    if (!raw || raw.startsWith('data:')) return;

    const url = abs(raw);
    if (!url || seen.has(url) || url === logoUrl) return;
    if (/\.svg($|\?)/i.test(url)) return;         // icons, not photos
    if (IMG_SKIP.test(url)) return;

    const alt = $el.attr('alt') ?? '';
    const w = Number($el.attr('width') ?? 0);
    const h = Number($el.attr('height') ?? 0);
    if ((w && w < 200) || (h && h < 150)) return;   // thumbnails and icons

    let score = 0;
    if (IMG_GOOD.test(url)) score += 3;
    if (alt.length > 4 && !IMG_SKIP.test(alt)) score += 2;
    if (w >= 600 || h >= 400) score += 2;
    // Sections that exist to show work.
    if ($el.closest('[class*="gallery"], [class*="portfolio"], [class*="project"], [id*="gallery"]').length) score += 4;

    seen.add(url);
    scored.push({ url, score });
  });

  // Also pick up CSS background images, which is how many themes do heroes.
  $('[style*="background-image"]').each((_, el) => {
    const m = ($(el).attr('style') ?? '').match(/url\(['"]?([^'")]+)/);
    if (!m) return;
    const url = abs(m[1]);
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
      if (!type.startsWith('image/')) continue;
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

const SYSTEM = `You extract structured facts about small trade businesses from their own website text.

Rules:
- Output ONE JSON object, nothing else. No prose, no markdown fences.
- Never invent facts. Use null or [] when something is not stated.
- services: things the business says it does, in their words, lightly tidied, Title Case, 2-6 items. tag = price or basis if stated, else "".
- headline: exactly two lines that read as one sentence. US English. Name the trade and the city. HARD LIMIT 34 characters per line — count them. No trailing punctuation on line one.
- tagline: one or two plain sentences a tradesperson would recognise as their own, under 200 characters total. Never "premier", "leading" or "quality".
- nearby: up to 4 neighbourhoods or nearby towns they mention serving.
- testimonials: up to 3 real customer reviews quoted from the page. quote must be VERBATIM from the text, trimmed to under 220 characters, ending at a sentence boundary. author is the reviewer's name if given, else "". Return [] if the page has no reviews — never invent one.
- credentials: up to 4 short trust facts stated on the page, 3-5 words each. Examples: "Licensed & insured", "Family owned since 1994", "Free estimates", "BBB accredited". Return [] if none are stated.
- email: a contact email address if one appears, else "".
- work: real project names from the page if any are described, else [].
- in_niche: true only for genuine carpentry, joinery, cabinetry, millwork or finish carpentry. A general contractor listing carpentry among twenty trades is false.`;

const SHAPE = `{"company":"","short":"","headline":["",""],"tagline":"","city":"","nearby":[],"phone":"","email":"","since":null,"services":[{"name":"","tag":""}],"work":[{"title":"","where":""}],"testimonials":[{"quote":"","author":""}],"credentials":[""],"in_niche":true,"reject_reason":null}`;

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
async function analyse(text: string, hintName: string): Promise<AnalyseResult> {
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
              `Business name hint: ${hintName || 'unknown'}\n\n` +
              `Return JSON matching exactly this shape:\n${SHAPE}\n\n` +
              `Website text:\n---\n${text.slice(0, 14000)}\n---`
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

  // ── colour: a stated theme-color beats anything inferred ──
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
    const ranked = [...harvest(weighted + '\n' + html).entries()].sort((a, b) => b[1] - a[1]);
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

  // Keep an unstripped copy: the text pass below removes <img>, and
  // photos are harvested after it.
  const $img = cheerio.load(html);

  // ── text ──
  $('script, style, noscript, svg').remove();
  const text = $('body')
    .text()
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .join('\n');

  if (text.length < 200) {
    notes.push('Very little text on the page — this may be a JavaScript-only site.');
  }

  const host = new URL(url).hostname.replace(/^www\./, '');
  const guess = host
    .split('.')[0]
    .replace(/-/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\b\w/g, (c) => c.toUpperCase());

  const analysis = await analyse(text, guess);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const facts: any = analysis.ok ? analysis.facts : null;
  if (!analysis.ok) notes.push(`Copy is generic — ${analysis.why}`);
  if (facts?.in_niche === false) {
    notes.push(`Flagged as outside the niche: ${facts.reject_reason ?? 'no carpentry signals'}`);
  }

  const logo = await pickLogo(logoCandidates($, url));
  if (logo.type === 'wordmark') notes.push('No logo found — a wordmark will be generated.');

  // Their own project photos. Run after the logo so it can be excluded.
  const images = await verifyImages(
    harvestImages($img, url, logo.type === 'image' ? logo.url : null)
  );
  if (images.length) {
    notes.push(`Found ${images.length} project photo${images.length === 1 ? '' : 's'}.`);
  } else {
    notes.push('No usable project photos — the page will lead with reviews instead.');
  }

  const city: string = facts?.city ?? '';
  const services = (facts?.services ?? [])
    .filter((s: { name?: string }) => s && s.name)
    .slice(0, 6)
    .map((s: { name: string; tag?: string }) => ({ name: s.name, tag: s.tag ?? '' }));

  const headline: [string, string] =
    Array.isArray(facts?.headline) && facts.headline.length === 2
      ? [String(facts.headline[0]), String(facts.headline[1])]
      : ['Custom carpentry', city ? `and cabinetry in ${city}` : 'and cabinetry'];

  return {
    company: facts?.company || guess,
    short: String(facts?.short || shortName(facts?.company || guess)),
    headline,
    tagline: facts?.tagline ?? '',
    city,
    nearby: (facts?.nearby ?? []).slice(0, 4),
    phone: facts?.phone ?? '',
    since: facts?.since ?? 0,
    logo,
    colors: { primary },
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
    testimonials: (facts?.testimonials ?? [])
      .filter((t: { quote?: string }) => t?.quote && t.quote.length > 20)
      .slice(0, 3)
      .map((t: { quote: string; author?: string }) => ({
        quote: t.quote.slice(0, 240),
        author: (t.author ?? '').slice(0, 60)
      })),
    credentials: (facts?.credentials ?? [])
      .filter((c: string) => c && c.length < 40)
      .slice(0, 4),
    email: facts?.email ?? '',
    notes: [
      ...notes,
      `Colour via ${colorFrom}.`,
      `Logo via ${logo.type === 'image' ? logo.from : 'generated wordmark'}.`
    ]
  };
}
