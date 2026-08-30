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

export { getByHost, getBySlug, listTenants };
export const allTenants = listTenants;
