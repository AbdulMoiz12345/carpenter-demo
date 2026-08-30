-- Richer extraction: real photos, review text and credentials from the
-- prospect's own site. Idempotent, so it is safe to re-run.

alter table tenants add column if not exists images       jsonb not null default '[]'::jsonb;
alter table tenants add column if not exists testimonials jsonb not null default '[]'::jsonb;
alter table tenants add column if not exists credentials  jsonb not null default '[]'::jsonb;
alter table tenants add column if not exists email        text  not null default '';
