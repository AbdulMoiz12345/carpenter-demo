# Extractor — company in, branded demo out

Turns a carpenter's website (or their Google listing, if they have no
website) into a config file the demo app renders. No human design step.

```bash
pip install -r requirements.txt

export ANTHROPIC_API_KEY=sk-ant-...       # much better copy
export GOOGLE_PLACES_KEY=...              # only for Path B

./extract.py https://oaklinecarpentry.com
./extract.py --places "Hale Carpentry, Plano TX"
./extract.py --batch prospects.csv
```

Writes `<slug>.json` into `../carpenter-demo/data/` and any logo into
`../carpenter-demo/public/logos/`. Then add one import line to
`lib/tenants.ts` and the URL is live — no build, no deploy, no DNS.

## Two paths, one contract

|  | Path A — has a website | Path B — no website |
|---|---|---|
| Logo | 6-step chain, real logo usually found | Always a generated wordmark |
| Colour | Sampled from their own site | Preset palette, hashed on name |
| Content | Their own copy | Google category + review text |
| Pitch | "A better version of your site" | **"The website you don't have"** |

Both emit identical JSON. The renderer cannot tell which ran — that is
the point, and it is why `core/contract.py` mirrors `lib/types.ts`
field for field. **Change one, change the other in the same commit.**

## The logo chain

1. `apple-touch-icon` — usually a clean square PNG
2. `og:image`
3. `<img>` in header/nav with "logo" in src, alt or class
4. any `<img>` with "logo" in the filename
5. `/favicon.ico`
6. **generated wordmark**

Step 6 is why extraction never fails. A generated wordmark looks
deliberate; a broken `<img>` kills a demo you have already emailed to a
stranger. This is the exact step the outside vendor could not
demonstrate — asked about logos, the answer was "I'm not sure, it's
just a picture."

Images under 48px are rejected as favicons in disguise. SVGs are saved
as files, never rendered inline, because an SVG can carry script.

## The contrast guard

An extracted colour is arbitrary. Some prospects have a pale yellow
brand. `contrast_safe()` darkens toward black until white text passes
WCAG AA:

```
#f2d14a  →  #827128   (4.84:1)
#ffffff  →  #727272   (4.81:1)
#7a4b24  →  unchanged (7.34:1)
```

It is a direct port of `contrastSafe()` in `lib/theme.ts`. **The two
must stay identical** or the extractor and the server will disagree
about what a brand looks like.

## Niche filtering

Folded into the same Claude call as content extraction — one API hit
does both. A general contractor listing carpentry among twenty trades
returns `in_niche: false` and is skipped with a reason.

Override with `--no-filter`.

## When Claude is unavailable

No API key, rate limit, bad response — it falls back to regex
heuristics for services, phone, city, nearby towns and founding year.
Output is noticeably blander and the run is flagged
`content_from: no-api-key`, but the pipeline never stops.

## Determinism

Same input, same output. Slugs are derived from the company name;
Path B palettes are hashed on it. Re-running must never silently
re-brand a demo that has already gone out.

## Offline testing

```bash
./extract.py --sample samples/oakline.html --name "Oakline Carpentry" \
             --data out --logos out/logos
```

Runs the whole pipeline against a local file. `samples/` includes a
normal brand, a pale-yellow brand (exercises the contrast guard), and a
dentist (should be skipped as out of niche).

## Read the run report

```
  colour     #f2d14a  (via theme-color)  → #827128 for text
  logo       apple-touch-icon
  content    llm
  services   5   nearby 3
```

`color_from: fallback`, `logo_from: generated`, or
`content_from: no-api-key` all mean that demo is weaker than it should
be. Worth eyeballing before it goes into a campaign.

## Before a real campaign

- **Look at the first twenty.** Extraction is good, not perfect.
- **Test deliberately awkward inputs**: a site with no logo, a
  near-white brand, a JS-only site with no server-rendered text, a
  business whose name is one word.
- **JS-rendered sites are the known gap.** Sites built entirely in React
  with no SSR return an empty shell. Adding Playwright would fix it and
  would also allow screenshot-based colour sampling. Not needed for the
  first campaign — most small trade sites are WordPress or Squarespace
  and render server-side.
