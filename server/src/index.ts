/**
 * Wants & Won'ts supporter sync: a small Worker in front of D1 and Stripe.
 * Rules live in docs/spec/sync.md (and, for live-sharing boxes,
 * docs/spec/notifications.md); each handler names the rules it implements.
 */

import { deleteAccount, getAccountStatus, rotateAccount } from "./accounts";
import { authenticate, authenticateMember, type Caller } from "./auth";
import { handleWebhook, openPortal, startCheckout } from "./billing";
import { createBox, deleteBox, joinBox, leaveBox, listCopies, loadMember, newInvite, putCopy, type Member } from "./boxes";
import { runDailyPurge } from "./cron";
import { BOX_LIMITS, LIMITS, type Env } from "./env";
import { HttpError, errorResponse, readBody, text } from "./http";
import { enforce } from "./limits";
import { log } from "./log";
import { deleteMenu, listMenus, putMenu } from "./menus";
import { createPairing, takePairing } from "./pairing";
import { COACH_LIMITS, handleCoach } from "./coach";

type Context = { env: Env; request: Request; url: URL; params: string[] };

type Route = {
  /** For logs: a pattern, never the concrete path (SY-44). */
  pattern: string;
  method: string;
  path: RegExp;
  /** Largest accepted body, in bytes. */
  maxBody: number;
  /**
   * "signed": Ed25519-signed by a sync account (SY-6). "sensitive": also the
   * stricter per-account limit. "member": signed with a box key by a member of
   * the box in the path (notifications.md §7a, NT-12); the first path parameter
   * is the box id.
   */
  auth: "none" | "signed" | "sensitive" | "member";
  handle: (ctx: Context, body: Uint8Array, caller: Caller | null, member: Member | null) => Promise<Response>;
};

const signed = (caller: Caller | null): Caller => {
  if (!caller) throw new HttpError(401, "unauthorized");
  return caller;
};

const asMember = (member: Member | null): Member => {
  if (!member) throw new HttpError(401, "unauthorized");
  return member;
};

const ROUTES: Route[] = [
  { pattern: "GET /v1/health", method: "GET", path: /^\/v1\/health$/, maxBody: 0, auth: "none", handle: async () => text("ok") },
  {
    pattern: "GET /v1/account", method: "GET", path: /^\/v1\/account$/, maxBody: 0, auth: "signed",
    handle: ({ env }, _b, caller) => getAccountStatus(env, signed(caller)),
  },
  {
    pattern: "DELETE /v1/account", method: "DELETE", path: /^\/v1\/account$/, maxBody: 0, auth: "sensitive",
    handle: ({ env }, _b, caller) => deleteAccount(env, signed(caller)),
  },
  {
    pattern: "POST /v1/account/rotate", method: "POST", path: /^\/v1\/account\/rotate$/, maxBody: LIMITS.jsonBytes, auth: "sensitive",
    handle: ({ env }, body, caller) => rotateAccount(env, signed(caller), body),
  },
  {
    pattern: "GET /v1/menus", method: "GET", path: /^\/v1\/menus$/, maxBody: 0, auth: "signed",
    handle: ({ env, url }, _b, caller) => listMenus(env, signed(caller), url),
  },
  {
    pattern: "PUT /v1/menus/:id", method: "PUT", path: /^\/v1\/menus\/([^/]+)$/, maxBody: LIMITS.menuBytes, auth: "signed",
    handle: ({ env, request, params }, body, caller) => putMenu(env, signed(caller), request, params[0] ?? "", body),
  },
  {
    pattern: "DELETE /v1/menus/:id", method: "DELETE", path: /^\/v1\/menus\/([^/]+)$/, maxBody: LIMITS.tombstoneBytes, auth: "signed",
    handle: ({ env, request, params }, body, caller) => deleteMenu(env, signed(caller), request, params[0] ?? "", body),
  },
  {
    pattern: "POST /v1/checkout", method: "POST", path: /^\/v1\/checkout$/, maxBody: LIMITS.jsonBytes, auth: "sensitive",
    handle: ({ env }, body, caller) => startCheckout(env, signed(caller), body),
  },
  {
    pattern: "POST /v1/portal", method: "POST", path: /^\/v1\/portal$/, maxBody: LIMITS.jsonBytes, auth: "sensitive",
    handle: ({ env }, _b, caller) => openPortal(env, signed(caller)),
  },
  {
    pattern: "POST /v1/coach", method: "POST", path: /^\/v1\/coach$/, maxBody: COACH_LIMITS.requestBytes, auth: "sensitive",
    handle: ({ env }, body, caller) => handleCoach(env, signed(caller), body),
  },
  {
    pattern: "POST /v1/stripe/webhook", method: "POST", path: /^\/v1\/stripe\/webhook$/, maxBody: 512 * 1024, auth: "none",
    handle: ({ env, request }, body) => handleWebhook(env, request, body),
  },
  {
    pattern: "POST /v1/pair", method: "POST", path: /^\/v1\/pair$/, maxBody: LIMITS.jsonBytes, auth: "sensitive",
    handle: ({ env }, body, caller) => createPairing(env, signed(caller), body),
  },
  {
    pattern: "GET /v1/pair/:id", method: "GET", path: /^\/v1\/pair\/([^/]+)$/, maxBody: 0, auth: "none",
    handle: async ({ env, request, params }) => {
      // SY-43: pairing reads are unauthenticated, so they're limited per IP. The
      // address is only a rate-limit key; it isn't logged or stored.
      await enforce(env.RL_IP, request.headers.get("cf-connecting-ip") ?? "unknown");
      return takePairing(env, params[0] ?? "");
    },
  },
  // Live-sharing boxes (docs/spec/notifications.md §7a).
  {
    pattern: "POST /v1/boxes", method: "POST", path: /^\/v1\/boxes$/, maxBody: LIMITS.jsonBytes, auth: "sensitive",
    handle: ({ env }, body, caller) => createBox(env, signed(caller), body),
  },
  {
    pattern: "POST /v1/boxes/:id/members", method: "POST", path: /^\/v1\/boxes\/([^/]+)\/members$/, maxBody: LIMITS.jsonBytes, auth: "none",
    handle: async ({ env, request, params }, body) => {
      // NT-52: joins are unauthenticated, so they're limited per IP, apart from
      // pairing reads. The address is only a rate-limit key; it isn't logged or stored.
      await enforce(env.RL_IP, `join:${request.headers.get("cf-connecting-ip") ?? "unknown"}`);
      return joinBox(env, params[0] ?? "", body);
    },
  },
  {
    pattern: "DELETE /v1/boxes/:id/members/me", method: "DELETE", path: /^\/v1\/boxes\/([^/]+)\/members\/me$/, maxBody: 0, auth: "member",
    handle: ({ env }, _b, _c, member) => leaveBox(env, asMember(member)),
  },
  {
    pattern: "POST /v1/boxes/:id/invite", method: "POST", path: /^\/v1\/boxes\/([^/]+)\/invite$/, maxBody: LIMITS.jsonBytes, auth: "member",
    handle: ({ env }, body, _c, member) => newInvite(env, asMember(member), body),
  },
  {
    pattern: "GET /v1/boxes/:id/copies", method: "GET", path: /^\/v1\/boxes\/([^/]+)\/copies$/, maxBody: 0, auth: "member",
    handle: ({ env, url }, _b, _c, member) => listCopies(env, asMember(member), url),
  },
  {
    pattern: "PUT /v1/boxes/:id/copies/:memberId", method: "PUT", path: /^\/v1\/boxes\/([^/]+)\/copies\/([^/]+)$/, maxBody: BOX_LIMITS.copyBytes, auth: "member",
    handle: ({ env, request, params }, body, _c, member) => putCopy(env, asMember(member), request, params[1] ?? "", body),
  },
  {
    pattern: "DELETE /v1/boxes/:id", method: "DELETE", path: /^\/v1\/boxes\/([^/]+)$/, maxBody: 0, auth: "member",
    handle: ({ env }, _b, _c, member) => deleteBox(env, asMember(member)),
  },
];

