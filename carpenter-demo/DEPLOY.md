# Deploying to Vercel

## 1. Push to GitHub

```bash
git init && git add -A
git commit -m "Carpentry demo generator"
git remote add origin git@github.com:<org>/carpenter-demo.git
git push -u origin main
```

`.gitignore` already excludes `.env*.local`. Confirm before pushing —
committing a token means creating a new one.

## 2. Import into Vercel

New Project → import the repo → Framework auto-detects Next.js →
Deploy. No build settings to change.

## 3. Environment variables

Project Settings → Environment Variables. **Do not** commit a `.env` file.

| Name | Value | Notes |
|---|---|---|
| `DEMO_PARENT_DOMAIN` | `demo.caito360.ai` | Required for hostname routing |
| `GHL_TOKEN` | `pit-…` | Mark **Sensitive** so it can't be read back |
| `GHL_API_VERSION` | `2021-07-28` | |
| `GHL_DEFAULT_ENQUIRY_HOOK` | *(optional)* | Fallback if a tenant has no hook |

Set them for Production **and** Preview. Preview deployments otherwise
render with no branding and no data, which looks broken when someone
opens a branch URL.

**Use a separate sub-account's token for Preview.** A branch under test
must not write junk contacts into the sub-account you demo from.

## 4. The wildcard domain — do this once, never again

Project Settings → Domains → Add:

```
*.demo.caito360.ai
```

Wildcard domains require **Vercel's nameservers**, because that is what
lets one certificate cover every subdomain. So DNS for `demo.caito360.ai`
moves to Vercel — Ali's call, and a one-time task.

After this, every subdomain resolves automatically. A new demo is a
config row, not a DNS change and not a deployment.

## 5. Region

`vercel.json` pins functions to `iad1` (US East). Keep functions near
GoHighLevel's API rather than near the user — most of the page's latency
is the round trip to GHL, not to the browser. Change only if you learn
GHL is served from elsewhere.

## 6. Verify

```
https://oakline-carpentry.demo.caito360.ai/api/health
```

Expect:

```json
{ "ok": true, "tokenConfigured": true, "locationBound": true, "liveSlots": true }
```

Then open the page itself. The footer states which data source is live,
so you can see at a glance whether slots are real or seeded.

## 7. Confirm nothing leaked

Open the demo, DevTools → Network. Every request should go to your own
domain. No request to `leadconnectorhq.com`, no token anywhere.

Locally, or in CI:

```bash
npm run build
grep -rIE 'GHL_TOKEN|pit-|leadconnectorhq|locationId' .next/static/   # must be empty
```

Worth wiring into a CI step — it is the check that proves the security
model holds rather than assuming it.

---

## Vercel-specific things to know

**Rate limiting is partial.** `lib/ratelimit.ts` is in-memory, and each
serverless instance has its own. It stops a burst against one warm
instance, not a spread attack. Fine for demos; swap for Vercel KV or
Upstash before real campaign volume.

**Every page render is a function invocation.** `force-dynamic` means
nothing is cached, which is correct — tenant config is read per request.
It also means invocations scale with traffic. Negligible at demo volume;
worth knowing if a demo goes viral.

**Middleware runs on the Edge runtime.** It deliberately does no database
work — only string parsing on the hostname. Keep it that way; a DB call
in middleware runs on every request including assets.

**`import 'server-only'`** makes importing `lib/ghl.ts` into a client
component a build failure rather than a silent credential leak. Don't
remove it.

**Preview URLs bypass the wildcard.** A deployment gets
`carpenter-demo-abc123.vercel.app`, which matches no tenant, so it
404s. Use `?t=<slug>` on preview — the dev override is enabled outside
production. Remove that override before this is client-facing.

## Cost, roughly

| | |
|---|---|
| Subdomains | £0, unlimited |
| SSL | £0, automatic |
| Vercel Pro | ~$20/seat/mo, includes $20 usage credit |
| Postgres (when you swap off JSON) | a few dollars |
| **GHL sub-accounts** | **the real cost — unlimited on the $297+ tiers** |
| GHL premium workflow actions | metered per execution |

The hosting side is a rounding error. The cost that matters is on the
GoHighLevel side, and using the token path avoids the per-execution
charge on the inbound-webhook trigger.
