// Small HTTP helpers shared by the routes: JSON responses, body reading, client IP and a
// per-IP rate limiter.

export function sendJson(res, status, body, headers = {}) {
  res
    .writeHead(status, {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...headers,
    })
    .end(JSON.stringify(body));
}

// Resolves with the body as text, or rejects with { status: 413 } once it passes `limit` bytes.
export function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size <= limit) chunks.push(chunk);
    });
    req.on("end", () => {
      if (size > limit) reject(Object.assign(new Error("Request is too large"), { status: 413 }));
      else resolve(Buffer.concat(chunks).toString("utf8"));
    });
    req.on("error", reject);
  });
}

/**
 * The shared front half of a JSON POST endpoint: method, content type, size, rate limit,
 * parsing and Zod validation. Answers the error itself (405, 415, 413, 429, 400) and returns
 * null, or returns the validated data.
 * @param {{ schema: import("zod").ZodType, maxBytes: number, allow: (ip: string) => boolean,
 *           tooManyMessage: string }} options
 */
export async function readJsonRequest(req, res, { schema, maxBytes, allow, tooManyMessage }) {
  if (req.method !== "POST") {
    sendJson(res, 405, { error: "Use POST" }, { allow: "POST" });
    return null;
  }
  if (!String(req.headers["content-type"] ?? "").startsWith("application/json")) {
    sendJson(res, 415, { error: "Send JSON with content-type: application/json" });
    return null;
  }
  if (Number(req.headers["content-length"] ?? 0) > maxBytes) {
    sendJson(res, 413, { error: "Request is too large" });
    return null;
  }
  if (!allow(clientIp(req))) {
    sendJson(res, 429, { error: tooManyMessage });
    return null;
  }
  let json;
  try {
    json = JSON.parse(await readBody(req, maxBytes));
  } catch (err) {
    sendJson(res, err.status ?? 400, { error: err.status ? err.message : "Body is not valid JSON" });
    return null;
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    sendJson(res, 400, {
      error: "Invalid request",
      issues: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
    });
    return null;
  }
  return parsed.data;
}

// A loggable reason for a failed call, including both attempts when withBackup gave up.
export function failureReason(err) {
  return err instanceof AggregateError ? err.errors.map((e) => e?.message ?? e).join(" | ") : (err?.message ?? err);
}

// Cloudflare sets cf-connecting-ip; the server only accepts traffic through Cloudflare.
export function clientIp(req) {
  const forwarded = String(req.headers["x-forwarded-for"] ?? "").split(",")[0].trim();
  return req.headers["cf-connecting-ip"] || forwarded || req.socket.remoteAddress || "unknown";
}

// Fixed one-minute windows per key. Returns allow(key) → true while under the limit.
export function createRateLimiter(perMinute) {
  const windows = new Map(); // key -> { start, count }
  setInterval(() => {
    const now = Date.now();
    for (const [key, w] of windows) if (now - w.start >= 60_000) windows.delete(key);
  }, 60_000).unref();

  return function allow(key) {
    const now = Date.now();
    const w = windows.get(key);
    if (!w || now - w.start >= 60_000) {
      windows.set(key, { start: now, count: 1 });
      return true;
    }
    w.count += 1;
    return w.count <= perMinute;
  };
}
