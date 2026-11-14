// Cooking Buddy server: serves the built glasses web app. The app's "brains" (recipes,
// AI answers at /api/ask) belong here too, so a future native app can reuse them.
//
//   GET  /up                  health check (Kamal + Docker)
//   POST /api/ask             answer a question about the current recipe step, or change
//                             the recipe when the cook asks (see ask.js)
//   POST /api/recipes/generate  write a classic recipe for a dish the cook names (generate.js)
//   GET  /api/recipes[/:id]   recipe list / one recipe (see recipes.js)
//   GET  /api/status          AI configuration and last Gemini warm-up (costs nothing)
//   GET  /*                   static files from PUBLIC_DIR, SPA fallback to index.html
//                             (/test.html is a browser page for trying /api/ask)

import { createReadStream, statSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { aiStatus, warmUpAi } from "./ai/gemini.js";
import { handleAsk } from "./ask.js";
import { handleGenerate } from "./generate.js";
import { sendJson } from "./http.js";
import { getRecipe, listRecipes } from "./recipes.js";

const PORT = Number(process.env.PORT ?? 8787);
const PUBLIC_DIR = resolve(
  process.env.PUBLIC_DIR ?? join(dirname(fileURLToPath(import.meta.url)), "../app/dist"),
);

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

const http = createServer((req, res) => {
  if (req.url === "/up") {
    res.writeHead(200, { "content-type": "text/plain" }).end("OK");
    return;
  }
  const path = (req.url ?? "/").split("?")[0];
  if (path === "/api/ask") {
    handleAsk(req, res).catch((err) => {
      console.error("ask crashed:", err);
      if (!res.headersSent) sendJson(res, 500, { error: "Server error" });
    });
    return;
  }
  if (path === "/api/recipes/generate") {
    handleGenerate(req, res).catch((err) => {
      console.error("generate crashed:", err);
      if (!res.headersSent) sendJson(res, 500, { error: "Server error" });
    });
    return;
  }
  if (path === "/api" || path.startsWith("/api/")) {
    if (req.method !== "GET" && req.method !== "HEAD") {
      sendJson(res, path.startsWith("/api/recipes") || path === "/api/status" ? 405 : 404, {
        error: "No such API route",
      });
      return;
    }
    if (path === "/api/status") {
      sendJson(res, 200, { ok: true, ai: aiStatus(), recipes: listRecipes().length });
      return;
    }
    if (path === "/api/recipes") {
      sendJson(res, 200, listRecipes());
      return;
    }
    const recipeId = path.match(/^\/api\/recipes\/([a-z0-9-]+)$/)?.[1];
    const recipe = recipeId && getRecipe(recipeId);
    if (recipe) {
      sendJson(res, 200, recipe);
      return;
    }
    sendJson(res, 404, { error: recipeId ? "No such recipe" : "No such API route" });
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

function shutdown() {
  http.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

http.listen(PORT, "0.0.0.0", () => {
  console.log(`cooking-buddy listening on :${PORT}, serving ${PUBLIC_DIR}`);
  warmUpAi();
});
