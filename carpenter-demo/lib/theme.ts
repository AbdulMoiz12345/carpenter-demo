/**
 * Brand handling. An extracted colour is arbitrary, so every value
 * that ends up behind white text has to be checked and corrected
 * before it reaches the page.
 */

const hexToRgb = (hex: string): [number, number, number] => {
  let h = hex.replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
};

const rgbToHex = (rgb: number[]) =>
  '#' + rgb.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');

const relLuminance = ([r, g, b]: number[]) => {
  const f = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};

const contrastWithWhite = (rgb: number[]) => 1.05 / (relLuminance(rgb) + 0.05);

/**
 * CONTRAST GUARD
 *
 * Darken toward black in small steps until white text on this colour
 * passes WCAG AA. Without this, a prospect with a pale brand (yellow,
 * mint, pale blue) gets a demo with invisible button labels — and that
 * reads as our incompetence, not theirs.
 */
export function contrastSafe(hex: string, target = 4.5): string {
  let rgb: number[] = hexToRgb(hex);
  let guard = 0;
  while (contrastWithWhite(rgb) < target && guard++ < 40) {
    rgb = rgb.map((v) => v * 0.94);
  }
  return rgbToHex(rgb);
}

export function isValidHex(hex: string): boolean {
  return /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(hex);
}

/**
 * Final step of the logo fallback chain. Because this exists,
 * extraction can never fail — a generated wordmark looks
 * deliberate, a broken <img> kills the demo.
 */
export function initials(company: string): string {
  return company
    .replace(/&/g, ' ')
    .split(/[\s.]+/)
    .filter((w) => w.length > 1 && !/^(and|the|ltd|co|of|de|llc|inc)$/i.test(w))
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join('');
}

/**
 * Rendered server-side into a style attribute so the page arrives
 * already branded. Theming on the client would cause a flash of
 * unstyled content, which is the most obvious possible tell that
 * a demo is templated.
 */
export function brandVars(
  primary: string,
  opts?: { accent?: string; design?: { display: string; body: string; radius: number; upper: boolean } }
): Record<string, string> {
  const safe = isValidHex(primary) ? primary : '#8B5E34';
  const vars: Record<string, string> = {
    '--brand': safe,
    '--brand-ink': contrastSafe(safe),
    '--brand-wash': safe + '14'
  };

  // A second brand colour, when their CSS declared one. Contrast-checked
  // like the first, because it is used behind white text too.
  if (opts?.accent && isValidHex(opts.accent)) {
    vars['--accent'] = opts.accent;
    vars['--accent-ink'] = contrastSafe(opts.accent);
  }

  // Their typography and corner rounding. Only whitelisted font families
  // reach here, so these strings are safe to put in CSS.
  if (opts?.design) {
    const d = opts.design;
    vars['--fdisp'] = `'${d.display}', system-ui, sans-serif`;
    vars['--fbody'] = `'${d.body}', system-ui, sans-serif`;
    vars['--r'] = `${Math.max(0, Math.min(18, d.radius))}px`;
    vars['--h-case'] = d.upper ? 'uppercase' : 'none';
    vars['--h-track'] = d.upper ? '0.01em' : '-0.03em';
  }
  return vars;
}
