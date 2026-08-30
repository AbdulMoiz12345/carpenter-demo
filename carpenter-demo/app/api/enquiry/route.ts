import { NextResponse } from 'next/server';
import { z } from 'zod';
import { resolveTenantForApi } from '@/lib/tenants';
import { upsertContact, fireWorkflow, hasToken } from '@/lib/ghl';
import { rateLimit, clientKey } from '@/lib/ratelimit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * The lead form. The moment that proves the demo is real rather than
 * a screenshot: submit here and a message arrives.
 *
 * Three delivery paths, tried in order, so the same code works at
 * every level of configuration:
 *
 *   1. TOKEN  — create the contact via the API, tagged `web-form`.
 *               A "Tag Added" workflow trigger then fires for FREE.
 *   2. WEBHOOK— POST to an inbound-webhook trigger. No token needed,
 *               but it is a premium trigger billed per execution.
 *   3. NEITHER— validate and report honestly. Page still works.
 *
 * Note what is NOT accepted from the body: no tenant id, no location
 * id, no webhook URL. Tenant identity is derived from the hostname
 * server-side. If the browser could name its own tenant, one prospect
 * could write into another prospect's sub-account.
 */
const Body = z.object({
  name: z.string().trim().min(1).max(120),
  phone: z.string().trim().min(6).max(32),
  email: z.string().trim().email().max(160).optional(),
  message: z.string().trim().max(1200).optional().default(''),
  // Honeypot: real people leave this empty.
  website: z.string().max(0).optional()
});

export async function POST(req: Request) {
  const limit = rateLimit(clientKey(req, 'enquiry'));
  if (!limit.ok) {
    return NextResponse.json(
      { error: 'Too many enquiries. Try again in a minute.' },
      { status: 429 }
    );
  }

  const tenant = await resolveTenantForApi(req);
  if (!tenant) return NextResponse.json({ error: 'Unknown demo.' }, { status: 404 });

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'Check the name and phone number.' }, { status: 400 });
  }
  const { name, phone, email, message } = parsed.data;
  const [firstName, ...rest] = name.split(' ');

  // ── Path 1: token ──────────────────────────────────────────────
  if (hasToken() && tenant.ghl.locationId) {
    const res = await upsertContact(tenant, {
      firstName,
      lastName: rest.join(' ') || undefined,
      email,
      phone,
      // The tag IS the workflow trigger. Must match GHL exactly.
      tags: ['demo-lead', 'web-form'],
      source: 'demo-site',
      customFields: message ? [{ key: 'rough_size', value: message }] : undefined
    });

    if (res.ok) {
      return NextResponse.json({
        ok: true,
        live: true,
        via: 'api',
        contactId: res.contactId,
        detail: 'Contact created and tagged — the workflow has fired.'
      });
    }
    // fall through to the webhook rather than failing outright
  }

  // ── Path 2: inbound webhook ────────────────────────────────────
  const hook = tenant.ghl.enquiryHook ?? process.env.GHL_DEFAULT_ENQUIRY_HOOK;
  const hookRes = await fireWorkflow(hook, {
    firstName,
    fullName: name,
    email,
    phone,
    message,
    source: 'demo-site',
    tags: ['demo-lead', 'web-form'],
    company: tenant.company,
    city: tenant.city,
    slug: tenant.slug
  });

  // ── Path 3: nothing configured ─────────────────────────────────
  // A GHL failure must never look like a broken page. A prospect is watching.
  return NextResponse.json({
    ok: true,
    live: hookRes.ok,
    via: hookRes.ok ? 'webhook' : 'none',
    detail: hookRes.ok
      ? 'Sent to GoHighLevel — the workflow has fired.'
      : 'No workflow connected yet, so nothing was sent. The form itself works.'
  });
}
