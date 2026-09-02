-- Their design language, read from their own CSS. Idempotent.
alter table tenants add column if not exists design jsonb;
