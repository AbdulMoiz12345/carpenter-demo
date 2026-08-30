import type { Tenant } from '@/lib/types';

export default function Work({ tenant }: { tenant: Tenant }) {
  const label = tenant.source === 'places' ? 'Google photo' : 'Site photo';
  return (
    <section className="band wrap" id="work">
      <div className="band-head">
        <h2 className="disp">Recent work</h2>
        <span className="mono">
          {tenant.source === 'places' ? 'Photos from their Google listing' : 'Photos from their site'}
        </span>
      </div>
      <div className="work-grid">
        {tenant.work.map((w) => (
          <figure className="shot" key={w.title}>
            <div className="shot-img"><span>{label}</span></div>
            <figcaption className="shot-cap">
              <b>{w.title}</b>
              <span className="mono">{w.where}</span>
            </figcaption>
          </figure>
        ))}
      </div>
    </section>
  );
}
