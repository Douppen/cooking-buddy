// Smoke test against a running server: node smoke.js [http://localhost:8787]
//   npm run smoke -- https://cook.simonnars.com
const base = process.argv[2] ?? "http://localhost:8787";

const check = async (label, path, ok) => {
  const res = await fetch(`${base}${path}`);
  const body = await res.text();
  if (!ok(res, body)) throw new Error(`${label}: ${path} returned ${res.status}`);
  console.log(`ok  ${label}`);
};

await check("health", "/up", (res, body) => res.ok && body === "OK");
await check("app shell", "/", (res, body) => res.ok && body.includes('id="root"'));
await check("client route falls back to shell", "/some/client/route",
  (res, body) => res.ok && body.includes('id="root"'));
await check("missing asset is 404", "/nope.js", (res) => res.status === 404);

// API checks that never reach the model, so they cost nothing.
const post = (path, body) =>
  fetch(`${base}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
const ask405 = await fetch(`${base}/api/ask`);
if (ask405.status !== 405) throw new Error(`GET /api/ask returned ${ask405.status}, expected 405`);
console.log("ok  GET /api/ask is 405");
const ask400 = await post("/api/ask", { question: "how much butter?" });
const ask400Body = await ask400.json();
if (ask400.status !== 400 || !ask400Body.issues?.length) {
  throw new Error(`invalid /api/ask returned ${ask400.status}, expected 400 with issues`);
}
console.log("ok  invalid /api/ask is 400");
const api404 = await post("/api/nope", {});
if (api404.status !== 404) throw new Error(`/api/nope returned ${api404.status}, expected 404`);
console.log("ok  unknown API route is 404");
const gen405 = await fetch(`${base}/api/recipes/generate`);
if (gen405.status !== 405) throw new Error(`GET /api/recipes/generate returned ${gen405.status}, expected 405`);
console.log("ok  GET /api/recipes/generate is 405");
const home400 = await post("/api/home", { request: "" });
if (home400.status !== 400) throw new Error(`empty home request returned ${home400.status}, expected 400`);
console.log("ok  empty home request is 400");
const gen400 = await post("/api/recipes/generate", { dish: "" });
if (gen400.status !== 400) throw new Error(`empty generate request returned ${gen400.status}, expected 400`);
console.log("ok  empty generate request is 400");
console.log("smoke OK");
