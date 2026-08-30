import 'server-only';
import { headers } from 'next/headers';
import type { Tenant } from './types';
import { getByHost, getBySlug, listTenants } from './store';

/**
 * Resolve the tenant for the current request.
 *
 * SECURITY: identity comes from the hostname, set by middleware.
 * Never from a query string, body field or client header in production.
 * If the browser could influence this, one prospect could read another
 * prospect's data.
 *
 * The ?t= override is development-only, so every tenant can be previewed
 * on localhost without editing /etc/hosts.
 */
export async function resolveTenant(searchParams?: { t?: string }): Promise<Tenant | null> {
  const h = headers();

  if (process.env.NODE_ENV !== 'production') {
    const slug = searchParams?.t ?? h.get('x-dev-tenant');
    if (slug) return getBySlug(slug);
  }

  const fromMiddleware = h.get('x-tenant-slug');
  if (fromMiddleware) return getBySlug(fromMiddleware);

  return getByHost(h.get('host'));
}

/**
 * Resolve a tenant for an API call made from a /d/<slug> page.
 *
 * Path-mode demos have no distinguishing hostname — every one of them
 * is served from the same *.vercel.app — so the slug has to come from
 * the request. That means trusting a value the browser supplied, which
 * is normally forbidden.
 *
 * It is gated behind STUDIO_ENABLED for exactly that reason: path mode
 * exists for internal demos and video calls, where every sub-account is
 * one Caito360 owns. Once real prospects have links, STUDIO_ENABLED goes
 * off, path mode goes with it, and hostname becomes the only trust
 * anchor again.
 */
export async function resolveTenantForApi(req: Request): Promise<Tenant | null> {
  const byHost = await resolveTenant();
  if (byHost) return byHost;

  if (process.env.STUDIO_ENABLED === 'true') {
    const slug = new URL(req.url).searchParams.get('d');
    if (slug) return getBySlug(slug);
  }
  return null;
}

export { getByHost, getBySlug, listTenants };
export const allTenants = listTenants;
