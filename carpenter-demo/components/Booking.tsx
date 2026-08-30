'use client';

import { useEffect, useState } from 'react';
import type { Tenant } from '@/lib/types';

type Slot = { day: string; time: string; iso: string };
type Msg = { text: string; bad?: boolean } | null;

/**
 * The two live interactions in the demo.
 *
 * Both POST to our own API routes — never to GoHighLevel directly.
 * The browser has no token, no location id and no webhook URL, so
 * there is nothing here for a prospect to find in devtools.
 */
export default function Booking({ tenant, initialSlots }: { tenant: Tenant; initialSlots: Slot[] }) {
  const [slots, setSlots] = useState<Slot[]>(initialSlots);
  const [chosen, setChosen] = useState(0);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('');
  const [website, setWebsite] = useState(''); // honeypot
  const [busy, setBusy] = useState<'' | 'enquiry' | 'booking'>('');
  const [msg, setMsg] = useState<Msg>(null);

  // Refresh availability from the server so slots are current at open.
  useEffect(() => {
    fetch('/api/slots')
      .then((r) => r.json())
      .then((d) => { if (Array.isArray(d.slots) && d.slots.length) setSlots(d.slots); })
      .catch(() => { /* keep server-rendered slots */ });
  }, []);

  async function post(url: string, body: unknown, kind: 'enquiry' | 'booking') {
    setBusy(kind);
    setMsg(null);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      const data = await res.json();
      if (!res.ok) return setMsg({ text: data.error ?? 'Something went wrong.', bad: true });
      return data;
    } catch {
      setMsg({ text: 'Could not reach the server. Try again.', bad: true });
    } finally {
      setBusy('');
    }
  }

  async function sendEnquiry() {
    if (!name.trim() || phone.trim().length < 6) {
      return setMsg({ text: 'Add your name and a mobile number.', bad: true });
    }
    const data = await post('/api/enquiry', { name, phone, email: email || undefined, message, website }, 'enquiry');
    if (!data) return;
    setMsg({
      text: data.live
        ? `Sent. ${name.split(' ')[0]} gets a text from ${tenant.short} in about ten seconds.`
        : `Form works — no workflow connected yet, so no text was sent.`
    });
  }

  async function book() {
    const slot = slots[chosen];
    if (!slot) return;
    if (!name.trim() || phone.trim().length < 6) {
      return setMsg({ text: 'Add your name and mobile, then book.', bad: true });
    }
    const data = await post('/api/booking', { name, phone, email: email || undefined, slotIso: slot.iso }, 'booking');
    if (!data) return;
    setMsg({
      text: data.live
        ? `Booked for ${data.label}. Confirmation text sent, reminder queued for the day before.`
        : `Slot held for ${slot.day} ${slot.time} — connect a workflow to send the confirmation.`
    });
  }

  return (
    <section className="band wrap" id="book">
      <div className="book">
        <div>
          <h2 className="disp">Book a site visit</h2>
          <p className="book-lede">
            Pick a slot. You&rsquo;ll get a text confirmation straight away, and a reminder the day before.
          </p>
          <span className="mono">Next available</span>
          <div className="slots">
            {slots.map((s, i) => (
              <button
                key={s.iso}
                className="slot"
                aria-pressed={i === chosen}
                onClick={() => setChosen(i)}
              >
                <em>{s.day}</em>
                <b>{s.time}</b>
              </button>
            ))}
          </div>
          <div style={{ marginTop: '1rem' }}>
            <button className="btn btn-primary" onClick={book} disabled={busy !== ''}>
              {busy === 'booking' ? 'Booking…' : 'Book this slot'}
            </button>
          </div>
        </div>

        <div className="form">
          <span className="mono">Or send the details</span>
          <div style={{ height: '1rem' }} />
          <div className="field">
            <label className="mono" htmlFor="f-name">Your name</label>
            <input id="f-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="James Whitfield" />
          </div>
          <div className="field">
            <label className="mono" htmlFor="f-phone">Phone</label>
            <input id="f-phone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="(972) 555-0142" />
          </div>
          <div className="field">
            <label className="mono" htmlFor="f-email">Email</label>
            <input id="f-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
          </div>
          <div className="field">
            <label className="mono" htmlFor="f-job">What do you need?</label>
            <textarea
              id="f-job"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder={`${tenant.services[0].name} in the front room, roughly 2.4m wide.`}
            />
          </div>
          {/* Honeypot — real people never fill this in. */}
          <div className="hp" aria-hidden="true">
            <label htmlFor="f-web">Website</label>
            <input id="f-web" tabIndex={-1} value={website} onChange={(e) => setWebsite(e.target.value)} />
          </div>
          <button className="btn btn-primary" onClick={sendEnquiry} disabled={busy !== ''}>
            {busy === 'enquiry' ? 'Sending…' : 'Send enquiry'}
          </button>
          {msg && <div className={`result${msg.bad ? ' bad' : ''}`}>{msg.text}</div>}
        </div>
      </div>
    </section>
  );
}
