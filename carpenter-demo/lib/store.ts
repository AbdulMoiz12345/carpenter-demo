import 'server-only';
import { Pool } from 'pg';
import type { Tenant } from './types';

/**
 * TENANT STORE
 *
 * Two backends behind one interface:
 *
 *   DATABASE_URL set    → Postgres. Adding a demo is an INSERT.
 *                         No build, no deploy, no DNS.
 *   DATABASE_URL unset  → the bundled JSON files. Fine for local work
 *                         and a handful of hand-made demos, but every
 *                         new prospect then needs a redeploy — which is
 *                         the manual problem this project exists to
 *                         remove. Do not run a campaign on it.
 *
 * Everything above this layer treats tenants as data and does not care
 * which backend answered.
 */

import oakline from '../data/oakline-carpentry.json';
import kestrel from '../data/kestrel-woodwork.json';

const FILE_TENANTS = [oakline, kestrel] as unknown as Tenant[];

export const usingDatabase = () => Boolean(process.env.DATABASE_URL);

/* ── Postgres ─────────────────────────────────────────────────────── */

let pool: Pool | null = null;

function db(): Pool {
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      // Serverless: many short-lived instances, so keep each one tiny
      // and let the provider's pooler do the real pooling. Use the
      // POOLED connection string from Neon/Supabase, not the direct one.
      max: 1,
      idleTimeoutMillis: 10_000,
      connectionTimeoutMillis: 5_000,
      ssl: { rejectUnauthorized: false }
    });
  }
  return pool;
}

type Row = Record<string, unknown>;

function rowToTenant(r: Row): Tenant {
  return {
    slug: r.slug as string,
    domain: r.domain as string,
    status: r.status as Tenant['status'],
    source: r.source as Tenant['source'],
    company: r.company as string,
    short: r.short as string,
    headline: r.headline as [string, string],
    tagline: (r.tagline as string) ?? '',
    city: (r.city as string) ?? '',
    nearby: (r.nearby as string[]) ?? [],
    phone: (r.phone as string) ?? '',
    since: (r.since as number) ?? 0,
    rating: (r.rating as string) ?? '',
    reviews: (r.reviews as number) ?? 0,
    logo: r.logo as Tenant['logo'],
    colors: r.colors as Tenant['colors'],
    services: (r.services as Tenant['services']) ?? [],
    work: (r.work as Tenant['work']) ?? [],
    images: (r.images as string[]) ?? [],
    testimonials: (r.testimonials as Tenant['testimonials']) ?? [],
    credentials: (r.credentials as string[]) ?? [],
    email: (r.email as string) ?? '',
    ghl: (r.ghl as Tenant['ghl']) ?? {}
  };
}

const SELECT = `
  select * from tenants
  where status = 'ACTIVE'
    and (expires_at is null or expires_at > now())
`;

/* ── Public interface ─────────────────────────────────────────────── */

export async function getByHost(host: string | null): Promise<Tenant | null> {
  if (!host) return null;
  const clean = host.split(':')[0].toLowerCase();

  if (!usingDatabase()) {
    return FILE_TENANTS.find((t) => t.domain.toLowerCase() === clean && t.status === 'ACTIVE') ?? null;
  }

  const { rows } = await db().query(`${SELECT} and lower(domain) = $1 limit 1`, [clean]);
  return rows.length ? rowToTenant(rows[0]) : null;
}

export async function getBySlug(slug: string): Promise<Tenant | null> {
  const clean = slug.toLowerCase();

  if (!usingDatabase()) {
    return FILE_TENANTS.find((t) => t.slug.toLowerCase() === clean && t.status === 'ACTIVE') ?? null;
  }

  const { rows } = await db().query(`${SELECT} and lower(slug) = $1 limit 1`, [clean]);
  return rows.length ? rowToTenant(rows[0]) : null;
}

