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
console.log("smoke OK");
