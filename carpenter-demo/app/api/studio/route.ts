import { NextResponse } from 'next/server';
import { z } from 'zod';
import { upsertTenant, usingDatabase } from '@/lib/store';
import { isValidHex } from '@/lib/theme';
import { slugify, shortName } from '@/lib/extract';
import type { Tenant } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Build a demo from the studio panel.
 *
 * Deliberately open (no ADMIN_TOKEN) because it is operated by a human
 * on a call, not by a script. Gate it behind STUDIO_ENABLED so it can be
 * switched off the moment demos go out to real prospects — a public
 * "make me a demo" endpoint is not something to leave running.
 */
const Body = z.object({
  company: z.string().min(1).max(200),
  short: z.string().max(24).optional(),
  city: z.string().max(80).default(''),
  phone: z.string().max(40).default(''),
  email: z.string().email().max(160).optional().or(z.literal('')),
  primary: z.string().refine(isValidHex, 'hex colour like #7a4b24'),
  tagline: z.string().max(400).default(''),
  headline: z.tuple([z.string().max(60), z.string().max(60)]).optional(),
  nearby: z.array(z.string().max(60)).max(6).default([]),
  since: z.number().int().min(0).max(2100).default(0),
  services: z.array(z.object({ name: z.string().max(80), tag: z.string().max(60).default('') })).max(8).default([]),
  work: z.array(z.object({ title: z.string().max(120), where: z.string().max(80).default('') })).max(6).default([]),
  logo: z.union([
    z.object({ type: z.literal('wordmark') }),
    z.object({ type: z.literal('image'), url: z.string().url(), from: z.string().optional() })
  ]).default({ type: 'wordmark' })
});

export async function POST(req: Request) {
  if (process.env.STUDIO_ENABLED !== 'true') {
    return NextResponse.json({ error: 'Studio is disabled on this deployment.' }, { status: 403 });
  }
  if (!usingDatabase()) {
    return NextResponse.json(
      { error: 'DATABASE_URL is not set, so demos cannot be saved. Add one and redeploy.' },
      { status: 409 }
    );
  }

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') },
      { status: 400 }
    );
  }

  const d = parsed.data;
  const slug = slugify(d.company);
  const parent = process.env.DEMO_PARENT_DOMAIN ?? 'demo.localhost';
  const city = d.city;

  const tenant = {
    slug,
    domain: `${slug}.${parent}`,
    status: 'ACTIVE' as const,
    source: 'website' as const,
    company: d.company,
    short: d.short?.trim() || shortName(d.company),
    headline: (d.headline ?? [
      'Custom carpentry',
      city ? `and cabinetry in ${city}` : 'and cabinetry'
    ]) as [string, string],
    tagline: d.tagline,
    city,
    nearby: d.nearby,
    phone: d.phone,
    since: d.since,
    rating: '',
    reviews: 0,
    logo: d.logo,
    colors: { primary: d.primary },
    services: d.services.length ? d.services : [
      { name: 'Custom cabinetry', tag: '' },
      { name: 'Built-ins and closets', tag: '' },
      { name: 'Trim and finish carpentry', tag: '' },
      { name: 'Interior doors', tag: '' }
    ],
    work: d.work.length ? d.work : [
      { title: 'Custom closet build-out', where: city },
      { title: 'Kitchen cabinet install', where: city },
      { title: 'Stair railing and trim', where: city }
    ],
    // The operator's own email, so notifications from this demo land
    // somewhere they can put on screen during the call.
    ghl: d.email ? { ownerEmail: d.email } : {},
    meta: { built_by: 'studio', at: new Date().toISOString() }
  } as unknown as Tenant & { meta: unknown };

  try {
    const result = await upsertTenant(tenant);
    return NextResponse.json({ ok: true, result, slug, path: `/d/${slug}` });
  } catch (e) {
    console.error('[studio] build failed', (e as Error).message);
    return NextResponse.json({ error: 'Could not save the demo.' }, { status: 500 });
  }
}
