'use client';

import { useState } from 'react';
import type { Tenant } from '@/lib/types';

export interface Submission {
  name: string;
  email: string;
  phone: string;
  message: string;
  slotLabel?: string;
  at: string;
  via: string;
}

/**
 * THE OWNER VIEW
 *
 * The demo asks a prospect to be two people: the business owner looking
 * at their new site, and their own customer filling in the form. That
 * switch is never signposted anywhere, which is confusing in the ten
 * seconds where you are trying to impress them.
 *
 * So this panel makes it explicit. One action, two sides, shown side by
 * side: what the customer receives, and what lands with the business.
 *
 * It renders the ACTUAL submission rather than a mock-up, which is the
 * whole point — they filled it in, so these are their words.
 */
export default function OwnerView({
  tenant,
  submission
}: {
  tenant: Tenant;
  submission: Submission | null;
}) {
  const [state, setState] = useState<'idle' | 'sending' | 'done' | 'failed'>('idle');
  const [result, setResult] = useState('');

  async function accept() {
    if (!submission) return;
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
      setResult(d.detail ?? 'Done.');
      setState(d.live ? 'done' : 'failed');
    } catch {
      setResult('Could not reach the server.');
      setState('failed');
    }
  }
  if (!submission) {
    return (
      <div className="owner-empty">
        <span className="mono">Nothing yet</span>
        <p>
          Fill in the enquiry form above as one of {tenant.short}&rsquo;s customers would.
          Both sides of what happens next will appear here.
        </p>
      </div>
    );
  }

  const first = submission.name.split(' ')[0] || 'there';

  return (
    <div className="owner">
      <div className="owner-head">
        <span className="mono">One form submission · two sides</span>
        <span className="mono owner-live">
          {submission.via === 'webhook' ? 'Live in GoHighLevel' : 'Recorded'}
        </span>
      </div>

      <div className="owner-grid">
        {/* ── what the customer gets ── */}
        <article className="mail">
          <header>
            <span className="mono">Their customer receives</span>
            <b>{submission.email || 'no email given'}</b>
          </header>
          <div className="mail-body">
            <div className="mail-subject">Thanks for getting in touch</div>
            <p>Hi {first},</p>
            <p>Thanks for your enquiry — we&rsquo;ve got your details.</p>
            {submission.slotLabel ? (
              <p>
                We&rsquo;ve got your request for <strong>{submission.slotLabel}</strong> and will
                confirm within the hour.
              </p>
            ) : (
              <p>
                We&rsquo;re on site most of the day, but we&rsquo;ll call you back this afternoon. If
                it&rsquo;s easier, book a free estimate visit at a time that suits you.
              </p>
            )}
            <p className="mail-sig">
              {tenant.company}
              {tenant.phone ? <><br />{tenant.phone}</> : null}
            </p>
          </div>
          <footer className="mono">Sent automatically · {submission.at}</footer>
        </article>

        {/* ── what the owner gets ── */}
        <article className="mail mail-internal">
          <header>
            <span className="mono">{tenant.short} receives</span>
            <b>New enquiry alert</b>
          </header>
          <div className="mail-body">
            <div className="mail-subject">Form submitted — {first}</div>
            <dl className="kv">
              <dt className="mono">Name</dt>
              <dd>{submission.name}</dd>
              <dt className="mono">Phone</dt>
              <dd>{submission.phone || '—'}</dd>
              <dt className="mono">Email</dt>
              <dd>{submission.email || '—'}</dd>
              {submission.message && (
                <>
                  <dt className="mono">Wants</dt>
                  <dd>{submission.message}</dd>
                </>
              )}
              {submission.slotLabel && (
                <>
                  <dt className="mono">Booked</dt>
                  <dd>{submission.slotLabel}</dd>
                </>
              )}
            </dl>
          </div>
          <footer className="mono">
            Added to Quotes → Enquiry · tagged web-form
          </footer>
        </article>
      </div>

      {/* The accept step. A real owner would click this in their
          notification email; here it sits on the page so the prospect
          can play both parts without juggling two inboxes. */}
      {submission.slotLabel && (
        <div className="accept">
          {state === 'done' ? (
            <>
              <span className="mono">Confirmed</span>
              <p>
                {result} {submission.name.split(' ')[0]} now has the confirmation for{' '}
                <strong>{submission.slotLabel}</strong>, and a reminder is queued for the day
                before. Check your inbox — that one is real.
              </p>
            </>
          ) : (
            <>
              <span className="mono">Waiting on {tenant.short}</span>
              <p>
                The visit is requested, not confirmed. Nothing goes back to the customer until
                the business says yes — which is how a carpenter actually works, because he has
                to know he can get there.
              </p>
              <button className="btn btn-primary" onClick={accept} disabled={state === 'sending'}>
                {state === 'sending' ? 'Confirming…' : 'Accept this visit'}
              </button>
              {state === 'failed' && <div className="result bad">{result}</div>}
            </>
          )}
        </div>
      )}

      <p className="owner-note">
        Neither of those was written by hand. The customer got a reply in seconds and{' '}
        {tenant.short} got the details without touching a phone.
      </p>
    </div>
  );
}
