'use client';

import { useEffect, useMemo, useState } from 'react';
import type { Tenant } from '@/lib/types';
import type { Submission } from './OwnerView';

export type Slot = { iso: string; day: string; date: string; dayKey: string; time: string };

/**
 * BOOKING
 *
 * Pick a day, then a time — rather than a flat grid of six slots that all
 * landed on one afternoon and made the business look like it had no
 * availability at all.
 *
 * The separate enquiry form is gone. Two competing calls to action split
 * attention, and the booking is the one that demonstrates something: it
 * puts a real appointment in a real calendar and starts a real approval
 * flow.
 */
export default function Booking({
  tenant,
  initialSlots,
  onBooked
}: {
  tenant: Tenant;
  initialSlots: Slot[];
  onBooked?: (s: Submission) => void;
}) {
  const [slots, setSlots] = useState<Slot[]>(initialSlots);
  const [dayKey, setDayKey] = useState(initialSlots[0]?.dayKey ?? '');
  const [chosen, setChosen] = useState(initialSlots[0]?.iso ?? '');

  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [note, setNote] = useState('');
  const [honey, setHoney] = useState('');

  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  // Refresh from the server so availability is current at open.
  useEffect(() => {
    const q = window.location.pathname.startsWith('/d/')
      ? `?d=${encodeURIComponent(tenant.slug)}`
      : '';
    fetch(`/api/slots${q}`)
      .then((r) => r.json())
      .then((d) => {
        if (Array.isArray(d.slots) && d.slots.length) {
          setSlots(d.slots);
          setDayKey(d.slots[0].dayKey);
          setChosen(d.slots[0].iso);
        }
      })
      .catch(() => {
        /* keep the server-rendered slots */
      });
  }, [tenant.slug]);

  const days = useMemo(() => {
    const seen = new Map<string, Slot>();
    for (const s of slots) if (!seen.has(s.dayKey)) seen.set(s.dayKey, s);
    return [...seen.values()];
  }, [slots]);

  const times = useMemo(() => slots.filter((s) => s.dayKey === dayKey), [slots, dayKey]);
  const active = slots.find((s) => s.iso === chosen);

  async function book() {
    if (!name.trim()) return setErr('Add your name.');
    if (phone.trim().length < 6) return setErr('Add a phone number.');
    if (!chosen) return setErr('Pick a time.');

    setBusy(true);
    setErr('');
    try {
      const q = window.location.pathname.startsWith('/d/')
        ? `?d=${encodeURIComponent(tenant.slug)}`
        : '';
      const res = await fetch(`/api/booking${q}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          phone,
          email: email || undefined,
          slotIso: chosen,
          website: honey || undefined
        })
      });
      const data = await res.json();
      if (!res.ok) return setErr(data.error ?? `Request failed (${res.status}).`);

      onBooked?.({
        name,
        email,
        phone,
        message: note,
        slotLabel: data.label ?? `${active?.day} ${active?.date} at ${active?.time}`,
        at: new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
        via: data.via
      });
    } catch {
      setErr('Could not reach the server. Try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="band wrap" id="book">
      <div className="band-head">
        <h2 className="disp">Book a free estimate</h2>
        <span className="mono">
          {days.length} day{days.length === 1 ? '' : 's'} available
        </span>
      </div>

      <div className="bk">
        <div className="bk-cal">
          <span className="mono">Choose a day</span>
          <div className="bk-days">
            {days.map((d) => (
              <button
                key={d.dayKey}
                className="bk-day"
                aria-pressed={d.dayKey === dayKey}
                onClick={() => {
                  setDayKey(d.dayKey);
                  const first = slots.find((s) => s.dayKey === d.dayKey);
                  if (first) setChosen(first.iso);
                }}
              >
                <em>{d.day}</em>
                <b>{d.date.split(' ')[1]}</b>
                <u>{d.date.split(' ')[0]}</u>
              </button>
            ))}
          </div>

          <span className="mono bk-label2">Choose a time</span>
          <div className="bk-times">
            {times.map((s) => (
              <button
                key={s.iso}
                className="bk-time"
                aria-pressed={s.iso === chosen}
                onClick={() => setChosen(s.iso)}
              >
                {s.time}
              </button>
            ))}
          </div>

          <p className="bk-note">
            Visits take about 45 minutes. Nothing is confirmed until {tenant.short} accepts —
            you&rsquo;ll hear either way.
          </p>
        </div>

        <div className="bk-form">
          {active && (
            <div className="bk-chosen">
              <span className="mono">You&rsquo;re requesting</span>
              <b>
                {active.day} {active.date}
              </b>
              <i>{active.time}</i>
            </div>
          )}

          <div className="field">
            <label className="mono" htmlFor="b-name">Your name</label>
            <input id="b-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="James Whitfield" />
          </div>
          <div className="field">
            <label className="mono" htmlFor="b-phone">Phone</label>
            <input id="b-phone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="(972) 555-0142" />
          </div>
          <div className="field">
            <label className="mono" htmlFor="b-email">Email</label>
            <input id="b-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
          </div>
          <div className="field">
            <label className="mono" htmlFor="b-note">
              What do you need? <span className="opt">optional</span>
            </label>
            <textarea
              id="b-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={`${tenant.services[0]?.name ?? 'Custom cabinetry'} — roughly 8 feet wide.`}
            />
          </div>

          {/* Honeypot — real people never fill this in. */}
          <div className="hp" aria-hidden="true">
            <label htmlFor="b-web">Website</label>
            <input id="b-web" tabIndex={-1} value={honey} onChange={(e) => setHoney(e.target.value)} />
          </div>

          <button className="btn btn-primary bk-go" onClick={book} disabled={busy}>
            {busy ? 'Requesting\u2026' : 'Request this visit'}
          </button>
          {err && <div className="result bad">{err}</div>}
        </div>
      </div>
    </section>
  );
}