/** Finds the route, or throws 404 / 405 (SY-40). */
const match = (method: string, pathname: string): { route: Route; params: string[] } => {
  const forPath = ROUTES.filter((route) => route.path.test(pathname));
  if (forPath.length === 0) throw new HttpError(404, "not_found");
  const route = forPath.find((r) => r.method === method);
  if (!route) {
    throw new HttpError(405, "method_not_allowed", {}, { allow: forPath.map((r) => r.method).join(", ") });
  }
  return { route, params: (pathname.match(route.path) ?? []).slice(1) };
};

export const handleRequest = async (request: Request, env: Env): Promise<Response> => {
  const url = new URL(request.url);
  let pattern = `${request.method} ${url.pathname.startsWith("/v1/") ? "/v1/?" : "/?"}`;
  try {
    const { route, params } = match(request.method, url.pathname);
    pattern = route.pattern;
    const body = await readBody(request, route.maxBody);
    let caller: Caller | null = null;
    let member: Member | null = null;
    if (route.auth === "member") {
      const boxCaller = await authenticateMember(request, body, params[0] ?? "");
      // NT-52: per member device, in its own key space (member ids and account
      // ids are both key hashes, but of different keys).
      await enforce(env.RL_ACCOUNT, `box:${boxCaller.boxId}:${boxCaller.memberId}`);
      member = await loadMember(env, boxCaller);
    } else if (route.auth !== "none") {
      caller = await authenticate(request, body);
      await enforce(env.RL_ACCOUNT, caller.accountId);
      if (route.auth === "sensitive") await enforce(env.RL_SENSITIVE, caller.accountId);
    }
    return await route.handle({ env, request, url, params }, body, caller, member);
  } catch (error) {
    if (error instanceof HttpError) {
      if (error.status >= 500 || error.status === 429) log({ route: pattern, status: error.status, code: error.code });
      return errorResponse(error);
    }
    // Only the error's class name: messages can carry values (SY-44).
    log({ route: pattern, status: 500, code: "internal", kind: error instanceof Error ? error.name : "unknown" });
    return errorResponse(new HttpError(500, "internal"));
  }
};

export default {
  fetch: (request, env) => handleRequest(request, env),
  scheduled: async (_controller, env, ctx) => {
    ctx.waitUntil(runDailyPurge(env));
  },
} satisfies ExportedHandler<Env>;
