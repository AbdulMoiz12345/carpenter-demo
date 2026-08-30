"""
THE LOGO FALLBACK CHAIN

Six steps, tried in order. The sixth cannot fail, which is the whole
point: extraction must always produce something. A generated wordmark
looks deliberate; a broken <img> kills the demo.

This is exactly the step the outside vendor could not demonstrate —
asked about logos, the answer was "I'm not sure, it's just a picture."
"""
from __future__ import annotations

import io
import os
from urllib.parse import urljoin, urlparse

import requests
from bs4 import BeautifulSoup
from PIL import Image

UA = {"User-Agent": "Mozilla/5.0 (compatible; Caito360DemoBot/1.0)"}
MIN_PX = 48          # anything smaller is a favicon pretending to be a logo
MAX_BYTES = 3_000_000


def _abs(base: str, src: str) -> str:
    return urljoin(base, src)


def _candidates(soup: BeautifulSoup, base: str) -> list[tuple[str, str]]:
    """(url, which_step_found_it), in priority order."""
    out: list[tuple[str, str]] = []

    # 1. apple-touch-icon — usually a clean square PNG, best quality
    for rel in ("apple-touch-icon", "apple-touch-icon-precomposed"):
        for tag in soup.find_all("link", rel=lambda v: v and rel in " ".join(v).lower()):
            if tag.get("href"):
                out.append((_abs(base, tag["href"]), "apple-touch-icon"))

    # 2. og:image — what the site chose to show when shared
    for tag in soup.find_all("meta", property="og:image"):
        if tag.get("content"):
            out.append((_abs(base, tag["content"]), "og-image"))

    # 3. an <img> in the header or nav with "logo" in src/alt/class
    for parent in soup.find_all(["header", "nav"]) or [soup]:
        for img in parent.find_all("img"):
            hay = " ".join(
                filter(None, [img.get("src", ""), img.get("alt", ""),
                              " ".join(img.get("class", []))])
            ).lower()
            if "logo" in hay and img.get("src"):
                out.append((_abs(base, img["src"]), "header-img"))

    # 4. any img with logo in the filename, anywhere on the page
    for img in soup.find_all("img"):
        src = img.get("src", "")
        if "logo" in src.lower():
            out.append((_abs(base, src), "header-img"))

    # 5. favicon — last resort before generating
    for tag in soup.find_all("link", rel=lambda v: v and "icon" in " ".join(v).lower()):
        if tag.get("href"):
            out.append((_abs(base, tag["href"]), "favicon"))
    out.append((_abs(base, "/favicon.ico"), "favicon"))

    seen, uniq = set(), []
    for url, how in out:
        if url not in seen:
            seen.add(url)
            uniq.append((url, how))
    return uniq


def _download_ok(url: str) -> tuple[bytes, str] | None:
    try:
        r = requests.get(url, headers=UA, timeout=8, stream=True)
        if r.status_code != 200:
            return None
        data = r.content[:MAX_BYTES]
        ctype = r.headers.get("content-type", "").split(";")[0].strip()

        # SVG is text, so Pillow cannot size it — accept without checking.
        # SECURITY: an SVG can contain executable script. It is never
        # rendered inline; it is served as a file from object storage,
        # which prevents script execution in the page context.
        if "svg" in ctype or url.lower().endswith(".svg"):
            if b"<svg" not in data[:2000]:
                return None
            return data, "svg"

        img = Image.open(io.BytesIO(data))
        w, h = img.size
        if w < MIN_PX or h < MIN_PX:
            return None
        # A very wide, very short strip is usually a banner, not a logo,
        # but it is still better than nothing — keep it, just note it.
        fmt = (img.format or "png").lower()
        return data, fmt
    except Exception:
        return None


def fetch_logo(html: str, base_url: str, slug: str, out_dir: str) -> dict:
    """
    Returns a `logo` dict matching the Tenant contract:
      {"type": "image", "url": "/logos/<slug>.png", "from": "<step>"}
      {"type": "wordmark"}
    """
    soup = BeautifulSoup(html, "html.parser")

    for url, how in _candidates(soup, base_url):
        got = _download_ok(url)
        if not got:
            continue
        data, ext = got
        os.makedirs(out_dir, exist_ok=True)
        path = os.path.join(out_dir, f"{slug}.{ext}")
        with open(path, "wb") as fh:
            fh.write(data)
        return {"type": "image", "url": f"/logos/{slug}.{ext}", "from": how}

    # 6. Nothing usable. The renderer draws a wordmark from the company
    #    name and the brand colour. This branch is not a failure — for
    #    Path B (no website) it is the normal outcome.
    return {"type": "wordmark"}
