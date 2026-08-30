import type { Tenant } from '@/lib/types';

export default function Hero({ tenant }: { tenant: Tenant }) {
  const facts: [string, string | number][] = [
    ['Working since', tenant.since],
    ['Google rating', `${tenant.rating} ★`],
    ['Reviews', tenant.reviews],
    ['Covering', tenant.city]
  ];
  return (
    <header className="hero wrap" id="top">
      <div className="hero-rule" />
      <h1 className="disp">
        {tenant.headline[0]}
        <em>{tenant.headline[1]}</em>
      </h1>
      <p className="hero-sub">{tenant.tagline}</p>
      <div className="hero-acts">
        <a className="btn btn-primary" href="#book">Book a site visit</a>
        <a className="btn btn-ghost" href={`tel:${tenant.phone.replace(/\s/g, '')}`}>{tenant.phone}</a>
      </div>
      <div className="spec">
        {facts.map(([k, v]) => (
          <div key={k}>
            <span className="mono">{k}</span>
            <b>{v}</b>
          </div>
        ))}
      </div>
    </header>
  );
}
