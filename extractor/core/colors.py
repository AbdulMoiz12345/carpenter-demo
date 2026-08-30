"""
COLOUR EXTRACTION AND THE CONTRAST GUARD

An extracted brand colour is arbitrary. Some prospects have a pale
yellow brand, some have near-white, some have nothing usable at all.
Every colour that leaves this module has been checked, and a fallback
is always available, because a demo that renders with invisible button
text reads as our incompetence rather than theirs.

contrast_safe() is a direct port of contrastSafe() in lib/theme.ts.
The two must agree or the server render and the extractor will
disagree about what a brand looks like.
"""
from __future__ import annotations

import re
from collections import Counter

HEX_RE = re.compile(r"#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})\b")
RGB_RE = re.compile(r"rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)")

# Colours that carry no brand information. Bootstrap/Tailwind defaults
# and framework blues show up on thousands of small-business sites.
GENERIC = {
    "#007bff", "#0d6efd", "#3b82f6", "#2563eb",  # bootstrap / tailwind blue
    "#6c757d", "#343a40", "#212529", "#f8f9fa",
    "#4267b2", "#1da1f2", "#25d366", "#ff0000",  # social brand colours
    "#3b5998", "#c4302b", "#e60023", "#0077b5",
}


def hex_to_rgb(h: str) -> tuple[int, int, int]:
    h = h.lstrip("#")
    if len(h) == 3:
        h = "".join(c * 2 for c in h)
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))  # type: ignore


def rgb_to_hex(rgb) -> str:
    return "#" + "".join(f"{max(0, min(255, int(round(v)))):02x}" for v in rgb)


def _lum(rgb) -> float:
    def f(v: float) -> float:
        s = v / 255
        return s / 12.92 if s <= 0.03928 else ((s + 0.055) / 1.055) ** 2.4
    r, g, b = rgb
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)


def contrast_with_white(rgb) -> float:
    return 1.05 / (_lum(rgb) + 0.05)


def contrast_safe(hex_color: str, target: float = 4.5) -> str:
    """Darken toward black until white text passes WCAG AA."""
    rgb = list(hex_to_rgb(hex_color))
    guard = 0
    while contrast_with_white(rgb) < target and guard < 40:
        rgb = [v * 0.94 for v in rgb]
        guard += 1
    return rgb_to_hex(rgb)


def _saturation(rgb) -> float:
    mx, mn = max(rgb), min(rgb)
    return 0.0 if mx == 0 else (mx - mn) / mx


def _is_usable(rgb) -> bool:
    """Reject greys, near-white and near-black — they are not brands."""
    l = _lum(rgb)
    if l > 0.90 or l < 0.02:
        return False
    return _saturation(rgb) >= 0.18


def harvest(css_and_html: str) -> list[tuple[str, int]]:
    """Every colour literal in the document, most frequent first."""
    found: Counter[str] = Counter()

    for m in HEX_RE.finditer(css_and_html):
        found[("#" + m.group(1)).lower()] += 1
    for m in RGB_RE.finditer(css_and_html):
        rgb = tuple(int(g) for g in m.groups())
        found[rgb_to_hex(rgb)] += 1

    return found.most_common()


def pick_brand(
    css_and_html: str,
    theme_color: str | None = None,
    weighted: list[str] | None = None,
) -> tuple[str, str]:
    """
    Choose a primary colour and report where it came from.

    Priority:
      1. <meta name="theme-color">  — the site author stated it outright
      2. colours found in high-signal context (buttons, header, links)
      3. most frequent usable colour anywhere
      4. a neutral fallback, so this function never fails
    """
    if theme_color:
        try:
            rgb = hex_to_rgb(theme_color)
            if _is_usable(rgb):
                return rgb_to_hex(rgb), "theme-color"
        except Exception:
            pass

    if weighted:
        counts = Counter()
        for blob in weighted:
            for c, n in harvest(blob):
                counts[c] += n * 3            # context is worth 3x frequency
        for c, _ in counts.most_common():
            if c in GENERIC:
                continue
            try:
                if _is_usable(hex_to_rgb(c)):
                    return c, "context"
            except Exception:
                continue

    for c, _ in harvest(css_and_html):
        if c in GENERIC:
            continue
        try:
            if _is_usable(hex_to_rgb(c)):
                return c, "frequency"
        except Exception:
            continue

    return "#8B5E34", "fallback"
