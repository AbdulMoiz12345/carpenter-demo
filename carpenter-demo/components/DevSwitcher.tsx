import { listTenants } from '@/lib/store';

/**
 * Development only. In production each tenant lives at its own
 * hostname, so there is nothing to switch between.
 */
export default async function DevSwitcher({ current }: { current: string }) {
  if (process.env.NODE_ENV === 'production') return null;
  const tenants = await listTenants();
  return (
    <div className="dev">
      <span className="mono">Dev only — production resolves by hostname</span>
      {tenants.map((t) => (
        <a key={t.slug} href={`/?t=${t.slug}`} data-on={t.slug === current ? '1' : '0'}>
          <span className="sw" style={{ background: t.colors.primary }} />
          {t.short}
          {t.source === 'places' ? ' (no site)' : ''}
        </a>
      ))}
    </div>
  );
}
