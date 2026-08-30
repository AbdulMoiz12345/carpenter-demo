import { NextResponse } from 'next/server';
import { z } from 'zod';
import { extractFromUrl } from '@/lib/extract';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Live extraction for the studio panel.
 *
 * Returns a DRAFT — nothing is saved. The operator reviews and edits
 * before building, which matters on a call: extraction is good, not
 * perfect, and a wrong service name is better caught before the demo
 * exists than after.
 */
export async function POST(req: Request) {
  const Body = z.object({ url: z.string().min(4).max(300) });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Give a website address.' }, { status: 400 });

  try {
    const draft = await extractFromUrl(parsed.data.url);
    return NextResponse.json({ ok: true, draft });
  } catch (e) {
    // Never a hard failure: the operator falls back to manual entry and
    // the call keeps moving.
    return NextResponse.json(
      { error: `Could not read that site (${(e as Error).message}). Use manual entry instead.` },
      { status: 200 }
    );
  }
}
