import { NextResponse } from 'next/server';
import { resolveTenantForApi } from '@/lib/tenants';
import { healthCheck } from '@/lib/ghl';

export const dynamic = 'force-dynamic';

/**
 * Run this before a meeting. Finding out a demo is broken while a
 * prospect watches is the single worst failure mode in this product.
 */
export async function GET(req: Request) {
  const tenant = await resolveTenantForApi(req);
  if (!tenant) return NextResponse.json({ ok: false, error: 'Unknown host' }, { status: 404 });
  return NextResponse.json({ ok: true, ...(await healthCheck(tenant)) });
}