export async function listTenants(limit = 50): Promise<Tenant[]> {
  if (!usingDatabase()) return FILE_TENANTS.filter((t) => t.status === 'ACTIVE');
  const { rows } = await db().query(`${SELECT} order by created_at desc limit $1`, [limit]);
  return rows.map(rowToTenant);
}

/**
 * Create or replace a tenant. Idempotent by slug: running the extractor
 * twice over the same company yields exactly one tenant, not two.
 *
 * `ghl` is MERGED rather than replaced, so re-extracting a prospect —
 * or rebuilding their demo in the studio — never wipes a sub-account
 * binding that was attached later.
 */
export async function upsertTenant(t: Tenant & { meta?: unknown }): Promise<'created' | 'updated'> {
  if (!usingDatabase()) throw new Error('DATABASE_URL is not set');

  const { rows } = await db().query(
    `insert into tenants (
       slug, domain, status, source, company, short, headline, tagline,
       city, nearby, phone, since, rating, reviews, logo, colors,
       services, work, ghl, meta, images, testimonials, credentials, email
     ) values (
       $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,
       $21,$22,$23,$24
     )
     on conflict (slug) do update set
       domain = excluded.domain, status = excluded.status,
       source = excluded.source, company = excluded.company,
       short = excluded.short, headline = excluded.headline,
       tagline = excluded.tagline, city = excluded.city,
       nearby = excluded.nearby, phone = excluded.phone,
       since = excluded.since, rating = excluded.rating,
       reviews = excluded.reviews, logo = excluded.logo,
       colors = excluded.colors, services = excluded.services,
       work = excluded.work,
       -- MERGE, never replace. Re-extracting or rebuilding a demo must
       -- not wipe a sub-account binding someone attached afterwards.
       -- Right-hand side wins per key, so an incoming {} changes nothing
       -- and an incoming partial only sets the keys it carries.
       ghl = tenants.ghl || excluded.ghl,
       meta = excluded.meta, images = excluded.images,
       testimonials = excluded.testimonials, credentials = excluded.credentials,
       email = excluded.email, updated_at = now()
     returning (xmax = 0) as created`,
    [
      t.slug, t.domain, t.status ?? 'ACTIVE', t.source ?? 'website',
      t.company, t.short, JSON.stringify(t.headline), t.tagline ?? '',
      t.city ?? '', JSON.stringify(t.nearby ?? []), t.phone ?? '',
      t.since ?? 0, t.rating ?? '', t.reviews ?? 0,
      JSON.stringify(t.logo), JSON.stringify(t.colors),
      JSON.stringify(t.services ?? []), JSON.stringify(t.work ?? []),
      JSON.stringify(t.ghl ?? {}), JSON.stringify(t.meta ?? {}),
      JSON.stringify(t.images ?? []), JSON.stringify(t.testimonials ?? []),
      JSON.stringify(t.credentials ?? []), t.email ?? ''
    ]
  );

  const created = Boolean(rows[0]?.created);
  await db().query(
    `insert into tenant_audit (slug, action, detail) values ($1,$2,$3)`,
    [t.slug, created ? 'created' : 'updated', JSON.stringify({ domain: t.domain })]
  );
  return created ? 'created' : 'updated';
}

/** Attach or change the GoHighLevel binding without re-extracting. */
export async function setGhlBinding(slug: string, ghl: Tenant['ghl']): Promise<boolean> {
  if (!usingDatabase()) throw new Error('DATABASE_URL is not set');
  const { rowCount } = await db().query(
    `update tenants set ghl = tenants.ghl || $2::jsonb, updated_at = now() where slug = $1`,
    [slug, JSON.stringify(ghl)]
  );
  if (rowCount) {
    await db().query(
      `insert into tenant_audit (slug, action, detail) values ($1,'ghl-bound',$2)`,
      [slug, JSON.stringify({ keys: Object.keys(ghl ?? {}) })]
    );
  }
  return Boolean(rowCount);
}
