import type { Tenant } from '@/lib/types';

/**
 * PROOF
 *
 * Replaces the old fixed photo grid. Three empty grey boxes was the
 * weakest thing on the page — worse than having no section at all,
 * because it reads as broken rather than sparse.
 *
 * So the band adapts to what extraction actually found:
 *
 *   3+ photos  → full grid
 *   1-2 photos → feature layout beside the reviews
 *   0 photos   → reviews carry the section on their own
 *   nothing    → the section does not render
 *
 * Their own photography is the strongest signal the page was built for
 * them, so it leads whenever it exists.
 */
export default function Proof({ tenant }: { tenant: Tenant }) {
  const photos = tenant.images ?? [];
  const quotes = tenant.testimonials ?? [];

  if (!photos.length && !quotes.length) return null;

  const captions = tenant.work?.length
    ? tenant.work
    : photos.map(() => ({ title: '', where: tenant.city }));

  return (
    <section className="band wrap" id="work">
      <div className="band-head">
        <h2 className="disp">{photos.length ? 'Recent work' : 'What customers say'}</h2>
        {photos.length > 0 && (
          <span className="mono">{photos.length} project{photos.length === 1 ? '' : 's'}</span>
        )}
      </div>

      {photos.length >= 3 && (
        <div className="shots">
          {photos.slice(0, 6).map((src, i) => (
            <figure className="shot" key={src}>
              {/* Their image, served from their own domain. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={src} alt={captions[i]?.title || `${tenant.company} project`} loading="lazy" />
              {captions[i]?.title && (
                <figcaption>
                  <b>{captions[i].title}</b>
                  {captions[i].where && <span className="mono">{captions[i].where}</span>}
                </figcaption>
              )}
            </figure>
          ))}
        </div>
      )}

      {photos.length > 0 && photos.length < 3 && (
        <div className="proof-split">
          <div className="shots shots-few">
            {photos.map((src) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img key={src} className="shot-solo" src={src} alt={`${tenant.company} project`} loading="lazy" />
            ))}
          </div>
          {quotes.length > 0 && <Quotes quotes={quotes} />}
        </div>
      )}

      {photos.length === 0 && quotes.length > 0 && <Quotes quotes={quotes} wide />}

      {photos.length >= 3 && quotes.length > 0 && (
        <div style={{ marginTop: 'clamp(2rem,4vw,3rem)' }}>
          <span className="mono">What customers say</span>
          <Quotes quotes={quotes} wide />
        </div>
      )}
    </section>
  );
}

function Quotes({ quotes, wide }: { quotes: Tenant['testimonials']; wide?: boolean }) {
  return (
    <div className={wide ? 'quotes quotes-wide' : 'quotes'}>
      {quotes.map((q, i) => (
        <blockquote className="quote" key={i}>
          <p>{q.quote}</p>
          {q.author && <cite className="mono">{q.author}</cite>}
        </blockquote>
      ))}
    </div>
  );
}
