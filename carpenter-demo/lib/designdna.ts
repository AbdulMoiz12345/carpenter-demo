import 'server-only';
import * as cheerio from 'cheerio';

/**
 * DESIGN DNA
 *
 * Generating a bespoke site per prospect is expensive and unreviewable.
 * But we already download their HTML and CSS, and it carries their whole
 * aesthetic: which fonts they chose, how round their corners are, whether
 * their headings shout, what their second colour is.
 *
 * So instead of inventing a look, mirror theirs. The template becomes a
 * chameleon rather than a costume — which is both cheaper and more
 * convincing, because it resembles the site they already recognise.
 *
 * Costs nothing. No API call, no generation, fully deterministic.
 */

/**
 * Fonts we are willing to load, mapped from what a site might declare.
 * A whitelist rather than passing arbitrary strings to Google Fonts:
 * unvalidated family names in a stylesheet URL is an injection vector,
 * and an unavailable family silently breaks the page.
 */
const FONT_MAP: Record<string, { family: string; kind: 'serif' | 'sans' | 'slab' | 'display' }> = {
  montserrat: { family: 'Montserrat', kind: 'sans' },
  poppins: { family: 'Poppins', kind: 'sans' },
  inter: { family: 'Inter', kind: 'sans' },
  roboto: { family: 'Roboto', kind: 'sans' },
  'open sans': { family: 'Open Sans', kind: 'sans' },
  lato: { family: 'Lato', kind: 'sans' },
  raleway: { family: 'Raleway', kind: 'sans' },
  nunito: { family: 'Nunito', kind: 'sans' },
  'work sans': { family: 'Work Sans', kind: 'sans' },
  rubik: { family: 'Rubik', kind: 'sans' },
  karla: { family: 'Karla', kind: 'sans' },
  mulish: { family: 'Mulish', kind: 'sans' },
  manrope: { family: 'Manrope', kind: 'sans' },
  oswald: { family: 'Oswald', kind: 'display' },
  'archivo narrow': { family: 'Archivo Narrow', kind: 'display' },
  anton: { family: 'Anton', kind: 'display' },
  bebas: { family: 'Bebas Neue', kind: 'display' },
  'bebas neue': { family: 'Bebas Neue', kind: 'display' },
  teko: { family: 'Teko', kind: 'display' },
  merriweather: { family: 'Merriweather', kind: 'serif' },
  'playfair display': { family: 'Playfair Display', kind: 'serif' },
  lora: { family: 'Lora', kind: 'serif' },
  'pt serif': { family: 'PT Serif', kind: 'serif' },
  'libre baskerville': { family: 'Libre Baskerville', kind: 'serif' },
  'crimson text': { family: 'Crimson Text', kind: 'serif' },
  georgia: { family: 'Lora', kind: 'serif' },
  garamond: { family: 'EB Garamond', kind: 'serif' },
  'eb garamond': { family: 'EB Garamond', kind: 'serif' },
  cormorant: { family: 'Cormorant Garamond', kind: 'serif' },
  'roboto slab': { family: 'Roboto Slab', kind: 'slab' },
  'zilla slab': { family: 'Zilla Slab', kind: 'slab' },
  arvo: { family: 'Arvo', kind: 'slab' },
  bitter: { family: 'Bitter', kind: 'slab' }
};

/** Sensible partners, so a detected display face still gets a readable body. */
const PAIRING: Record<string, string> = {
  display: 'Inter',
  serif: 'Inter',
  slab: 'Inter',
  sans: 'Inter'
};

export interface DesignDNA {
  /** Google font family for headings. */
  display: string;
  /** Google font family for body copy. */
  body: string;
  /** Corner rounding in px, clamped to a sane range. */
  radius: number;
  /** Do their headings shout? */
  upper: boolean;
  /** A second brand colour, when they have one. */
  accent?: string;
  /** Which hero arrangement to use. Deterministic per business. */
  layout: 'photo-right' | 'photo-left' | 'photo-below' | 'text-only';
  /** For the extraction report. */
  from: Record<string, string>;
}

const RADIUS_RE = /border-radius\s*:\s*([0-9.]+)\s*(px|rem|em)/gi;
const FAMILY_RE = /font-family\s*:\s*([^;}]+)/gi;

