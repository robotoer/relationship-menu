/** Responses, errors and size-limited body reading. */

/** An error that becomes a JSON response: `{ "error": code, ...extra }`. */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly extra: Record<string, unknown> = {},
    readonly headers: Record<string, string> = {}
  ) {
    super(code);
  }
}

const BASE_HEADERS = {
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
};

export const json = (data: unknown, status = 200, headers: Record<string, string> = {}): Response =>
  new Response(JSON.stringify(data), {
    status,
    headers: { ...BASE_HEADERS, "content-type": "application/json; charset=utf-8", ...headers },
  });

export const text = (body: string, status = 200): Response =>
  new Response(body, { status, headers: { ...BASE_HEADERS, "content-type": "text/plain; charset=utf-8" } });

export const noContent = (): Response => new Response(null, { status: 204, headers: BASE_HEADERS });

export const errorResponse = (error: HttpError): Response =>
  json({ error: error.code, ...error.extra }, error.status, error.headers);

/** Reads the whole body, refusing anything over `max` bytes (413) without buffering it all. */
export const readBody = async (request: Request, max: number): Promise<Uint8Array> => {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > max) throw new HttpError(413, "too_large", { max });
  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel();
      throw new HttpError(413, "too_large", { max });
    }
    chunks.push(value);
  }
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
};

/** Parses a JSON object body, or throws 400. */
export const parseJson = (body: Uint8Array): Record<string, unknown> => {
  try {
    const value: unknown = JSON.parse(new TextDecoder().decode(body));
    if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  } catch {
    // fall through
  }
  throw new HttpError(400, "bad_request");
};
