import type { Tenant } from '@/lib/types';

/**
 * The gear change from public site to CRM. This section is the
 * answer to "can we bring both of those elements together?" —
 * one page, two halves, an explicit seam between them.
 */
export default function Seam({ tenant }: { tenant: Tenant }) {
  return (
    <section className="seam">
      <div className="wrap">
        <span className="mono">Below the surface</span>
        <h2>
          The half your<br />customer never sees
        </h2>
        <p>
          Everything above is the shop window. This is what runs behind it — the part that
          answers the phone when {tenant.short} is halfway through a cut.
        </p>
      </div>
    </section>
  );
}
