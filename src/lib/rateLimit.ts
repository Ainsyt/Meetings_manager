import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

// IMPORTANT: Vercel functions are stateless/ephemeral - an in-memory rate
// limiter (e.g. a plain JS Map) will NOT work reliably there, since each
// invocation may hit a different instance. Upstash Redis (free tier is
// plenty for a small team tool) gives you a shared counter across
// invocations. This is the one piece of the stack that isn't "just Vercel".

const redis =
  process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
    ? new Redis({
        url: process.env.UPSTASH_REDIS_REST_URL,
        token: process.env.UPSTASH_REDIS_REST_TOKEN,
      })
    : null;

const limiter = redis
  ? new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(10, "1 m"), // 10 requests / minute per key
      analytics: false,
    })
  : null;

/**
 * Returns { success: true } if the request is allowed, false if rate-limited.
 * If Upstash isn't configured (e.g. local dev without it set up), this
 * fails open - it does NOT block requests, so don't forget to configure it
 * before going to production per the implementation plan.
 */
export async function checkRateLimit(key: string): Promise<{ success: boolean }> {
  if (!limiter) return { success: true };
  const result = await limiter.limit(key);
  return { success: result.success };
}
