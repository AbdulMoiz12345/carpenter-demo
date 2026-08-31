import 'server-only';
import type { Tenant } from './types';

/**
 * THE ONLY MODULE THAT TALKS TO GOHIGHLEVEL
 *
 * 'server-only' makes importing this from a client component a build
 * error rather than a silent credential leak. Nothing else in the app
 * is permitted to call GHL directly — that guarantee is what keeps
 * tokens off the browser.
 *
 * Two independent paths, deliberately:
 *
 *  1. INBOUND WEBHOOK (no credentials)
 *     A workflow trigger URL. POST to it and the workflow runs.
 *     Write-only. Needs no token, no scopes, no developer account —
 *     so the demo can fire real automations before any of that is
 *     sorted out.
 *
 *  2. API TOKEN (credentials required)
 *     Needed to READ anything back — live calendar slots, contacts.
 *     Optional: without it the demo falls back to seeded data and
 *     still works end to end.
 */

const API = 'https://services.leadconnectorhq.com';
const TIMEOUT_MS = 6000;

/**
 * Every demo shares one GoHighLevel sub-account and one calendar unless
 * it has been bound to its own. That makes a newly generated demo work
 * fully — live slots included — with no per-demo setup, which matters
 * when one is built live on a call.
 *
 * It also means contacts from different prospects land in the same
 * sub-account. Fine while demos are internal. Before real prospects can
 * submit forms, this has to become one sub-account per vertical, or
 * prospect A will see prospect B in the contact list.
 */
export function locationFor(tenant: Tenant): string | undefined {
  return tenant.ghl.locationId ?? process.env.GHL_DEFAULT_LOCATION_ID ?? undefined;
}

export function calendarFor(tenant: Tenant): string | undefined {
  return tenant.ghl.calendarId ?? process.env.GHL_DEFAULT_CALENDAR_ID ?? undefined;
}

async function withTimeout(url: string, init: RequestInit) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: ac.signal, cache: 'no-store' });
  } finally {
    clearTimeout(timer);
  }
}

/* ── 1. Trigger a workflow. No credentials. ───────────────────── */

export type HookResult = { ok: true } | { ok: false; reason: string };

