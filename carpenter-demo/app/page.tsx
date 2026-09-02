import { notFound } from 'next/navigation';
import { resolveTenant } from '@/lib/tenants';
import { getLiveSlots } from '@/lib/ghl';
import { seedFor } from '@/lib/seed';
import { brandVars } from '@/lib/theme';
import { fontHref } from '@/lib/designdna';

import Nav from '@/components/Nav';
import Hero from '@/components/Hero';
import Services from '@/components/Services';
import Proof from '@/components/Proof';
import DemoBody from '@/components/DemoBody';
import DevSwitcher from '@/components/DevSwitcher';

// Rendered per request. Tenant config is read at request time, so
// adding a demo never requires a build or a deployment.
export const dynamic = 'force-dynamic';

export default async function Page({ searchParams }: { searchParams: { t?: string } }) {
  const tenant = await resolveTenant(searchParams);

  // Unknown hostname must be a branded not-found — never a default
  // tenant and never a 500. Showing someone else's demo would be a
  // cross-tenant leak.
  if (!tenant) notFound();

  const seed = seedFor(tenant);

  // Live if a token and calendar are configured, seeded otherwise.
  // Degrading one panel is always better than breaking the page.
  const live = await getLiveSlots(tenant);
  const slots = live ?? seed.fallbackSlots;

  return (
    <div style={brandVars(tenant.colors.primary) as React.CSSProperties} className="has-dev">
      <Nav tenant={tenant} />
      <Hero tenant={tenant} />
      <Services tenant={tenant} />
      <Proof tenant={tenant} />
      <DemoBody tenant={tenant} seed={seed} slots={slots} />

      <footer className="wrap foot">
        <span className="name">{tenant.company}</span>
        <span className="mono">
          {tenant.city} · {tenant.phone} ·{' '}
          {tenant.source === 'places' ? 'Google Places (no website)' : 'website scrape'} ·{' '}
          {live ? 'live slots' : 'seeded slots'}
        </span>
      </footer>

      <DevSwitcher current={tenant.slug} />
    </div>
  );
}