function familyFrom(decl: string): { family: string; kind: string } | null {
  for (const raw of decl.split(',')) {
    const name = raw.trim().replace(/^["']|["']$/g, '').toLowerCase();
    if (FONT_MAP[name]) return { family: FONT_MAP[name].family, kind: FONT_MAP[name].kind };
  }
  // Not in the whitelist, but the generic keyword still tells us something.
  if (/\bserif\b/.test(decl) && !/sans-serif/.test(decl)) return { family: 'Lora', kind: 'serif' };
  return null;
}

/** Deterministic 32-bit hash, so a business always gets the same layout. */
function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

export function readDesignDNA(
  $: cheerio.CheerioAPI,
  html: string,
  css: string,
  slug: string,
  photoCount: number
): DesignDNA {
  const from: Record<string, string> = {};
  const blob = css + '\n' + html;

  /* ── fonts ────────────────────────────────────────────────────── */
  // Heading declarations first: they carry the personality.
  let display: string | undefined;
  let kind = 'sans';
  const headingCss = (css.match(/(h1|h2|\.title|\.heading|\.elementor-heading)[^{]*\{[^}]*\}/gi) ?? []).join('\n');
  for (const m of headingCss.matchAll(FAMILY_RE)) {
    const hit = familyFrom(m[1]);
    if (hit) {
      display = hit.family;
      kind = hit.kind;
      from.display = 'their heading css';
      break;
    }
  }

  let body: string | undefined;
  for (const m of blob.matchAll(FAMILY_RE)) {
    const hit = familyFrom(m[1]);
    if (!hit) continue;
    if (!display) {
      display = hit.family;
      kind = hit.kind;
      from.display = 'their css';
    } else if (hit.family !== display && hit.kind === 'sans') {
      body = hit.family;
      from.body = 'their css';
      break;
    }
  }

  if (!display) {
    display = 'Bricolage Grotesque';
    from.display = 'default';
  }
  if (!body) {
    body = PAIRING[kind] ?? 'Inter';
    from.body ??= 'paired';
  }

  /* ── corner rounding ─────────────────────────────────────────── */
  // Median of what they actually use, so one outlier does not skew it.
  const radii: number[] = [];
  for (const m of blob.matchAll(RADIUS_RE)) {
    const n = Number(m[1]) * (m[2] === 'px' ? 1 : 16);
    if (n >= 0 && n <= 40) radii.push(n);
  }
  let radius = 3;
  if (radii.length) {
    radii.sort((a, b) => a - b);
    radius = Math.round(radii[Math.floor(radii.length / 2)]);
    radius = Math.max(0, Math.min(18, radius));
    from.radius = `${radii.length} declarations`;
  }

  /* ── heading case ────────────────────────────────────────────── */
  const upperDecls = (blob.match(/text-transform\s*:\s*uppercase/gi) ?? []).length;
  const upper = upperDecls >= 3;
  if (upper) from.upper = `${upperDecls} uppercase rules`;

  /* ── a second colour ─────────────────────────────────────────── */
  // Custom properties are where themes declare their palette, so an
  // --accent or --secondary is a much better signal than frequency.
  let accent: string | undefined;
  const varMatch = css.match(/--(?:accent|secondary|color-2|brand-2)[^:]*:\s*(#[0-9a-fA-F]{3,6})/);
  if (varMatch) {
    accent = varMatch[1].toLowerCase();
    from.accent = 'their css variable';
  }

  /* ── hero arrangement ────────────────────────────────────────── */
  // Content decides first; the hash only breaks ties. Two prospects
  // never see an identical page, without anything being generated.
  const layouts: DesignDNA['layout'][] = ['photo-right', 'photo-left', 'photo-below'];
  const layout: DesignDNA['layout'] =
    photoCount === 0 ? 'text-only' : layouts[hash(slug) % layouts.length];
  from.layout = photoCount === 0 ? 'no photos' : 'deterministic';

  return { display, body, radius, upper, accent, layout, from };
}

/** Only whitelisted families reach this, so the URL is always safe. */
export function fontHref(dna: { display: string; body: string }): string {
  const fam = (f: string, weights: string) =>
    `family=${f.replace(/ /g, '+')}:wght@${weights}`;
  const parts = new Set([fam(dna.display, '600;800'), fam(dna.body, '400;500;600')]);
  return `https://fonts.googleapis.com/css2?${[...parts].join('&')}&family=Martian+Mono:wght@400;600&display=swap`;
}
