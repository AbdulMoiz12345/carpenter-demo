"""
CLAUDE: NICHE CHECK + CONTENT EXTRACTION IN ONE CALL

The outside vendor ran filtering and extraction as two separate steps.
Folding them into one request halves the cost and removes a class of
bug where a business passes the filter but yields no usable content.

Always returns a usable dict. If the API key is missing, the call
fails, or the model returns something unparseable, it falls back to
heuristics — the pipeline must never stop because an LLM had a bad day.
"""
from __future__ import annotations

import json
import os
import re

SYSTEM = """You extract structured facts about small trade businesses from their own website text.

Rules:
- Output ONE JSON object and nothing else. No prose, no markdown fences.
- Never invent facts. If something is not stated, use null or an empty list.
- Services must be things this business actually says it does, in their words, lightly tidied. Title case. 2-6 items.
- headline must be exactly two short lines that together read as one sentence, US English, naming the trade and the city. No punctuation at the end of line one.
- tagline: one or two plain sentences a tradesperson would recognise as their own. No marketing adjectives like "premier", "leading", "quality".
- nearby: neighbourhoods, suburbs or nearby towns this business mentions serving. Up to 4.
- in_niche: true only if this is genuinely a carpentry, joinery, cabinetry, millwork or finish-carpentry business. A general contractor who lists carpentry among twenty trades is false.
"""

SCHEMA = """{
  "company": "string",
  "short": "string (<= 14 chars, how they'd be called in conversation)",
  "headline": ["string", "string"],
  "tagline": "string",
  "city": "string or null",
  "nearby": ["string"],
  "phone": "string or null",
  "since": "integer year or null",
  "services": [{"name": "string", "tag": "string (price/basis if stated, else empty)"}],
  "work": [{"title": "string", "where": "string"}],
  "in_niche": true,
  "reject_reason": "string or null"
}"""

MODEL = os.environ.get("EXTRACTOR_MODEL", "claude-sonnet-4-6")


def _strip_fences(s: str) -> str:
    s = s.strip()
    s = re.sub(r"^```(?:json)?", "", s).strip()
    s = re.sub(r"```$", "", s).strip()
    return s


def analyse(text: str, hint_name: str = "", hint_city: str = "") -> dict:
    key = os.environ.get("ANTHROPIC_API_KEY")
    if not key:
        return _heuristic(text, hint_name, hint_city, why="no-api-key")

    try:
        import anthropic
        client = anthropic.Anthropic(api_key=key)
        msg = client.messages.create(
            model=MODEL,
            max_tokens=1500,
            system=SYSTEM,
            messages=[{
                "role": "user",
                "content": (
                    f"Business name hint: {hint_name or 'unknown'}\n"
                    f"City hint: {hint_city or 'unknown'}\n\n"
                    f"Return JSON matching exactly this schema:\n{SCHEMA}\n\n"
                    f"Website text:\n---\n{text[:14000]}\n---"
                )
            }],
        )
        raw = "".join(b.text for b in msg.content if getattr(b, "type", "") == "text")
        data = json.loads(_strip_fences(raw))
        data["_source"] = "llm"
        return data
    except Exception as e:
        return _heuristic(text, hint_name, hint_city, why=f"llm-failed:{type(e).__name__}")


# ── Fallback ─────────────────────────────────────────────────────────

TRADE_WORDS = (
    "carpenter", "carpentry", "joinery", "joiner", "cabinet", "cabinetry",
    "millwork", "woodwork", "trim carpentry", "finish carpentry",
)

SERVICE_HINTS = (
    "custom closets", "built-ins", "cabinetry", "kitchen cabinets", "trim work",
    "crown molding", "baseboards", "interior doors", "staircases", "railings",
    "decks", "pergolas", "shelving", "wainscoting", "framing", "door hanging",
)


US_STATES = ("TX","CA","FL","NY","IL","GA","AZ","NC","OH","PA","MI","CO","TN","WA","OR")


def _guess_city(text: str, hint: str) -> str:
    """Cheap city detection for when the model is unavailable. A demo
    with no city has a generic headline and generic seed data, which is
    the difference between 'built for me' and 'a template'."""
    if hint:
        return hint
    # "Plano, TX" / "in Plano TX"
    m = re.search(r"\b([A-Z][a-zA-Z]+(?: [A-Z][a-zA-Z]+)?),?\s+(" + "|".join(US_STATES) + r")\b", text)
    if m:
        return m.group(1)
    # "in Plano" / "across Plano"
    m = re.search(r"\b(?:in|across|around|serving)\s+([A-Z][a-zA-Z]{3,})\b", text)
    if m:
        return m.group(1)
    return ""


def _guess_nearby(text: str, city: str) -> list[str]:
    """Neighbouring towns are usually listed together after the city."""
    out = []
    for m in re.finditer(r"\b(?:in|across|around|serving)\s+([A-Z][\w]+(?:,\s*[A-Z][\w]+)+(?:\s+and\s+[A-Z][\w]+)?)", text):
        chunk = m.group(1).replace(" and ", ", ")
        for part in chunk.split(","):
            part = part.strip()
            if part and part != city and part not in out and len(part) > 2:
                out.append(part)
    return out[:4]


def _heuristic(text: str, hint_name: str, hint_city: str, why: str) -> dict:
    low = text.lower()
    city = _guess_city(text, hint_city)
    nearby = _guess_nearby(text, city)
    services = [
        {"name": s.title(), "tag": ""}
        for s in SERVICE_HINTS
        if s in low
    ][:6]

    phone = None
    m = re.search(r"\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}", text)
    if m:
        phone = m.group(0)

    since = None
    m = re.search(r"(?:since|est\.?|established)\s*(19\d{2}|20[0-2]\d)", low)
    if m:
        since = int(m.group(1))

    return {
        "company": hint_name or "Unknown",
        "short": (hint_name or "Unknown").split()[0][:14],
        "headline": ["Custom carpentry", f"and cabinetry in {city}" if city else "and cabinetry"],
        "tagline": "",
        "city": city or None,
        "nearby": nearby,
        "phone": phone,
        "since": since,
        "services": services,
        "work": [],
        "in_niche": any(w in low for w in TRADE_WORDS),
        "reject_reason": None,
        "_source": why,
    }
