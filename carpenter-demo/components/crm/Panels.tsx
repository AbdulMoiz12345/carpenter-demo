'use client';

import type { Tenant } from '@/lib/types';
import type { Seed } from '@/lib/seed';
import type { Submission } from '../OwnerView';

/**
 * The CRM half. Seeded, not live — an empty dashboard destroys the
 * pitch, and a brand new sub-account has no history by definition.
 *
 * Each panel note is written as plain English rather than a feature
 * label. "You missed this call at 2:14pm. They got a text at 2:14pm."
 * is a pitch; "Automated SMS Workflow" is a screenshot.
 */
export default function Panels({
  tenant,
  seed,
  submission
}: {
  tenant: Tenant;
  seed: Seed;
  submission?: Submission | null;
}) {
  return (
    <>
      <div className="wrap">
        <div className="kpis">
          {seed.kpis.map((k) => (
            <div className="kpi" key={k.label}>
              <span className="mono">{k.label}</span>
              <b>{k.value}</b>
              <i>{k.unit}</i>
            </div>
          ))}
        </div>

        <div className="panels">
          <div className="panel">
            <h3>Missed call, handled</h3>
            <p className="note">You were holding a saw. Nobody had to do anything.</p>
            <ol className="seq">
              {seed.sequence.map((s, i) => (
                <li key={i}>
                  <span className="n">{String(i + 1).padStart(2, '0')}</span>
                  <span>
                    <span className="t">{s.t}</span>
                    <span className="l">{s.l}</span>
                  </span>
                </li>
              ))}
            </ol>
            {/* Signature element: a dimension line from a joiner's
                drawing, marking the gap between losing a customer
                and catching them. */}
            <div className="dim">
              <span className="bar" />
              <span>{seed.dimLabel} from missed to answered</span>
            </div>
          </div>

          <div className="panel">
            <h3>What they got back</h3>
            <p className="note">The reply that came in four minutes later.</p>
            <div className="sms">
              {seed.sms.map((m, i) => (
                <div className={`bub ${m.side}`} key={i}>
                  <span className="mono">{m.t}</span>
                  {m.text}
                </div>
              ))}
            </div>
          </div>

          <div className="panel">
            <h3>Every quote, where it stands</h3>
            <p className="note">No notebook. No &ldquo;did I chase that one?&rdquo;</p>
            <div className="pipe">
              {/* Their own submission, at the top, marked as live. Watching
                  your own enquiry appear is more persuasive than any
                  amount of seeded history. */}
              {submission && (
                <div className="stage live stage-new">
                  <span className="mono">Enquiry</span>
                  <span className="who">
                    {submission.name} — {submission.message || 'new enquiry'}
                  </span>
                  <span className="val">just now</span>
                </div>
              )}
              {seed.pipeline.map((p) => (
                <div className={`stage${p.live ? ' live' : ''}`} key={p.stage}>
                  <span className="mono">{p.stage}</span>
                  <span className="who">{p.who}</span>
                  <span className="val">{p.val}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="panel">
            <h3>This week on site</h3>
            <p className="note">Reminders sent automatically the day before.</p>
            <div className="jobs">
              {seed.jobs.map((j, i) => (
                <div className="job" key={i}>
                  <span className="d">{j.d}</span>
                  <span className="w">{j.w}</span>
                  <span className="p">{j.p}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
