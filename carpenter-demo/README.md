# Carpentry demo generator — front end

One Next.js app that serves many branded demos. Adding a demo is a
config row, never a deployment.

## Run it

```bash
npm install
npm run dev
```

Open http://localhost:3000 — a dev-only bar at the bottom switches
between the four sample carpenters. In production there is no switcher:
each demo lives at its own hostname.

Nothing needs configuring. It runs with **zero credentials** and every
screen works. Adding credentials upgrades it — see below.

## How a demo resolves

```
brightsmile.demo.caito360.ai
  → middleware reads the Host header       → slug "brightsmile"
  → resolveTenant() loads that config      → tenant
  → brandVars() injects three CSS vars     → their colours
  → getLiveSlots() or seedFor()            → their data
```

The hostname is the only input that decides whose demo renders. It is
read server-side and never accepted from the browser.

## The three levels of "live"

| Configured | What works |
|---|---|
| Nothing | Whole page renders. Form validates. Slots seeded. |
| `enquiryHook` | Form and booking fire a **real GHL workflow** — real SMS. No API key needed. |
| `+ GHL_TOKEN` + `calendarId` | Booking slots come from the **real calendar**. |

The second level is the useful one: an inbound-webhook URL is a
write-only workflow trigger, so real automations fire before anyone
has sorted out a developer account.

## Wiring GHL (15 minutes)

1. Build one carpenter sub-account: pipeline `Enquiry → Site visit
   booked → Quote sent → Won`, plus four workflows (missed-call
   text-back, new-enquiry nurture, visit reminders, review request).
2. In the new-enquiry workflow, set the trigger to **Inbound Webhook**
   and copy the URL it gives you.
3. Paste it into that tenant's `ghl.enquiryHook`, or set
   `GHL_DEFAULT_ENQUIRY_HOOK` to cover all tenants.
4. Save the sub-account as a **snapshot** and clone it per demo.

Then `GET /api/health` before any meeting. It reports whether the hook,
token, location binding and live slots are actually working — much
better than discovering a broken demo while a prospect watches.

## Deploying

1. Push to GitHub, import into Vercel.
2. Add the wildcard domain `*.demo.caito360.ai` to the project. Wildcards
   require Vercel's nameservers so one certificate covers every subdomain.
3. Set `DEMO_PARENT_DOMAIN=demo.caito360.ai`.

That is the only DNS work, ever. After it, a new demo is one config row.

## Swapping files for a database

`lib/tenants.ts` is the seam. Replace the body of `loadAll()` with a
Postgres query and nothing else changes:

```ts
// SELECT * FROM tenants WHERE status = 'ACTIVE'
```

Everything else already treats tenants as data.

## Rules that must not be broken

- **No hex colour in any component.** Only `var(--brand*)`. Worth a lint
  rule that fails the build — one hardcoded colour and every demo shows it.
- **Only `lib/ghl.ts` talks to GoHighLevel.** `import 'server-only'` makes a
  violation a build error rather than a silent credential leak.
- **Never trust a tenant id, location id or slot from the browser.** All three
  are derived or re-validated server-side.
- **Seed data is always synthetic**, generated relative to today so a demo
  built in August never shows "upcoming" jobs in the past.

Verify the first three at any time:

```bash
npm run build
grep -rIE 'GHL_TOKEN|leadconnectorhq|locationId' .next/static/   # must return nothing
```

## What is deliberately not here

No admin UI, no extractor, no OAuth, no custom domains, no provisioning
orchestrator, no second vertical. Those come after this page has been
shown to real prospects and the reply-rate numbers exist.
