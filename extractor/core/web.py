"""
PATH A — the prospect has a website.

Fetch, harvest colours, run the logo chain, hand the visible text to
Claude. Nothing here asks the prospect for anything: the demo exists
before they have heard of us, which is the entire point. Asking a
stranger to fill in a form before showing them anything converts at
approximately zero.
"""
from __future__ import annotations

import re
from urllib.parse import urljoin, urlparse

import requests
from bs4 import BeautifulSoup

from . import colors as C
from . import llm, logo
from .contract import Service, Tenant, WorkItem, slugify, ExtractionError

UA = {"User-Agent": "Mozilla/5.0 (compatible; Caito360DemoBot/1.0)"}
SUBPAGES = ("/services", "/about", "/what-we-do", "/our-work", "/gallery", "/contact")


def _get(url: str, timeout: int = 12) -> str:
    r = requests.get(url, headers=UA, timeout=timeout)
    r.raise_for_status()
    return r.text


def _linked_css(soup: BeautifulSoup, base: str, limit: int = 4) -> str:
    blobs = []
    for tag in soup.find_all("style"):
        blobs.append(tag.get_text())
    for tag in soup.find_all("link", rel=lambda v: v and "stylesheet" in " ".join(v).lower())[:limit]:
        href = tag.get("href")
        if not href:
            continue
        try:
            blobs.append(_get(urljoin(base, href), timeout=8))
        except Exception:
            continue
    return "\n".join(blobs)


def _high_signal(soup: BeautifulSoup) -> list[str]:
    """Markup where a brand colour is most likely to actually appear."""
    out = []
    for sel in ("header", "nav", "footer"):
        for tag in soup.find_all(sel):
            out.append(str(tag))
    for tag in soup.find_all(["button", "a"], limit=40):
        if tag.get("style") or tag.get("class"):
            out.append(str(tag))
    return out


def _visible_text(soup: BeautifulSoup) -> str:
    for junk in soup(["script", "style", "noscript", "svg"]):
        junk.decompose()
    text = soup.get_text("\n")
    lines = [ln.strip() for ln in text.splitlines()]
    return "\n".join(ln for ln in lines if ln)[:20000]


def extract(url: str, parent_domain: str, logo_dir: str, target_niche: bool = True) -> Tenant:
    if not url.startswith(("http://", "https://")):
        url = "https://" + url

    html = _get(url)
    soup = BeautifulSoup(html, "html.parser")

    # Pull a couple of subpages — service lists are rarely on the homepage.
    extra_text = ""
    for path in SUBPAGES:
        try:
            extra_soup = BeautifulSoup(_get(urljoin(url, path), timeout=8), "html.parser")
            extra_text += "\n" + _visible_text(extra_soup)
            if len(extra_text) > 12000:
                break
        except Exception:
            continue

    # ── colours ──────────────────────────────────────────────────────
    css = _linked_css(soup, url)
    theme = None
    meta = soup.find("meta", attrs={"name": "theme-color"})
    if meta and meta.get("content"):
        theme = meta["content"].strip()

    primary, how = C.pick_brand(html + css, theme_color=theme, weighted=_high_signal(soup))

    # ── content ──────────────────────────────────────────────────────
    host = urlparse(url).netloc.replace("www.", "")
    guess_name = host.split(".")[0].replace("-", " ").title()
    text = _visible_text(soup) + "\n" + extra_text
    facts = llm.analyse(text, hint_name=guess_name)

    if target_niche and facts.get("in_niche") is False:
        raise ExtractionError(
            f"Not in target niche: {facts.get('reject_reason') or 'no carpentry signals'}"
        )

    company = facts.get("company") or guess_name
    slug = slugify(company)

    # ── logo ─────────────────────────────────────────────────────────
    lg = logo.fetch_logo(html, url, slug, logo_dir)

    return _assemble(
        slug=slug, company=company, facts=facts, primary=primary, logo_obj=lg,
        parent_domain=parent_domain, source="website",
        meta={"origin_url": url, "color_from": how, "logo_from": lg.get("from", "generated"),
              "content_from": facts.get("_source", "?")},
    )


def _assemble(*, slug, company, facts, primary, logo_obj, parent_domain, source, meta) -> Tenant:
    city = facts.get("city") or ""
    short = (facts.get("short") or company.split()[0])[:16]

    headline = facts.get("headline") or []
    if not (isinstance(headline, list) and len(headline) == 2):
        headline = ["Carpentry and", f"cabinetry in {city}" if city else "cabinetry"]

    services = [
        Service(name=s.get("name", "").strip(), tag=(s.get("tag") or "").strip())
        for s in (facts.get("services") or [])
        if s.get("name")
    ][:6]
    if not services:
        services = [
            Service("Custom cabinetry", ""),
            Service("Built-ins and closets", ""),
            Service("Trim and finish carpentry", ""),
            Service("Interior doors", ""),
        ]

    work = [
        WorkItem(title=w.get("title", "").strip(), where=(w.get("where") or city).strip())
        for w in (facts.get("work") or [])
        if w.get("title")
    ][:3]
    if not work:
        work = [
            WorkItem("Custom closet build-out", city),
            WorkItem("Kitchen cabinet install", city),
            WorkItem("Stair railing and trim", city),
        ]

    return Tenant(
        slug=slug,
        domain=f"{slug}.{parent_domain}",
        company=company,
        short=short,
        headline=(headline[0], headline[1]),
        tagline=facts.get("tagline") or "",
        city=city,
        nearby=(facts.get("nearby") or [])[:4],
        phone=facts.get("phone") or "",
        since=facts.get("since") or 0,
        rating=str(facts.get("rating") or ""),
        reviews=int(facts.get("reviews") or 0),
        logo=logo_obj or {"type": "wordmark"},
        colors={"primary": primary},
        services=services,
        work=work,
        ghl={},
        source=source,
        meta=meta,
    )
