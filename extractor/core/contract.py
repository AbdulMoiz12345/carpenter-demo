"""
THE OUTPUT CONTRACT

Both extraction paths produce exactly this shape. It mirrors
lib/types.ts in the Next.js app one field for one field. If you change
one, change the other in the same commit — a mismatch here surfaces as
a blank section on a demo you have already emailed to a stranger.
"""
from __future__ import annotations

import json
import re
import unicodedata
from dataclasses import dataclass, field, asdict
from typing import Literal


def slugify(name: str) -> str:
    """Deterministic, URL-safe, and stable across runs."""
    s = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode()
    s = re.sub(r"[^\w\s-]", "", s).strip().lower()
    s = re.sub(r"[\s_]+", "-", s)
    s = re.sub(r"-{2,}", "-", s).strip("-")
    return s[:60] or "demo"


@dataclass
class Service:
    name: str
    tag: str = ""


@dataclass
class WorkItem:
    title: str
    where: str = ""


@dataclass
class Tenant:
    slug: str
    domain: str
    company: str
    short: str
    headline: tuple[str, str]
    tagline: str
    city: str
    nearby: list[str]
    phone: str
    since: int
    rating: str
    reviews: int
    logo: dict
    colors: dict
    services: list[Service]
    work: list[WorkItem]
    ghl: dict = field(default_factory=dict)
    status: Literal["ACTIVE", "DISABLED"] = "ACTIVE"
    source: Literal["website", "places"] = "website"

    # Provenance — not read by the renderer, but the first thing you
    # want when a demo looks wrong and you need to know why.
    meta: dict = field(default_factory=dict)

    def to_json(self) -> str:
        d = asdict(self)
        d["headline"] = list(self.headline)
        return json.dumps(d, indent=2, ensure_ascii=False)


class ExtractionError(Exception):
    """Raised only when there is genuinely nothing to build a demo from."""