export async function fireWorkflow(url: string | undefined, payload: unknown): Promise<HookResult> {
  if (!url) return { ok: false, reason: 'no-hook-configured' };

  // Environment variables pick up trailing newlines and spaces very
  // easily, and an invalid URL then surfaces as a bare network error.
  const clean = url.trim();
  try {
    const parsed = new URL(clean);
    if (parsed.protocol !== 'https:') return { ok: false, reason: `not-https: ${parsed.protocol}` };
  } catch {
    return { ok: false, reason: `malformed-url (${clean.slice(0, 60)}…)` };
  }

  try {
    const res = await withTimeout(clean, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (res.ok) return { ok: true };
    let body = '';
    try {
      body = (await res.text()).slice(0, 160);
    } catch { /* status alone will do */ }
    console.error('[ghl] inbound hook rejected', res.status, body);
    return { ok: false, reason: `HTTP ${res.status}${body ? `: ${body}` : ''}` };
  } catch (e) {
    // Never let a GHL failure take down the page. A prospect is watching.
    const name = (e as Error).name;
    console.error('[ghl] inbound hook failed', name);
    return {
      ok: false,
      reason: name === 'TimeoutError' ? 'timed out after 6s' : `network (${name})`
    };
  }
}

/* ── 2. Read from GHL. Needs a token. ─────────────────────────── */

function authHeaders() {
  const token = process.env.GHL_TOKEN;
  if (!token) return null;
  return {
    Authorization: `Bearer ${token}`,
    Version: process.env.GHL_API_VERSION ?? '2021-07-28',
    Accept: 'application/json'
  };
}

export interface Slot {
  iso: string;
  /** "Wed" */
  day: string;
  /** "Sep 2" */
  date: string;
  /** "2026-09-02" — groups slots into days in the picker. */
  dayKey: string;
  /** "1:00 PM" */
  time: string;
}

/**
 * Spread across days rather than taking the first N in a row.
 *
 * GoHighLevel returns free slots in chronological order, so a naive
 * slice gave six times on one afternoon — which reads as "this business
 * has almost no availability". Capping per day and reaching further out
 * shows a real week.
 */
const SLOTS_PER_DAY = 4;
const DAYS_SHOWN = 5;

/**
 * Live availability, or null when unavailable.
 *
 * Returning null rather than throwing is intentional: the caller
 * falls back to seeded slots, so a missing token or a GHL outage
 * degrades one panel instead of breaking the demo.
 */
export async function getLiveSlots(tenant: Tenant): Promise<Slot[] | null> {
  const h = authHeaders();
  const calendarId = calendarFor(tenant);
  if (!h || !calendarId) return null;

  const from = Date.now();
  const to = from + 1000 * 60 * 60 * 24 * 21;
  const url = `${API}/calendars/${calendarId}/free-slots?startDate=${from}&endDate=${to}`;

  try {
    const res = await withTimeout(url, { headers: h });
    if (!res.ok) return null;
    const json = (await res.json()) as Record<string, { slots?: string[] }>;

    const byDay = new Map<string, Slot[]>();
    for (const day of Object.values(json)) {
      for (const iso of day.slots ?? []) {
        const d = new Date(iso);
        const dayKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        const bucket = byDay.get(dayKey) ?? [];
        if (bucket.length >= SLOTS_PER_DAY) continue;
        bucket.push({
          iso,
          dayKey,
          day: d.toLocaleDateString('en-US', { weekday: 'short' }),
          date: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
          time: d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
        });
        byDay.set(dayKey, bucket);
      }
    }

    const out = [...byDay.keys()].sort().slice(0, DAYS_SHOWN).flatMap((k) => byDay.get(k)!);
    return out.length ? out : null;
  } catch {
    return null;
  }
}

/** Pre-demo check. Cheap call, run before a meeting, never cached. */
export async function healthCheck(tenant: Tenant) {
  const h = authHeaders();
  return {
    slug: tenant.slug,
    // The dependable trigger. Without it, a workflow may never fire even
    // though the contact write succeeded.
    hookConfigured: Boolean(tenant.ghl.enquiryHook ?? process.env.GHL_DEFAULT_ENQUIRY_HOOK),
    tokenConfigured: Boolean(h),
    locationBound: Boolean(locationFor(tenant)),
    locationFrom: tenant.ghl.locationId ? 'tenant' : process.env.GHL_DEFAULT_LOCATION_ID ? 'default' : 'none',
    calendarFrom: tenant.ghl.calendarId ? 'tenant' : process.env.GHL_DEFAULT_CALENDAR_ID ? 'default' : 'none',
    liveSlots: (await getLiveSlots(tenant)) !== null
  };
}

/* ── 3. Writes via the Private Integration Token ──────────────── */

export interface ContactInput {
  firstName: string;
  lastName?: string;
  email?: string;
  phone?: string;
  tags: string[];
  customFields?: { key: string; value: string }[];
  source?: string;
}

export type WriteResult =
  | { ok: true; contactId: string }
  | { ok: false; reason: string };

/**
 * Create or update a contact directly.
 *
 * Preferred over the inbound webhook once a token exists: the webhook
 * is a premium trigger billed per execution, whereas tagging a contact
 * fires a workflow for free. The tag becomes the trigger.
 *
 * locationId is taken from the tenant record server-side. It is never
 * accepted from the browser — that is the isolation boundary.
 */
export async function upsertContact(
  tenant: Tenant,
  input: ContactInput
): Promise<WriteResult> {
  const h = authHeaders();
  const locationId = locationFor(tenant);
  if (!h || !locationId) return { ok: false, reason: 'no-token-or-location' };

  try {
    const res = await withTimeout(`${API}/contacts/upsert`, {
      method: 'POST',
      headers: { ...h, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        locationId,
        firstName: input.firstName,
        lastName: input.lastName,
        email: input.email,
        phone: input.phone,
        tags: input.tags,
        source: input.source ?? 'demo-site',
        customFields: input.customFields
      })
    });

    if (!res.ok) {
      // Read the message but never the whole body — a response can echo
      // the request, and request headers carry the token.
      let why = `HTTP ${res.status}`;
      try {
        const body = (await res.json()) as { message?: string | string[]; error?: string };
        const msg = Array.isArray(body.message) ? body.message.join('; ') : body.message;
        if (msg) why = `${res.status}: ${String(msg).slice(0, 200)}`;
        else if (body.error) why = `${res.status}: ${String(body.error).slice(0, 200)}`;
      } catch {
        /* keep the status code */
      }
      console.error('[ghl] upsertContact failed —', why);
      return { ok: false, reason: why };
    }

    const json = (await res.json()) as { contact?: { id?: string } };
    const id = json.contact?.id;
    return id ? { ok: true, contactId: id } : { ok: false, reason: 'no-id-returned' };
  } catch (e) {
    console.error('[ghl] upsertContact failed', (e as Error).name);
    return { ok: false, reason: 'network' };
  }
}

/** Book against a real calendar. Requires calendars/events.write. */
export async function createAppointment(
  tenant: Tenant,
  contactId: string,
  slotIso: string
): Promise<WriteResult> {
  const h = authHeaders();
  const locationId = locationFor(tenant);
  const calendarId = calendarFor(tenant);
  if (!h || !locationId || !calendarId) {
    return { ok: false, reason: 'not-configured' };
  }

  try {
    const res = await withTimeout(`${API}/calendars/events/appointments`, {
      method: 'POST',
      headers: { ...h, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        calendarId,
        locationId,
        contactId,
        startTime: slotIso,
        title: 'Site visit',
        // NOT confirmed. The owner accepts it, which is both truer to how
        // a trade business actually works — he checks whether he can get
        // there — and a better demo, because it shows him staying in
        // control rather than a calendar filling itself.
        appointmentStatus: 'new'
      })
    });

    if (!res.ok) {
      console.error('[ghl] createAppointment', res.status);
      return { ok: false, reason: `ghl-${res.status}` };
    }
    const json = (await res.json()) as { id?: string };
    return { ok: true, contactId: json.id ?? contactId };
  } catch (e) {
    console.error('[ghl] createAppointment failed', (e as Error).name);
    return { ok: false, reason: 'network' };
  }
}

export function hasToken(): boolean {
  return Boolean(process.env.GHL_TOKEN);
}
