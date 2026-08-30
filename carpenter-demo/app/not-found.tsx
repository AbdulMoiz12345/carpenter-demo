export default function NotFound() {
  return (
    <main className="wrap" style={{ paddingTop: '6rem', paddingBottom: '6rem' }}>
      <span className="mono">Demo not found</span>
      <h1 className="disp" style={{ fontSize: 'clamp(2rem,6vw,3.4rem)', margin: '.8rem 0 0' }}>
        This link isn&rsquo;t active
      </h1>
      <p style={{ color: 'var(--ink-2)', maxWidth: '40ch' }}>
        It may have expired. Ask whoever sent it for a fresh one.
      </p>
    </main>
  );
}
