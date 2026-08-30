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
  try {
    const res = await withTimeout(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    return res.ok ? { ok: true } : { ok: false, reason: `ghl-${res.status}` };
  } catch (e) {
    // Never let a GHL failure take down the page. A prospect is watching.
    console.error('[ghl] inbound hook failed', (e as Error).name);
    return { ok: false, reason: 'network' };
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
  day: string;
  time: string;
}

/**
 * Live availability, or null when unavailable.
 *
 * Returning null rather than throwing is intentional: the caller
 * falls back to seeded slots, so a missing token or a GHL outage
 * degrades one panel instead of breaking the demo.
 */
export async function getLiveSlots(tenant: Tenant): Promise<Slot[] | null> {
  const h = authHeaders();
  if (!h || !tenant.ghl.calendarId) return null;

  const from = Date.now();
  const to = from + 1000 * 60 * 60 * 24 * 10;
  const url =
    `${API}/calendars/${tenant.ghl.calendarId}/free-slots` +
    `?startDate=${from}&endDate=${to}`;

  try {
    const res = await withTimeout(url, { headers: h });
    if (!res.ok) return null;
    const json = (await res.json()) as Record<string, { slots?: string[] }>;

    const out: Slot[] = [];
    for (const day of Object.values(json)) {
      for (const iso of day.slots ?? []) {
        const d = new Date(iso);
        out.push({
          iso,
          day: d.toLocaleDateString('en-GB', { weekday: 'short' }),
          time: d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
        });
        if (out.length >= 6) return out;
      }
    }
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
    locationBound: Boolean(tenant.ghl.locationId),
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
  if (!h || !tenant.ghl.locationId) return { ok: false, reason: 'no-token-or-location' };

  try {
    const res = await withTimeout(`${API}/contacts/upsert`, {
      method: 'POST',
      headers: { ...h, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        locationId: tenant.ghl.locationId,
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
  if (!h || !tenant.ghl.locationId || !tenant.ghl.calendarId) {
    return { ok: false, reason: 'not-configured' };
  }

  try {
    const res = await withTimeout(`${API}/calendars/events/appointments`, {
      method: 'POST',
      headers: { ...h, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        calendarId: tenant.ghl.calendarId,
        locationId: tenant.ghl.locationId,
        contactId,
        startTime: slotIso,
        title: 'Site visit',
        appointmentStatus: 'confirmed'
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
