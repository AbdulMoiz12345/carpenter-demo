import { NextResponse } from 'next/server';
import { z } from 'zod';
import { authorised } from '@/lib/adminauth';
import { upsertTenant, listTenants, usingDatabase } from '@/lib/store';
import { isValidHex } from '@/lib/theme';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * INGEST — where the extractor and the app finally meet.
 *
 * Without this, connecting the two means copying JSON into the repo and
 * redeploying, which makes "adding a demo is a config row" untrue.
 * With it, the extractor POSTs and the URL is live in seconds.
 */

const Hex = z.string().refine(isValidHex, 'expected a hex colour like #7a4b24');

const TenantIn = z.object({
  slug: z.string().regex(/^[a-z0-9-]+$/, 'lowercase, digits and hyphens only').max(60),
  domain: z.string().min(3).max(200),
  status: z.enum(['ACTIVE', 'DISABLED']).default('ACTIVE'),
  source: z.enum(['website', 'places']).default('website'),

  company: z.string().min(1).max(200),
  short: z.string().min(1).max(24),
  headline: z.tuple([z.string().max(60), z.string().max(60)]),
  tagline: z.string().max(400).default(''),
  city: z.string().max(80).default(''),
  nearby: z.array(z.string().max(60)).max(6).default([]),
  phone: z.string().max(40).default(''),
  since: z.number().int().min(0).max(2100).default(0),
  rating: z.string().max(8).default(''),
  reviews: z.number().int().min(0).default(0),

  logo: z.union([
    z.object({ type: z.literal('wordmark') }),
    z.object({ type: z.literal('image'), url: z.string().url(), from: z.string().optional() })
  ]),
  // Validated, not merely accepted: this string is injected into a
  // stylesheet, so anything other than a hex literal is rejected.
  colors: z.object({ primary: Hex }),

  services: z.array(z.object({ name: z.string().max(80), tag: z.string().max(60).default('') })).max(8).default([]),
  work: z.array(z.object({ title: z.string().max(120), where: z.string().max(80).default('') })).max(6).default([]),

  images: z.array(z.string().url()).max(8).default([]),
  testimonials: z.array(z.object({
    quote: z.string().max(240), author: z.string().max(60).default('')
  })).max(3).default([]),
  credentials: z.array(z.string().max(40)).max(4).default([]),
  email: z.string().max(160).default(''),

  ghl: z.object({
    locationId: z.string().max(80).optional(),
    enquiryHook: z.string().url().optional(),
    bookingHook: z.string().url().optional(),
    calendarId: z.string().max(80).optional()
  }).default({}),

  meta: z.record(z.any()).default({})
});

export async function POST(req: Request) {
  if (!authorised(req)) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  if (!usingDatabase()) {
    return NextResponse.json(
      { error: 'DATABASE_URL is not set — this deployment reads bundled files and cannot accept writes.' },
      { status: 409 }
    );
  }

  const parsed = TenantIn.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid tenant', issues: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`) },
      { status: 400 }
    );
  }

  try {
    const result = await upsertTenant(parsed.data as never);
    return NextResponse.json({
      ok: true,
      result,
      slug: parsed.data.slug,
      url: `https://${parsed.data.domain}`
    });
  } catch (e) {
    console.error('[admin] upsert failed', (e as Error).message);
    return NextResponse.json({ error: 'Write failed' }, { status: 500 });
  }
}

export async function GET(req: Request) {
  if (!authorised(req)) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  const tenants = await listTenants(200);
  return NextResponse.json({
    backend: usingDatabase() ? 'postgres' : 'files',
    count: tenants.length,
    tenants: tenants.map((t) => ({
      slug: t.slug,
      domain: t.domain,
      company: t.company,
      // Surfaced because a demo with no GHL binding silently falls back
      // to seeded data, and that is worth spotting before a meeting.
      bound: Boolean(t.ghl?.locationId)
    }))
  });
}
