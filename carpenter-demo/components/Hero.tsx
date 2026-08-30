import type { Tenant } from '@/lib/types';

export default function Hero({ tenant }: { tenant: Tenant }) {
  // Only show a cell when there is something in it. An empty
  // "Google rating" reads as broken, exactly like an empty photo slot.
  const facts: [string, string | number][] = [
    ...(tenant.since ? ([['Working since', tenant.since]] as [string, string | number][]) : []),
    ...(tenant.rating ? ([['Google rating', `${tenant.rating} ★`]] as [string, string | number][]) : []),
    ...(tenant.reviews ? ([['Reviews', tenant.reviews]] as [string, string | number][]) : []),
    ...(tenant.city ? ([['Covering', tenant.city]] as [string, string | number][]) : []),
    ...(tenant.services?.length
      ? ([['Services', tenant.services.length]] as [string, string | number][])
      : [])
  ].slice(0, 4);
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
      {facts.length > 0 && (
      <div className="spec">
        {facts.map(([k, v]) => (
          <div key={k}>
            <span className="mono">{k}</span>
            <b>{v}</b>
          </div>
        ))}
      </div>
      )}

      {/* Trust facts lifted verbatim from their own site. Renders only
          when extraction actually found some — no invented badges. */}
      {tenant.credentials?.length > 0 && (
        <div className="creds">
          {tenant.credentials.map((c) => (
            <span key={c}>{c}</span>
          ))}
        </div>
      )}
    </header>
  );
}
