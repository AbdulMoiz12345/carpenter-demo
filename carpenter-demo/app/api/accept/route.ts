import { NextResponse } from 'next/server';
import { z } from 'zod';
import { resolveTenantForApi } from '@/lib/tenants';
import { fireWorkflow } from '@/lib/ghl';
import { rateLimit, clientKey } from '@/lib/ratelimit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * THE OWNER ACCEPTS
 *
 * On a demo the prospect plays both parts, so making them accept from a
 * second inbox would mean two email addresses and three messages landing
 * in one place. Instead the Accept button lives in the owner panel on the
 * page: one address, one inbox, both roles clearly separated on screen.
 *
 * This fires a second GoHighLevel workflow — the same one a real owner
 * would trigger by clicking Accept in their notification email.
 */
const Body = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().email().max(160).optional().or(z.literal('')),
  phone: z.string().trim().max(32).optional().or(z.literal('')),
  slotLabel: z.string().trim().max(120).optional().or(z.literal(''))
});

export async function POST(req: Request) {
  const limit = rateLimit(clientKey(req, 'accept'), 10);
  if (!limit.ok) return NextResponse.json({ error: 'Too many attempts.' }, { status: 429 });

  const tenant = await resolveTenantForApi(req);
  if (!tenant) return NextResponse.json({ error: 'Unknown demo.' }, { status: 404 });

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Nothing to accept.' }, { status: 400 });

  const { name, email, phone, slotLabel } = parsed.data;

  // A dedicated hook so the acceptance workflow is separate from the
  // enquiry one. Falls back to the enquiry hook so the button still does
  // something on a deployment where only one is configured.
  const hook =
    process.env.GHL_ACCEPT_HOOK ??
    tenant.ghl.enquiryHook ??
    process.env.GHL_DEFAULT_ENQUIRY_HOOK;

  const res = await fireWorkflow(hook, {
    firstName: name.split(' ')[0],
    fullName: name,
    email,
    phone,
    appointmentLabel: slotLabel,
    status: 'accepted',
    source: 'demo-owner-accept',
    tags: ['visit-confirmed'],
    company: tenant.company,
    slug: tenant.slug
  });

  return NextResponse.json({
    ok: true,
    live: res.ok,
    detail: res.ok
      ? `Confirmation sent${email ? ` to ${email}` : ''}.`
      : process.env.GHL_ACCEPT_HOOK
        ? `Accept workflow did not fire — ${res.reason}`
        : 'No acceptance workflow configured. Set GHL_ACCEPT_HOOK.'
  });
}
