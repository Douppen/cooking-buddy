// Cooking Buddy server: one process that serves the built glasses web app and runs the
// WebSocket relay between the glasses app and the phone camera page in the same room.
//
//   GET  /up                     health check (Kamal + Docker)
//   WS   /ws?room=ABC123         relay: forwards JSON messages to the other peers in the room
//   GET  /*                      static files from PUBLIC_DIR, SPA fallback to index.html
//
//   glasses -> {t:"snap", question}   phone -> {t:"answer", text}   server -> {t:"ping"}

import { createReadStream, statSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";

const PORT = Number(process.env.PORT ?? 8787);
const PUBLIC_DIR = resolve(
  process.env.PUBLIC_DIR ?? join(dirname(fileURLToPath(import.meta.url)), "../app/dist"),
);
// Browser origins allowed to open a socket. Empty = allow any (local dev).
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS ?? "")
  .split(",").map((s) => s.trim()).filter(Boolean);
const ROOM_RE = /^[A-Za-z0-9]{4,12}$/;
const MAX_MESSAGE_BYTES = 16 * 1024;
const MAX_PER_ROOM = 6;
const PING_MS = 20_000;

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".mp4": "video/mp4",
  ".txt": "text/plain; charset=utf-8",
};

const rooms = new Map(); // room -> Set<WebSocket>

const http = createServer((req, res) => {
  if (req.url === "/up") {
    res.writeHead(200, { "content-type": "text/plain" }).end("OK");
    return;
  }
  serveStatic(req, res);
});

function serveStatic(req, res) {
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405, { allow: "GET, HEAD" }).end();
    return;
  }
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url ?? "/", "http://local").pathname);
  } catch {
    res.writeHead(400).end();
    return;
  }
  let file = resolve(PUBLIC_DIR, `.${pathname}`);
  if (file !== PUBLIC_DIR && !file.startsWith(PUBLIC_DIR + sep)) {
    res.writeHead(404).end();
    return;
  }
  let stat = tryStat(file);
  if (stat?.isDirectory()) {
    file = join(file, "index.html");
    stat = tryStat(file);
  }
  if (!stat) {
    // Unknown asset → 404; unknown route → the app shell, so client routes survive a reload.
    if (extname(pathname)) {
      res.writeHead(404).end();
      return;
    }
    file = join(PUBLIC_DIR, "index.html");
    stat = tryStat(file);
    if (!stat) {
      res.writeHead(404, { "content-type": "text/plain" }).end("App not built");
      return;
    }
  }
  res.writeHead(200, {
    "content-type": TYPES[extname(file)] ?? "application/octet-stream",
    "content-length": stat.size,
    // Vite fingerprints everything under /assets; the HTML shell must always revalidate.
    "cache-control": pathname.startsWith("/assets/")
      ? "public, max-age=31536000, immutable"
      : "no-cache",
    "x-content-type-options": "nosniff",
  });
  if (req.method === "HEAD") {
    res.end();
    return;
  }
  createReadStream(file).on("error", () => res.destroy()).pipe(res);
}

function tryStat(file) {
  try {
    return statSync(file);
  } catch {
    return null;
  }
}

const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_MESSAGE_BYTES });

http.on("upgrade", (req, socket, head) => {
  const url = new URL(req.url ?? "/", "http://local");
  const room = url.searchParams.get("room") ?? "";
  const origin = req.headers.origin ?? "";
  const originOk = ALLOWED_ORIGINS.length === 0 || ALLOWED_ORIGINS.includes(origin);

  if (url.pathname !== "/ws" || !ROOM_RE.test(room) || !originOk) {
    socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
    socket.destroy();
    return;
  }
  const peers = rooms.get(room) ?? new Set();
  if (peers.size >= MAX_PER_ROOM) {
    socket.write("HTTP/1.1 429 Too Many Requests\r\n\r\n");
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => joinRoom(ws, room, peers));
});

function joinRoom(ws, room, peers) {
  peers.add(ws);
  rooms.set(room, peers);
  ws.isAlive = true;
  broadcast(peers, null, { t: "peers", count: peers.size });

  ws.on("pong", () => { ws.isAlive = true; });
  ws.on("message", (data, isBinary) => {
    if (isBinary) return;
    let msg;
    try { msg = JSON.parse(data.toString()); } catch { return; }
    if (!msg || typeof msg.t !== "string" || msg.t === "ping") return;
    broadcast(peers, ws, msg);
  });
  ws.on("close", () => {
    peers.delete(ws);
    if (peers.size === 0) rooms.delete(room);
    else broadcast(peers, null, { t: "peers", count: peers.size });
  });
}

function broadcast(peers, sender, msg) {
  const text = JSON.stringify(msg);
  for (const peer of peers) {
    if (peer !== sender && peer.readyState === peer.OPEN) peer.send(text);
  }
}

// Protocol pings drop dead sockets server-side; the app-level {t:"ping"} lets browser
// clients (which can't see protocol pings) notice a dead link and reconnect, and keeps
// Cloudflare and kamal-proxy from treating the socket as idle.
const heartbeat = setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) { ws.terminate(); continue; }
    ws.isAlive = false;
    ws.ping();
    ws.send('{"t":"ping"}');
  }
}, PING_MS);

function shutdown() {
  clearInterval(heartbeat);
  for (const ws of wss.clients) ws.close(1012, "restarting");
  http.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

http.listen(PORT, "0.0.0.0", () => {
  console.log(`cooking-buddy listening on :${PORT}, serving ${PUBLIC_DIR}`);
});
