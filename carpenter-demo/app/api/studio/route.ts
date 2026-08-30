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
/**
 * Cosmetic fields are CLAMPED, never rejected.
 *
 * A demo being blocked because a headline came back 63 characters long
 * is a terrible outcome — especially live on a call. Length is a layout
 * concern, so trim it at a word boundary and carry on. Only genuinely
 * unsafe values (a malformed hex colour going into a stylesheet) are
 * still hard failures.
 */
const clamp = (max: number) =>
  z.string().transform((v) => {
    const t = v.trim();
    if (t.length <= max) return t;
    const cut = t.slice(0, max);
    const lastSpace = cut.lastIndexOf(' ');
    return (lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).trim();
  });

const Body = z.object({
  company: clamp(200).refine((v) => v.length > 0, 'Business name is required'),
  short: clamp(24).optional(),
  city: clamp(80).default(''),
  phone: clamp(40).default(''),
  email: z.string().email().max(160).optional().or(z.literal('')),
  primary: z.string().refine(isValidHex, 'hex colour like #7a4b24'),
  tagline: clamp(400).default(''),
  headline: z.tuple([clamp(60), clamp(60)]).optional(),
  nearby: z.array(clamp(60)).max(6).default([]),
  since: z.number().int().min(0).max(2100).default(0),
  services: z.array(z.object({ name: clamp(80), tag: clamp(60).default('') })).max(8).default([]),
  work: z.array(z.object({ title: clamp(120), where: clamp(80).default('') })).max(6).default([]),
  images: z.array(z.string().url()).max(8).default([]),
  testimonials: z.array(z.object({ quote: clamp(240), author: clamp(60).default('') })).max(3).default([]),
  credentials: z.array(clamp(40)).max(4).default([]),
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
    images: d.images,
    testimonials: d.testimonials,
    credentials: d.credentials,
    email: '',
    // Never written here. Bindings are attached separately via
    // /api/admin/bind, and this route must not touch them — writing a
    // partial object here is what used to clear locationId on rebuild.
    ghl: {},
    meta: {
      built_by: 'studio',
      at: new Date().toISOString(),
      // Kept as provenance only. Nothing reads it: notifications are
      // addressed inside the GoHighLevel workflow, not from here.
      operator_email: d.email || undefined
    }
  } as unknown as Tenant & { meta: unknown };

  try {
    const result = await upsertTenant(tenant);
    return NextResponse.json({ ok: true, result, slug, path: `/d/${slug}` });
  } catch (e) {
    console.error('[studio] build failed', (e as Error).message);
    return NextResponse.json({ error: 'Could not save the demo.' }, { status: 500 });
  }
}
