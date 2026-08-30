import 'server-only';
import { timingSafeEqual } from 'crypto';

/**
 * Shared-secret auth for the ingest endpoints.
 *
 * Deliberately minimal: these routes are used by the extractor running
 * on a laptop or in CI, not by humans in a browser. A bearer token is
 * the right weight for that. When more than one person needs access,
 * replace this with real accounts — do not start handing the token out.
 */
export function authorised(req: Request): boolean {
  const expected = process.env.ADMIN_TOKEN;
  // No token configured means the endpoint is closed, not open.
  if (!expected) return false;

  const got = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!got) return false;

  const a = Buffer.from(got);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
