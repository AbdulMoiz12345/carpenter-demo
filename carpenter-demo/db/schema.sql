-- Tenant store.
--
-- The point of this table: adding a demo is an INSERT, not a deploy.
-- While tenants live in bundled JSON, every new prospect needs a build,
-- which is the manual problem this whole project exists to remove.

create table if not exists tenants (
  slug          text primary key,
  domain        text not null unique,
  status        text not null default 'ACTIVE'
                check (status in ('ACTIVE','DISABLED')),
  source        text not null default 'website'
                check (source in ('website','places')),

  company       text not null,
  short         text not null,
  headline      jsonb not null,          -- ["line one","line two"]
  tagline       text not null default '',
  city          text not null default '',
  nearby        jsonb not null default '[]'::jsonb,
  phone         text not null default '',
  since         integer not null default 0,
  rating        text not null default '',
  reviews       integer not null default 0,

  logo          jsonb not null default '{"type":"wordmark"}'::jsonb,
  colors        jsonb not null,          -- {"primary":"#7a4b24"}
  services      jsonb not null default '[]'::jsonb,
  work          jsonb not null default '[]'::jsonb,

  -- GHL binding. Kept in its own column so it can be attached after
  -- extraction without touching anything the extractor produced.
  ghl           jsonb not null default '{}'::jsonb,

  -- Provenance: the first thing you want when a demo looks wrong.
  meta          jsonb not null default '{}'::jsonb,

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  -- Auto-disable stale demos so an old link never serves a live page.
  expires_at    timestamptz
);

create index if not exists tenants_domain_idx on tenants (lower(domain));
create index if not exists tenants_status_idx on tenants (status);

-- Audit trail. Small, cheap, and the only way to answer "who changed
-- this and when" once more than one person can write.
create table if not exists tenant_audit (
  id         bigserial primary key,
  slug       text not null,
  action     text not null,
  actor      text not null default 'extractor',
  detail     jsonb not null default '{}'::jsonb,
  at         timestamptz not null default now()
);

create index if not exists tenant_audit_slug_idx on tenant_audit (slug, at desc);
