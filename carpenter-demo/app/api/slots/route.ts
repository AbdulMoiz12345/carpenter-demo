import { NextResponse } from 'next/server';
import { resolveTenant } from '@/lib/tenants';
import { getLiveSlots } from '@/lib/ghl';
import { seedFor } from '@/lib/seed';

export const dynamic = 'force-dynamic';

/**
 * Availability. Live from GHL when a token and calendar are set,
 * seeded otherwise. The response says which, so QA can tell the
 * difference and nobody demos seeded slots believing they're real.
 */
export async function GET() {
  const tenant = await resolveTenant();
  if (!tenant) return NextResponse.json({ error: 'Unknown demo.' }, { status: 404 });

  const live = await getLiveSlots(tenant);
  if (live) return NextResponse.json({ source: 'ghl', slots: live });

  return NextResponse.json({ source: 'seeded', slots: seedFor(tenant).fallbackSlots });
}
