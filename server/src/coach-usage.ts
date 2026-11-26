/**
 * Keys of the AI coach's use counters (table coach_usage, CO-8). Daily rows have a
 * UTC date in `day`; monthly rows ("m:…") have a UTC month ("2026-11"). The daily
 * clean-up keeps each until its day or month is over (cron.ts). Accounts move them
 * on rotation and remove them on deletion (accounts.ts).
 */
export const coachUsageKeys = (accountId: string) => ({ day: `a:${accountId}`, month: `m:a:${accountId}` });
