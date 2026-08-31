'use client';

import { useState } from 'react';

type Service = { name: string; tag: string };
type Logo = { type: 'wordmark' } | { type: 'image'; url: string; from?: string };

interface Draft {
  company: string; short: string; headline: [string, string]; tagline: string;
  city: string; nearby: string[]; phone: string; since: number;
  logo: Logo; colors: { primary: string };
  services: Service[]; work: { title: string; where: string }[];
  images: string[];
  testimonials: { quote: string; author: string }[];
  credentials: string[];
  notes: string[];
}

const BLANK: Draft = {
  company: '', short: '', headline: ['Custom carpentry', 'and cabinetry'], tagline: '',
  city: '', nearby: [], phone: '', since: 0,
  logo: { type: 'wordmark' }, colors: { primary: '#8b5e34' },
  services: [
    { name: 'Custom cabinetry', tag: '' },
    { name: 'Built-ins and closets', tag: '' },
    { name: 'Trim and finish carpentry', tag: '' },
    { name: 'Interior doors', tag: '' }
  ],
  work: [], images: [], testimonials: [], credentials: [], notes: []
};

export default function StudioPanel({ enabled }: { enabled: boolean }) {
  const [mode, setMode] = useState<'url' | 'manual'>('url');
  const [url, setUrl] = useState('');
  const [email, setEmail] = useState('');
  const [d, setD] = useState<Draft>(BLANK);
  const [busy, setBusy] = useState<'' | 'extract' | 'build'>('');
  const [err, setErr] = useState('');
  const [built, setBuilt] = useState<{ path: string; result: string } | null>(null);

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((p) => ({ ...p, [k]: v }));

  async function extract() {
    if (!url.trim()) return setErr('Paste a website address first.');
    setBusy('extract'); setErr(''); setBuilt(null);
    try {
      const r = await fetch('/api/extract', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url })
      });
      const j = await r.json();
      if (j.error) { setErr(j.error); setMode('manual'); return; }
      setD({ ...BLANK, ...j.draft });
    } catch {
      setErr('Extraction failed. Switch to manual entry.');
      setMode('manual');
    } finally { setBusy(''); }
  }

  async function build() {
    if (!d.company.trim()) return setErr('Business name is required.');
    setBusy('build'); setErr('');
    try {
      const r = await fetch('/api/studio', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          company: d.company, short: d.short, city: d.city, phone: d.phone,
          email: email || undefined, primary: d.colors.primary, tagline: d.tagline,
          headline: d.headline, nearby: d.nearby, since: Number(d.since) || 0,
          services: d.services.filter((s) => s.name.trim()),
          work: d.work.filter((w) => w.title.trim()), logo: d.logo,
          images: d.images, testimonials: d.testimonials, credentials: d.credentials
        })
      });
      const j = await r.json();
      if (j.error) return setErr(j.error);
      setBuilt({ path: j.path, result: j.result });
    } catch {
      setErr('Could not build the demo.');
    } finally { setBusy(''); }
  }

  if (!enabled) {
    return (
      <main className="st">
        <span className="mono">Studio</span>
        <h1 className="disp" style={{ fontSize: 'clamp(1.8rem,5vw,3rem)', margin: '.8rem 0' }}>
          Studio is switched off
        </h1>
        <p style={{ color: 'var(--ink-2)', maxWidth: '46ch' }}>
          Set <code>STUDIO_ENABLED=true</code> to turn it on. It stays off by default
          because a public &ldquo;build me a demo&rdquo; endpoint is not something to leave running.
        </p>
      </main>
    );
  }

  return (
    <main className="st">
      <header className="st-head">
        <span className="mono">Caito360 &middot; demo studio</span>
        <h1 className="disp">Build a demo</h1>
        <p>
          Read it off their website, or type it in. Either way you get a live, branded demo in
          under a minute &mdash; no build, no deployment, no DNS.
        </p>
      </header>

      <div className="st-modes">
        {(['url', 'manual'] as const).map((m) => (
          <button key={m} className="st-mode" aria-pressed={mode === m} onClick={() => setMode(m)}>
            {m === 'url' ? 'From their website' : 'Enter manually'}
          </button>
        ))}
      </div>

      {mode === 'url' && (
        <div className="form st-card">
          <div className="field">
            <label className="mono" htmlFor="s-url">Their website</label>
            <input id="s-url" value={url} onChange={(e) => setUrl(e.target.value)}
                   placeholder="oaklinecarpentry.com" />
          </div>
          <button className="btn btn-primary" onClick={extract} disabled={busy !== ''}>
            {busy === 'extract' ? 'Reading their site…' : 'Read their site'}
          </button>
          <p className="st-hint">
            Pulls their logo, brand colour, services, photos, reviews and city. Everything below is
            editable &mdash; extraction is good, not perfect.
          </p>
        </div>
      )}

      {err && <div className="result bad st-gap">{err}</div>}

      {d.notes.length > 0 && (
        <div className="st-notes">
          <span className="mono">Extraction report</span>
          {d.notes.map((n, i) => (
            <div key={i}>{n}</div>
          ))}
        </div>
      )}

      <div className="form st-card">
        <div className="st-fields">
          <div className="field" style={{ gridColumn: '1 / -1' }}>
            <label className="mono" htmlFor="s-co">Business name *</label>
            <input id="s-co" value={d.company} onChange={(e) => set('company', e.target.value)}
                   placeholder="Oakline Carpentry" />
          </div>
          <div className="field">
            <label className="mono" htmlFor="s-short">Short name</label>
            <input id="s-short" value={d.short} onChange={(e) => set('short', e.target.value)}
                   placeholder="Logan" />
          </div>
          <div className="field">
            <label className="mono" htmlFor="s-city">City</label>
            <input id="s-city" value={d.city} onChange={(e) => set('city', e.target.value)} placeholder="Plano" />
          </div>
          <div className="field">
            <label className="mono" htmlFor="s-phone">Phone</label>
            <input id="s-phone" value={d.phone} onChange={(e) => set('phone', e.target.value)}
                   placeholder="(972) 555-0142" />
          </div>
          <div className="field">
            <label className="mono" htmlFor="s-color">Brand colour</label>
            <div style={{ display: 'flex', gap: '.5rem' }}>
              <input id="s-color" type="color" value={d.colors.primary}
                     onChange={(e) => set('colors', { primary: e.target.value })}
                     style={{ width: 52, padding: 4, height: 44 }} />
              <input value={d.colors.primary}
                     onChange={(e) => set('colors', { primary: e.target.value })} />
            </div>
          </div>
          <div className="field">
            <label className="mono" htmlFor="s-since">Working since</label>
            <input id="s-since" value={d.since || ''} inputMode="numeric"
                   onChange={(e) => set('since', Number(e.target.value) || 0)} placeholder="2011" />
          </div>
          <div className="field">
            <label className="mono" htmlFor="s-h1">Headline, line 1</label>
            <input id="s-h1" value={d.headline[0]} maxLength={60}
                   onChange={(e) => set('headline', [e.target.value, d.headline[1]])} />
          </div>
          <div className="field">
            <label className="mono" htmlFor="s-h2">Headline, line 2</label>
            <input id="s-h2" value={d.headline[1]} maxLength={60}
                   onChange={(e) => set('headline', [d.headline[0], e.target.value])} />
          </div>
          <div className="field" style={{ gridColumn: '1 / -1' }}>
            <label className="mono" htmlFor="s-tag">Tagline</label>
            <textarea id="s-tag" value={d.tagline} onChange={(e) => set('tagline', e.target.value)}
                      placeholder="Closets, cabinets and built-ins, made in our shop and fitted by the people who made them." />
          </div>

          {/* The one field that has to be typed. Extraction cannot find it,
              and without it the demo's automations have nowhere to land. */}
          <div className="field" style={{ gridColumn: '1 / -1' }}>
            <label className="mono" htmlFor="s-email">
              Your email — recorded against this demo
            </label>
            <input id="s-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)}
                   placeholder="you@caito360.ai" />
            <span className="mono" style={{ textTransform: 'none', letterSpacing: 0 }}>
              Notifications are addressed inside the GoHighLevel workflow, not here.
            </span>
          </div>
        </div>

        <div className="st-services">
          <span className="mono">Services</span>
          {d.services.map((s, i) => (
            <div key={i} style={{ display: 'flex', gap: '.5rem', marginTop: '.5rem' }}>
              <input value={s.name} placeholder="Service name"
                     onChange={(e) => {
                       const next = [...d.services]; next[i] = { ...next[i], name: e.target.value };
                       set('services', next);
                     }} />
              <input value={s.tag} placeholder="From $2,400" style={{ maxWidth: 160 }}
                     onChange={(e) => {
                       const next = [...d.services]; next[i] = { ...next[i], tag: e.target.value };
                       set('services', next);
                     }} />
            </div>
          ))}
          <button className="btn btn-ghost" style={{ marginTop: '.7rem' }}
                  onClick={() => set('services', [...d.services, { name: '', tag: '' }])}>
            Add service
          </button>
        </div>

        <button className="btn btn-primary" onClick={build} disabled={busy !== ''}
                style={{ width: '100%', padding: '1.05rem' }}>
          {busy === 'build' ? 'Building…' : 'Build the demo'}
        </button>
      </div>

      {built && (
        <div className="st-built">
          <span className="mono">Demo {built.result}</span>
          <h2>It&rsquo;s live</h2>
          <p>One database row. No build, no deployment, no DNS change.</p>
          <code>{built.path}</code>
          <a className="btn btn-primary" href={built.path} target="_blank" rel="noreferrer">
            Open the demo
          </a>
        </div>
      )}
    </main>
  );
}
