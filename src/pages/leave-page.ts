/** Sends the browser to another site (Stripe's Customer Portal). In its own module so tests can stand in for it. */
export const leavePage = (url: string): void => window.location.assign(url);
