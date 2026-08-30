"""
PRESET PALETTES FOR PATH B

A business with no website has no colours to sample. Rather than give
every one of them the same brown, assign from a small curated set,
keyed on a hash of the business name so the same input always yields
the same output. Deterministic matters: re-running the extractor must
not silently re-brand a demo you have already emailed out.
"""
from __future__ import annotations

import hashlib

CARPENTRY = [
    "#8B5E34",   # walnut
    "#2F5D45",   # forest
    "#1F4E79",   # workshop blue
    "#7A3E2F",   # red oak
    "#3F4A54",   # slate
    "#5C6E31",   # olive
]


def for_business(name: str, palette: list[str] | None = None) -> str:
    pool = palette or CARPENTRY
    h = hashlib.sha256(name.strip().lower().encode()).digest()
    return pool[h[0] % len(pool)]
