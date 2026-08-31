'use client';

import { useState } from 'react';
import type { Tenant } from '@/lib/types';
import type { Seed } from '@/lib/seed';
import Booking from './Booking';
import Seam from './Seam';
import Panels from './crm/Panels';
import OwnerView, { type Submission } from './OwnerView';

type Slot = { day: string; date: string; time: string; iso: string };

/**
 * Holds the one piece of state the demo needs: what was just submitted.
 *
 * Everything above the fold is a server component — branding is injected
 * server-side so the page arrives already themed, with no flash of
 * unstyled content. Only this lower half needs interactivity, so the
 * client boundary starts here rather than at the page root.
 */
export default function DemoBody({
  tenant,
  seed,
  slots
}: {
  tenant: Tenant;
  seed: Seed;
  slots: Slot[];
}) {
  const [submission, setSubmission] = useState<Submission | null>(null);
  const [view, setView] = useState<'behind' | 'owner'>('behind');

  function onSubmitted(s: Submission) {
    setSubmission(s);
    // Move them to the owner side automatically: they have just acted as
    // the customer, so the interesting half is now the other one.
    setView('owner');
    // Scroll it into sight rather than leaving them wondering where it went.
    requestAnimationFrame(() => {
      document.getElementById('behind')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }

  return (
    <>
      <Booking tenant={tenant} initialSlots={slots} onSubmitted={onSubmitted} />

      <Seam tenant={tenant} />

      <section className="crm" id="behind">
        <div className="wrap">
          <div className="switch" role="tablist" aria-label="Which side to view">
            <button
              role="tab"
              aria-selected={view === 'behind'}
              onClick={() => setView('behind')}
            >
              What runs behind it
            </button>
            <button
              role="tab"
              aria-selected={view === 'owner'}
              onClick={() => setView('owner')}
            >
              What {tenant.short} receives
              {submission && <i className="dot" aria-hidden="true" />}
            </button>
          </div>
        </div>

        {view === 'behind' ? (
          <Panels tenant={tenant} seed={seed} submission={submission} />
        ) : (
          <div className="wrap">
            <OwnerView tenant={tenant} submission={submission} />
          </div>
        )}
      </section>
    </>
  );
}
