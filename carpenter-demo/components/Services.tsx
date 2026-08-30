import type { Tenant } from '@/lib/types';

export default function Services({ tenant }: { tenant: Tenant }) {
  return (
    <section className="band wrap" id="services">
      <div className="band-head">
        <h2 className="disp">What we make</h2>
        <span className="mono">{tenant.services.length} services</span>
      </div>
      <div className="srv">
        {tenant.services.map((s) => (
          <a className="srv-row" href="#book" key={s.name}>
            <span className="srv-name">{s.name}</span>
            <span className="mono srv-tag">{s.tag}</span>
            <span className="srv-arrow" aria-hidden="true">→</span>
          </a>
        ))}
      </div>
    </section>
  );
}
