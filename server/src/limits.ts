/** Rate limits (SY-43), via Workers Rate Limiting bindings. Missing bindings allow everything. */

import { HttpError } from "./http";

export const enforce = async (limiter: RateLimit | undefined, key: string) => {
  if (!limiter) return;
  const { success } = await limiter.limit({ key });
  if (!success) throw new HttpError(429, "rate_limited", {}, { "retry-after": "60" });
};
