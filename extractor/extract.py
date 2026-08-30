#!/usr/bin/env python3
"""
extract.py — company in, branded demo config out.

    ./extract.py https://oaklinecarpentry.com
    ./extract.py --places "Hale Carpentry, Plano TX"
    ./extract.py --batch prospects.csv
    ./extract.py --sample samples/oakline.html --name "Oakline Carpentry"

Writes <slug>.json into the Next.js data/ directory and any logo into
public/logos/. Adding a demo is then one config row — no build, no
deployment, no DNS change. The subdomain already resolves via the
wildcard.
"""
from __future__ import annotations

import argparse
import csv
import json
import os
import sys
import traceback

from core import logo as logo_mod
from core import places as places_path
from core import push as push_mod
from core import web as web_path
from core.contract import ExtractionError, slugify
from core import colors as C

DEFAULT_DATA = "../carpenter-demo/data"
DEFAULT_LOGOS = "../carpenter-demo/public/logos"


def _write(tenant, data_dir: str) -> str:
    os.makedirs(data_dir, exist_ok=True)
    path = os.path.join(data_dir, f"{tenant.slug}.json")
    with open(path, "w", encoding="utf-8") as fh:
        fh.write(tenant.to_json())
    return path


def _report(tenant, path: str, parent: str) -> None:
    m = tenant.meta
    safe = C.contrast_safe(tenant.colors["primary"])
    darkened = safe.lower() != tenant.colors["primary"].lower()

    print(f"\n  {tenant.company}")
    print(f"  {'─' * 52}")
    print(f"  url        https://{tenant.slug}.{parent}")
    print(f"  colour     {tenant.colors['primary']}  (via {m.get('color_from')})"
          + (f"  → {safe} for text" if darkened else ""))
    print(f"  logo       {m.get('logo_from')}")
    print(f"  content    {m.get('content_from')}")
    print(f"  services   {len(tenant.services)}   nearby {len(tenant.nearby)}")
    print(f"  written    {path}")
    if m.get("content_from", "").startswith(("no-api-key", "llm-failed")):
        print("  ! content came from heuristics — set ANTHROPIC_API_KEY for better copy")
    if not tenant.city:
        print("  ! no city found — headline and seed data will be generic")
    if not tenant.phone:
        print("  ! no phone found")


def run_one(args, target) -> int:
    try:
        if args.places:
            t = places_path.extract(target, args.parent, target_niche=not args.no_filter)
        elif args.sample:
            t = _from_sample(target, args.name, args.parent, args.logos, not args.no_filter)
        else:
            t = web_path.extract(target, args.parent, args.logos, target_niche=not args.no_filter)
    except ExtractionError as e:
        print(f"  SKIP  {target}\n        {e}")
        return 1
    except Exception as e:
        print(f"  FAIL  {target}\n        {type(e).__name__}: {e}")
        if args.verbose:
            traceback.print_exc()
        return 2

    # Logo to Blob before pushing: anything under public/ is baked into
    # the build, so a local file would mean a redeploy per prospect.
    if args.push and t.logo.get("type") == "image":
        local = os.path.join(args.logos, os.path.basename(t.logo["url"]))
        try:
            t.logo = {"type": "image", "url": push_mod.upload_logo(local, t.slug),
                      "from": t.logo.get("from", "?")}
        except push_mod.PushError as e:
            print(f"        ! logo upload failed ({e}) — falling back to wordmark")
            t.logo = {"type": "wordmark"}

    path = _write(t, args.data) if not args.push_only else "(not written locally)"

    if args.push:
        try:
            payload = json.loads(t.to_json())
            payload.setdefault("meta", {})
            res = push_mod.push_tenant(payload, args.push)
            _report(t, path, args.parent)
            print(f"  pushed     {res.get('result')} -> {res.get('url')}")
            return 0
        except push_mod.PushError as e:
            print(f"  FAIL  {target}\n        {e}")
            return 2

    _report(t, path, args.parent)
    return 0


def _from_sample(path: str, name: str, parent: str, logo_dir: str, filter_niche: bool):
    """Offline mode. Runs the whole pipeline against a local HTML file
    so the logic can be verified without network access."""
    from bs4 import BeautifulSoup
    from core import llm
    from core.contract import slugify as _slug

    html = open(path, encoding="utf-8").read()
    soup = BeautifulSoup(html, "html.parser")

    theme = None
    meta = soup.find("meta", attrs={"name": "theme-color"})
    if meta and meta.get("content"):
        theme = meta["content"].strip()

    css = "\n".join(t.get_text() for t in soup.find_all("style"))
    primary, how = C.pick_brand(html + css, theme_color=theme,
                               weighted=web_path._high_signal(soup))

    facts = llm.analyse(web_path._visible_text(soup), hint_name=name)
    if filter_niche and facts.get("in_niche") is False:
        raise ExtractionError(facts.get("reject_reason") or "not in niche")

    company = facts.get("company") or name
    return web_path._assemble(
        slug=_slug(company), company=company, facts=facts, primary=primary,
        logo_obj={"type": "wordmark"}, parent_domain=parent, source="website",
        meta={"origin_url": f"file://{path}", "color_from": how,
              "logo_from": "generated (offline mode)",
              "content_from": facts.get("_source", "?")},
    )


def main() -> int:
    ap = argparse.ArgumentParser(description="Generate a branded demo config from a company.")
    ap.add_argument("target", nargs="?", help="URL, or business name with --places")
    ap.add_argument("--places", action="store_true", help="Path B: no website, use Google Places")
    ap.add_argument("--sample", action="store_true", help="Offline: read a local HTML file")
    ap.add_argument("--name", default="", help="Business name hint, for --sample")
    ap.add_argument("--batch", help="CSV with a 'url' or 'name' column")
    ap.add_argument("--parent", default=os.environ.get("DEMO_PARENT_DOMAIN", "demo.caito360.ai"))
    ap.add_argument("--data", default=DEFAULT_DATA)
    ap.add_argument("--logos", default=DEFAULT_LOGOS)
    ap.add_argument("--push", metavar="URL",
                    default=os.environ.get("DEMO_APP_URL"),
                    help="POST to a deployed app instead of only writing files "
                         "(e.g. https://demo.caito360.ai). Needs ADMIN_TOKEN.")
    ap.add_argument("--push-only", action="store_true", help="Do not write local JSON")
    ap.add_argument("--no-filter", action="store_true", help="Keep businesses outside the niche")
    ap.add_argument("-v", "--verbose", action="store_true")
    args = ap.parse_args()

    if args.batch:
        ok = skipped = failed = 0
        with open(args.batch, newline="", encoding="utf-8") as fh:
            for row in csv.DictReader(fh):
                target = (row.get("url") or row.get("name") or "").strip()
                if not target:
                    continue
                args.places = not (row.get("url") or "").strip()
                rc = run_one(args, target)
                ok += rc == 0
                skipped += rc == 1
                failed += rc == 2
        print(f"\n  {ok} generated · {skipped} skipped · {failed} failed")
        return 0 if failed == 0 else 1

    if not args.target:
        ap.error("give a URL, or --batch a CSV")
    return run_one(args, args.target)


if __name__ == "__main__":
    sys.exit(main())
