"""
PATH B — the prospect has no website.

Sal flagged this segment directly: "there's home services companies
that are so backwards, they actually don't even have a website."

It is also the stronger pitch. Path A says "here's a better version of
your site". Path B says "here's the website you don't have."

Output is the same contract as Path A, so the renderer cannot tell
which path produced a tenant.
"""
from __future__ import annotations

import os

import requests

from . import llm, palettes
from .contract import Tenant, slugify, ExtractionError
from .web import _assemble

FIND = "https://places.googleapis.com/v1/places:searchText"
FIELDS = (
    "places.id,places.displayName,places.formattedAddress,"
    "places.nationalPhoneNumber,places.rating,places.userRatingCount,"
    "places.primaryTypeDisplayName,places.types,places.reviews,"
    "places.addressComponents,places.websiteUri"
)


def search(query: str, api_key: str | None = None) -> dict:
    key = api_key or os.environ.get("GOOGLE_PLACES_KEY")
    if not key:
        raise ExtractionError("GOOGLE_PLACES_KEY is not set")

    r = requests.post(
        FIND,
        headers={
            "Content-Type": "application/json",
            "X-Goog-Api-Key": key,
            "X-Goog-FieldMask": FIELDS,
        },
        json={"textQuery": query, "maxResultCount": 1},
        timeout=12,
    )
    r.raise_for_status()
    places = r.json().get("places") or []
    if not places:
        raise ExtractionError(f"No Google Places result for: {query}")
    return places[0]


def _city_from(place: dict) -> str:
    for comp in place.get("addressComponents", []):
        if "locality" in comp.get("types", []):
            return comp.get("longText", "")
    addr = place.get("formattedAddress", "")
    parts = [p.strip() for p in addr.split(",")]
    return parts[1] if len(parts) > 1 else ""


def extract(query: str, parent_domain: str, target_niche: bool = True) -> Tenant:
    place = search(query)

    company = (place.get("displayName") or {}).get("text") or query
    city = _city_from(place)

    # Reviews are the only free-text this path has. They describe what
    # the business actually did, which is a decent proxy for a service
    # list when there is no website to read.
    review_text = "\n".join(
        (r.get("text") or {}).get("text", "")
        for r in (place.get("reviews") or [])
    )
    seed_text = (
        f"{company}\n{place.get('formattedAddress','')}\n"
        f"Category: {place.get('primaryTypeDisplayName',{}).get('text','')}\n"
        f"Types: {', '.join(place.get('types', []))}\n\n"
        f"Customer reviews:\n{review_text}"
    )

    facts = llm.analyse(seed_text, hint_name=company, hint_city=city)

    if target_niche and facts.get("in_niche") is False:
        raise ExtractionError(
            f"Not in target niche: {facts.get('reject_reason') or 'no carpentry signals'}"
        )

    # Real Google numbers beat anything the model might infer.
    facts["phone"] = place.get("nationalPhoneNumber") or facts.get("phone")
    facts["city"] = city or facts.get("city")
    facts["rating"] = place.get("rating")
    facts["reviews"] = place.get("userRatingCount")

    slug = slugify(company)

    # No site to sample, so assign a preset. Hash-keyed on the business
    # name: deterministic, so re-running never silently re-brands a demo
    # that has already gone out.
    primary = palettes.for_business(company)

    return _assemble(
        slug=slug,
        company=company,
        facts=facts,
        primary=primary,
        logo_obj={"type": "wordmark"},   # no site, so always generated
        parent_domain=parent_domain,
        source="places",
        meta={
            "place_id": place.get("id"),
            "had_website": bool(place.get("websiteUri")),
            "color_from": "preset-palette",
            "logo_from": "generated",
            "content_from": facts.get("_source", "?"),
        },
    )
