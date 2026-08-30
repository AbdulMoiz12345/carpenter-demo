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
- headline: exactly two short lines that read as one sentence. US English. Name the trade and the city. No trailing punctuation on line one.
- tagline: one or two plain sentences a tradesperson would recognise as their own. Never "premier", "leading" or "quality".
- nearby: up to 4 neighbourhoods or nearby towns they mention serving.
- in_niche: true only for genuine carpentry, joinery, cabinetry, millwork or finish carpentry. A general contractor listing carpentry among twenty trades is false.`;

const SHAPE = `{"company":"","short":"","headline":["",""],"tagline":"","city":"","nearby":[],"phone":"","since":null,"services":[{"name":"","tag":""}],"work":[{"title":"","where":""}],"in_niche":true,"reject_reason":null}`;

async function analyse(text: string, hintName: string) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return null;
  try {
    const Anthropic = (await import('@anthropic-ai/sdk')).default;
    const client = new Anthropic({ apiKey: key });
    const msg = await client.messages.create({
      model: process.env.EXTRACTOR_MODEL ?? 'claude-sonnet-4-6',
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
    });
    const raw = msg.content.map((b) => (b.type === 'text' ? b.text : '')).join('');
    return JSON.parse(
      raw
        .replace(/^```(?:json)?/, '')
        .replace(/```$/, '')
        .trim()
    );
  } catch {
    return null;
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

  const facts = await analyse(text, guess);
  if (!facts) notes.push('ANTHROPIC_API_KEY not set, so the copy is generic.');
  if (facts?.in_niche === false) {
    notes.push(`Flagged as outside the niche: ${facts.reject_reason ?? 'no carpentry signals'}`);
  }

  const logo = await pickLogo(logoCandidates($, url));
  if (logo.type === 'wordmark') notes.push('No logo found — a wordmark will be generated.');

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
    notes: [
      ...notes,
      `Colour via ${colorFrom}.`,
      `Logo via ${logo.type === 'image' ? logo.from : 'generated wordmark'}.`
    ]
  };
}
