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
