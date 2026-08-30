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
 * Two delivery paths, webhook first:
 *
 *   1. WEBHOOK — POST to an inbound-webhook trigger. Fires every single
 *                time, with no state and no deduplication.
 *   2. TOKEN   — create the contact via the API, tagged `web-form`.
 *                Cheaper (no premium trigger) but UNRELIABLE as a
 *                trigger: GoHighLevel does not emit a "tag added" event
 *                when a contact is CREATED with tags already attached,
 *                so a create-and-tag in one call fires nothing. It only
 *                works when the contact already existed.
 *   3. NEITHER — validate and report honestly. The page still works.
 *
 * Webhook wins because a demo that silently does nothing is far more
 * expensive than a fraction of a cent per execution.
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

  // Track why the token path failed, so the response can say so rather
  // than blaming a missing webhook. A misleading error costs more time
  // than no error at all.
  let apiFailure: string | null = null;
  const hook = tenant.ghl.enquiryHook ?? process.env.GHL_DEFAULT_ENQUIRY_HOOK;

  // ── Path 1: inbound webhook — fires reliably ─────────────────────

  if (hook) {
    const res = await fireWorkflow(hook, {
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
    if (res.ok) {
      return NextResponse.json({
        ok: true, live: true, via: 'webhook',
        detail: 'Sent to GoHighLevel — the workflow has fired.'
      });
    }
    apiFailure = `webhook ${res.reason}`;
  }

  // ── Path 2: token — creates a real contact, but see the note above
  //    about why this is not a dependable trigger ─────────────────
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
        detail:
          'Contact created and tagged. Note: GoHighLevel does not fire a ' +
          '"tag added" trigger for a contact created with tags, so set ' +
          'GHL_DEFAULT_ENQUIRY_HOOK if the workflow needs to run.'
      });
    }
    apiFailure = res.reason;
    // fall through to the webhook rather than failing outright
  }

  // ── Path 3: nothing configured ─────────────────────────────────
  // A GHL failure must never look like a broken page. A prospect is watching.
  let detail: string;
  if (apiFailure) {
    detail = `Form works, but GoHighLevel refused the write — ${apiFailure}`;
  } else if (!hasToken()) {
    detail = 'Form works — GHL_TOKEN is not set on this deployment.';
  } else if (!tenant.ghl.locationId) {
    detail = 'Form works — this demo has no GHL sub-account bound yet.';
  } else {
    detail = 'Form works — no workflow connected yet, so nothing was sent.';
  }

  return NextResponse.json({ ok: true, live: false, via: 'none', detail });
}
