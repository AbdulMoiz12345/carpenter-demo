import 'server-only';

/**
 * VERCEL CAVEAT — read this before relying on it.
 *
 * This is an in-memory limiter. On Vercel each serverless function
 * instance has its own memory and instances come and go, so this gives
 * PARTIAL protection only: it stops a burst hitting one warm instance,
 * not a determined attacker spread across cold starts.
 *
 * That is acceptable for demo traffic. Before this handles real
 * campaign volume, swap the Map for Vercel KV or Upstash Redis —
 * the function signature below does not need to change.
 *
 *   const { success } = await ratelimit.limit(key)   // @upstash/ratelimit
 */
const hits = new Map<string, { n: number; reset: number }>();

export function rateLimit(key: string, max = 5, windowMs = 60_000) {
  const now = Date.now();

  // Keep the map from growing without bound across a long-lived instance.
  if (hits.size > 5000) {
    for (const [k, v] of hits) if (now > v.reset) hits.delete(k);
  }

  const rec = hits.get(key);
  if (!rec || now > rec.reset) {
    hits.set(key, { n: 1, reset: now + windowMs });
    return { ok: true, remaining: max - 1 };
  }
  rec.n += 1;
  return { ok: rec.n <= max, remaining: Math.max(0, max - rec.n) };
}

export function clientKey(req: Request, scope: string) {
  // On Vercel, x-forwarded-for is set by the platform and its first
  // entry is the real client IP.
  const ip =
    req.headers.get('x-forwarded-for')?.split(',')[0].trim() ??
    req.headers.get('x-real-ip') ??
    'unknown';
  return `${scope}:${ip}`;
}
