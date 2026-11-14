// Smoke test against a running server: node smoke.js [ws://localhost:8787]
//   npm run smoke -- wss://cook.simonnars.com
import WebSocket from "ws";

const base = process.argv[2] ?? "ws://localhost:8787";
const httpBase = base.replace(/^ws/, "http");
// Must be in the deployed ALLOWED_ORIGINS (config/deploy.yml) for prod smoke runs.
const origin = "http://localhost:5173";

const up = await fetch(`${httpBase}/up`);
if (!up.ok) throw new Error(`/up returned ${up.status}`);

const shell = await fetch(`${httpBase}/some/client/route`);
const html = await shell.text();
if (!shell.ok || !html.includes('id="root"')) {
  throw new Error(`app shell not served (status ${shell.status})`);
}

const open = () => new Promise((resolve, reject) => {
  const ws = new WebSocket(`${base}/ws?room=TEST42`, { headers: { origin } });
  ws.once("open", () => resolve(ws));
  ws.once("error", reject);
});

const glasses = await open();
const phone = await open();

const got = new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error("phone never got snap")), 3000);
  phone.on("message", (raw) => {
    const msg = JSON.parse(raw.toString());
    if (msg.t === "snap") { clearTimeout(timer); resolve(msg); }
  });
});
glasses.send(JSON.stringify({ t: "snap", question: "is the onion done?" }));
console.log("phone received:", await got);

const rejected = await new Promise((resolve) => {
  const ws = new WebSocket(`${base}/ws?room=bad!`, { headers: { origin } });
  ws.once("error", () => resolve(true));
  ws.once("open", () => resolve(false));
});
if (!rejected) throw new Error("invalid room was accepted");

glasses.close();
phone.close();
console.log("smoke OK");
