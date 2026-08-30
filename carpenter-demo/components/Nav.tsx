import type { Tenant } from '@/lib/types';
import { initials } from '@/lib/theme';

export default function Nav({ tenant }: { tenant: Tenant }) {
  return (
    <nav className="nav">
      <div className="wrap nav-in">
        <a className="logo" href="#top">
          {tenant.logo.type === 'image' ? (
            <img className="logo-img" src={tenant.logo.url} alt={tenant.company} />
          ) : (
            /* Final step of the logo fallback chain. A generated
               wordmark looks deliberate; a broken <img> kills the demo. */
            <>
              <span className="logo-mark" aria-hidden="true">{initials(tenant.company)}</span>
              <span className="logo-name">{tenant.short}</span>
            </>
          )}
        </a>
        <div className="nav-links">
          <a href="#services">What we make</a>
          <a href="#work">Recent work</a>
          <a href="#book">Book a visit</a>
        </div>
        <a className="nav-cta" href="#book">Get a quote</a>
      </div>
    </nav>
  );
}
