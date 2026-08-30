import { NextResponse } from 'next/server';
import { z } from 'zod';
import { authorised } from '@/lib/adminauth';
import { setGhlBinding, usingDatabase } from '@/lib/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Attach a GoHighLevel sub-account to an existing tenant.
 *
 * Separate from ingest on purpose. Extraction happens in bulk and
 * automatically; binding happens per prospect and often later — when a
 * cold demo is promoted to a warm one and gets its own sub-account.
 * Re-extracting must never wipe a binding, which is why upsertTenant
 * preserves `ghl` on conflict.
 */
const Body = z.object({
  slug: z.string().regex(/^[a-z0-9-]+$/).max(60),
  locationId: z.string().max(80).optional(),
  enquiryHook: z.string().url().optional(),
  bookingHook: z.string().url().optional(),
  calendarId: z.string().max(80).optional()
});

export async function POST(req: Request) {
  if (!authorised(req)) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  if (!usingDatabase()) return NextResponse.json({ error: 'DATABASE_URL is not set' }, { status: 409 });

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Invalid body' }, { status: 400 });

  const { slug, ...ghl } = parsed.data;
  const clean = Object.fromEntries(Object.entries(ghl).filter(([, v]) => v !== undefined));
  if (!Object.keys(clean).length) {
    return NextResponse.json({ error: 'Nothing to bind' }, { status: 400 });
  }

  const found = await setGhlBinding(slug, clean);
  return found
    ? NextResponse.json({ ok: true, slug, bound: Object.keys(clean) })
    : NextResponse.json({ error: 'No such tenant' }, { status: 404 });
}
