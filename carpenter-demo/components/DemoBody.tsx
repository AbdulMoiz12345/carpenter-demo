'use client';

import { useState } from 'react';
import type { Tenant } from '@/lib/types';
import type { Seed } from '@/lib/seed';
import Booking, { type Slot } from './Booking';
import Seam from './Seam';
import Panels from './crm/Panels';
import BookedModal from './BookedModal';
import type { Submission } from './OwnerView';

/**
 * Holds the one piece of state the demo needs: what was just booked.
 *
 * Everything above the fold stays a server component, so branding is
 * injected server-side and the page arrives already themed with no flash
 * of unstyled content. The client boundary starts here.
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
  const [open, setOpen] = useState(false);

  return (
    <>
      <Booking
        tenant={tenant}
        initialSlots={slots}
        onBooked={(s) => {
          setSubmission(s);
          setOpen(true);
        }}
      />

      <Seam tenant={tenant} />
      <section className="crm" id="behind">
        <Panels tenant={tenant} seed={seed} submission={submission} />
      </section>

      {open && submission && (
        <BookedModal tenant={tenant} submission={submission} onClose={() => setOpen(false)} />
      )}
    </>
  );
}
