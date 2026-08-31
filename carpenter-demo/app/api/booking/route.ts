import { NextResponse } from 'next/server';
import { z } from 'zod';
import { resolveTenantForApi } from '@/lib/tenants';
import {
  locationFor,
  upsertContact,
  createAppointment,
  fireWorkflow,
  getLiveSlots,
  hasToken
} from '@/lib/ghl';
import { rateLimit, clientKey } from '@/lib/ratelimit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Body = z.object({
  name: z.string().trim().min(1).max(120),
  phone: z.string().trim().min(6).max(32),
  email: z.string().trim().email().max(160).optional(),
  slotIso: z.string().datetime()
});

/**
 * Site-visit booking.
 *
 * The slot arrives from the browser, so it is re-validated against
 * live availability before anything is created. Never trust a slot
 * sent by the client — otherwise someone edits the request and books
 * a time that was never offered.
 */
export async function POST(req: Request) {
  const limit = rateLimit(clientKey(req, 'booking'), 8);
  if (!limit.ok) return NextResponse.json({ error: 'Too many attempts.' }, { status: 429 });

  const tenant = await resolveTenantForApi(req);
  if (!tenant) return NextResponse.json({ error: 'Unknown demo.' }, { status: 404 });

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'Pick a slot and add your details.' }, { status: 400 });
  }
  let hookFailure: string | null = null;
  const { name, phone, email, slotIso } = parsed.data;
  const [firstName, ...rest] = name.split(' ');
  const when = new Date(slotIso);
  const label = when.toLocaleString('en-US', {
    weekday: 'long', month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit'
  });

  // Re-check availability whenever we have a live calendar.
  const live = await getLiveSlots(tenant);
  if (live && !live.some((s) => s.iso === slotIso)) {
    return NextResponse.json({ error: 'That slot has just gone. Pick another.' }, { status: 409 });
  }

  // A dedicated booking workflow can word its emails around a requested
  // slot ("we'll confirm within the hour"), which the enquiry workflow
  // cannot. Falls back so the button always does something.
  const hook =
    tenant.ghl.bookingHook ??
    process.env.GHL_BOOKING_HOOK ??
    tenant.ghl.enquiryHook ??
    process.env.GHL_DEFAULT_ENQUIRY_HOOK;

  // ── Path 1: inbound webhook — fires reliably ───────────────────
  // Preferred for the same reason as the enquiry route: GoHighLevel
  // does not emit a "tag added" event for a contact created with tags,
  // so the token path cannot be relied on to start a workflow.
  if (hook) {
    const res = await fireWorkflow(hook, {
      firstName,
      fullName: name,
      email,
      phone,
      appointmentIso: slotIso,
      appointmentLabel: label,
      source: 'demo-site-booking',
      tags: ['demo-lead', 'site-visit-requested'],
      status: 'requested',
      company: tenant.company,
      calendarId: tenant.ghl.calendarId,
      slug: tenant.slug
    });
    if (res.ok) {
      return NextResponse.json({
        ok: true,
        live: true,
        via: 'webhook',
        hook: process.env.GHL_BOOKING_HOOK ? 'booking' : 'enquiry-fallback',
        label
      });
    }
    hookFailure = res.reason;
  }

  // ── Path 2: token — creates a real contact and appointment ─────
  if (hasToken() && locationFor(tenant)) {
    const contact = await upsertContact(tenant, {
      firstName,
      lastName: rest.join(' ') || undefined,
      email,
      phone,
      tags: ['demo-lead', 'site-visit-requested'],
      source: 'demo-site-booking'
    });

    if (contact.ok) {
      const appt = await createAppointment(tenant, contact.contactId, slotIso);
      return NextResponse.json({
        ok: true,
        live: true,
        via: appt.ok ? 'api' : 'api-contact-only',
        label,
        detail: appt.ok
          ? 'Appointment created on the calendar.'
          : 'Contact created — calendar write unavailable, so no appointment yet.'
      });
    }
  }

  return NextResponse.json({
    ok: true,
    live: false,
    via: 'none',
    label,
    detail: hookFailure
      ? `Slot held, but the booking workflow did not fire — ${hookFailure}`
      : 'Slot held — no booking workflow is configured, so nothing was sent.'
  });
}
