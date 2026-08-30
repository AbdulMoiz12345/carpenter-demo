import { NextResponse, type NextRequest } from 'next/server';

/**
 * Runs before every page and API route.
 *
 * Its only job is to turn the incoming hostname into a tenant slug
 * and attach it server-side. Everything downstream — branding,
 * which GHL sub-account is read, which modules exist — derives
 * from this one value.
 *
 * Kept deliberately thin: no database call here, because middleware
 * runs on every request including assets. The lookup happens once
 * in the page, where it can be cached.
 */
export function middleware(req: NextRequest) {
  const host = (req.headers.get('host') ?? '').split(':')[0].toLowerCase();
  const parent = (process.env.DEMO_PARENT_DOMAIN ?? 'demo.localhost').toLowerCase();

  // brightsmile.demo.caito360.ai -> brightsmile
  let slug = '';
  if (host.endsWith('.' + parent)) {
    slug = host.slice(0, -(parent.length + 1));
  }

  const res = NextResponse.next();
  if (slug) res.headers.set('x-tenant-slug', slug);
  return res;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)']
};
