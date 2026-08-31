'use client';

import { useEffect, useState } from 'react';
import type { Tenant } from '@/lib/types';
import type { Submission } from './OwnerView';

/**
 * WHAT JUST HAPPENED
 *
 * The prospect has acted as their own customer. This is where the demo
 * pays off, so it is staged rather than dumped: the two sides fade up in
 * sequence, then the chain of events, then the accept step.
 *
 * The sequencing matters. Showing everything at once reads as a wall of
 * text; revealing it in order lets them follow one thread — request,
 * customer told, business told, waiting on you.
 *
 * Everything shown is their real submission, and the emails referenced
 * were really sent. Nothing here is mocked.
 */
export default function BookedModal({
  tenant,
  submission,
  onClose
}: {
  tenant: Tenant;
  submission: Submission;
  onClose: () => void;
}) {
  const [state, setState] = useState<'idle' | 'sending' | 'done' | 'failed'>('idle');
  const [detail, setDetail] = useState('');
  const first = submission.name.split(' ')[0] || 'they';

  // Escape closes; body scroll locks while open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  async function accept() {
    setState('sending');
    try {
      const q = window.location.pathname.startsWith('/d/')
        ? `?d=${encodeURIComponent(tenant.slug)}`
        : '';
      const r = await fetch(`/api/accept${q}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: submission.name,
          email: submission.email,
          phone: submission.phone,
          slotLabel: submission.slotLabel
        })
      });
      const d = await r.json();
      setDetail(d.detail ?? d.error ?? '');
      setState(d.live ? 'done' : 'failed');
    } catch {
      setDetail('Could not reach the server.');
      setState('failed');
    }
  }

  const steps = [
    { t: 'now', l: `Visit requested for ${submission.slotLabel}`, d: 0 },
    { t: '2 sec', l: `${first} emailed — request received, we'll confirm shortly`, d: 1 },
    { t: '2 sec', l: `${tenant.short} alerted with the details and a one-click accept`, d: 2 },
    { t: 'pending', l: 'Nothing else goes out until the business says yes', d: 3 }
  ];

  return (
    <div className="ov" role="dialog" aria-modal="true" aria-label="What just happened">
      <div className="ov-scrim" onClick={onClose} />

      <div className="ov-panel">
        <button className="ov-x" onClick={onClose} aria-label="Close">&times;</button>

        <header className="ov-head anim" style={{ '--i': 0 } as React.CSSProperties}>
          <span className="mono">Request sent</span>
          <h2>One booking,<br />two sides</h2>
          <p>
            You just acted as one of {tenant.short}&rsquo;s customers. Here is everything that
            happened, and everything they didn&rsquo;t have to do.
          </p>
        </header>

        <div className="ov-grid">
          <article className="mail anim" style={{ '--i': 1 } as React.CSSProperties}>
            <header>
              <span className="mono">Your customer receives</span>
              <b>{submission.email || 'no email given'}</b>
            </header>
            <div className="mail-body">
              <div className="mail-subject">Request received &mdash; {submission.slotLabel}</div>
              <p>Hi {first},</p>
              <p>
                Thanks &mdash; we&rsquo;ve got your request for{' '}
                <strong>{submission.slotLabel}</strong>.
              </p>
              <p>We&rsquo;ll confirm within the hour. You&rsquo;ll get an email the moment it&rsquo;s locked in.</p>
              <p className="mail-sig">
                {tenant.company}
                {tenant.phone ? (
                  <>
                    <br />
                    {tenant.phone}
                  </>
                ) : null}
              </p>
            </div>
            <footer className="mono">
              {submission.via === 'webhook' ? 'Sent automatically' : 'Queued'} &middot; {submission.at}
            </footer>
          </article>

          <article className="mail mail-internal anim" style={{ '--i': 2 } as React.CSSProperties}>
            <header>
              <span className="mono">{tenant.short} receives</span>
              <b>Site visit requested</b>
            </header>
            <div className="mail-body">
              <div className="mail-subject">Site visit requested &mdash; {first}</div>
              <dl className="kv">
                <dt className="mono">Name</dt>
                <dd>{submission.name}</dd>
                <dt className="mono">Phone</dt>
                <dd>{submission.phone || '\u2014'}</dd>
                <dt className="mono">Email</dt>
                <dd>{submission.email || '\u2014'}</dd>
                {submission.message && (
                  <>
                    <dt className="mono">Wants</dt>
                    <dd>{submission.message}</dd>
                  </>
                )}
                <dt className="mono">Asked for</dt>
                <dd>{submission.slotLabel}</dd>
              </dl>
            </div>
            <footer className="mono">Quotes &rarr; Site visit booked &middot; tagged site-visit-requested</footer>
          </article>
        </div>

        <ol className="ov-steps">
          {steps.map((s) => (
            <li key={s.l} className="anim" style={{ '--i': 3 + s.d } as React.CSSProperties}>
              <span className="mono">{s.t}</span>
              <span>{s.l}</span>
            </li>
          ))}
        </ol>

        {state === 'done' ? (
          <div className="ov-accept ov-done anim" style={{ '--i': 7 } as React.CSSProperties}>
            <span className="mono">Confirmed</span>
            <h3>{first} has the confirmation</h3>
            <p>
              {detail} A reminder is queued for the day before, and the appointment is now
              confirmed on the calendar.
            </p>
            <p className="ov-real">
              Check <strong>{submission.email}</strong> &mdash; that email is real.
            </p>
            <button className="btn btn-ghost-light" onClick={onClose}>
              Back to the site
            </button>
          </div>
        ) : (
          <div className="ov-accept anim" style={{ '--i': 7 } as React.CSSProperties}>
            <span className="mono">Waiting on {tenant.short}</span>
            <h3>Your turn</h3>
            <p>
              Now you&rsquo;re the business. The visit is requested, not confirmed &mdash; because a
              carpenter has to know he can actually get there. Accept it and watch what the
              customer gets.
            </p>
            <button className="btn btn-primary" onClick={accept} disabled={state === 'sending'}>
              {state === 'sending' ? 'Confirming\u2026' : 'Accept this visit'}
            </button>
            {state === 'failed' && <div className="result bad">{detail}</div>}
          </div>
        )}
      </div>
    </div>
  );
}
