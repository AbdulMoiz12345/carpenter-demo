import { notFound } from 'next/navigation';
import { getBySlug } from '@/lib/store';
import { getLiveSlots } from '@/lib/ghl';
import { seedFor } from '@/lib/seed';
import { brandVars } from '@/lib/theme';

import Nav from '@/components/Nav';
import Hero from '@/components/Hero';
import Services from '@/components/Services';
import Work from '@/components/Work';
import Booking from '@/components/Booking';
import Seam from '@/components/Seam';
import Panels from '@/components/crm/Panels';

export const dynamic = 'force-dynamic';

/**
 * Path-based demo view: /d/oakline-carpentry
 *
 * Same components as the hostname-resolved page. This exists so a demo
 * can be shown on a video call without waiting on wildcard DNS — useful
 * before the domain is delegated, and useful afterwards for internal
 * review. Prospects still get the subdomain.
 */
export default async function DemoBySlug({ params }: { params: { slug: string } }) {
  const tenant = await getBySlug(params.slug);
  if (!tenant) notFound();

  const seed = seedFor(tenant);
  const live = await getLiveSlots(tenant);
  const slots = live ?? seed.fallbackSlots;

  return (
    <div style={brandVars(tenant.colors.primary) as React.CSSProperties}>
      <Nav tenant={tenant} />
      <Hero tenant={tenant} />
      <Services tenant={tenant} />
      <Work tenant={tenant} />
      <Booking tenant={tenant} initialSlots={slots} />
      <Seam tenant={tenant} />
      <Panels tenant={tenant} seed={seed} />
      <footer className="wrap foot">
        <span className="name">{tenant.company}</span>
        <span className="mono">
          {tenant.city} · {tenant.phone} · {live ? 'live slots' : 'seeded slots'}
        </span>
      </footer>
    </div>
  );
}
