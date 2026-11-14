# Cooking Buddy

Hackathon project: hands-free recipe steps and answers on **Meta Ray-Ban Display** glasses,
driven by the **Meta Neural Band**. The user is cooking at home with messy hands, glasses on,
phone out of reach (but nearby: the glasses need their paired phone either way).

Live at https://cook.simonnars.com.

## Features (build top-down, finish one before starting the next)

1. Recipe on the HUD, one step per screen. Neural Band swipe/pinch moves between steps.
2. Ask about the recipe by voice ("how much butter?", "what can I use instead of
   buttermilk?") and get a short spoken + on-screen answer that knows the current step.

Nice to have, only after 1 and 2 work: timers per step, scaling servings, choosing from a
few recipes.

## The plan: web app now, native app later

- **Now:** a Meta Ray-Ban Display **Web App** (React + Meta UI Toolkit), the fastest way to
  build for the hackathon.
- **Later:** an agent ports it to a **native app** built on Meta's Wearables Device Access
  Toolkit: an iOS (Swift) / Android (Kotlin) phone app that drives the glasses' display,
  camera, microphone and speakers over Bluetooth. The main reason is camera access, which
  web apps don't get.

Build everything so that port is cheap:

- **Brains on the server, thin client.** Recipes (structured JSON), scaling servings and AI
  answers live in `server/` behind plain JSON HTTP endpoints under `/api`. The native app
  will call the same endpoints. The web app only renders the current screen and sends user
  actions. `/api/ask` takes the recipe, the current step and the question, and returns a
  short answer.
- **Design screens for the native display.** Native apps re-send the whole screen on
  every update over Bluetooth (no partial updates), at 600×600, built from text, images,
  buttons, lists and flex boxes. So: one step per screen, simple layouts, small images,
  and nothing that updates every second (show "done at 15:42" or update once a minute
  rather than a ticking countdown).
- **Input as actions, not keys.** On the web, `ArrowLeft` / `ArrowRight` / `Enter` map to
  `prev` / `next` / `select`. Native touchpad and Neural Band events will map to the same
  actions. Keep step and state logic in plain TypeScript, free of React and the DOM, so it
  reads like a spec for the Swift/Kotlin version.
- **Voice is text in, text out.** The web app gets text from the glasses' dictation
  composer; the native app will transcribe mic audio on the phone before calling the same
  `/api/ask`. Audio files never go to the AI.
- **No web-only tricks in core flows** (custom animations, canvas UIs, heavy CSS effects).
  They have no native equivalent.
- Record anything web-specific that a port must rethink under "Porting notes" below.

## AI (`/api/ask`)

- **Gemini on Google Cloud, EU only.** Model `gemini-4-hydrogen` (fallback:
  `gemini-3.8-flash`, set `GEMINI_MODEL`), location `eu` (the EU multi-region endpoint
  `aiplatform.eu.rep.googleapis.com`), reasoning level `LOW` for speed. Project
  `junction-2026-514714`.
- **Auth is a service account key, not an API key.** Agent Platform API keys only reach the
  global endpoint, so they can't keep processing in the EU. The service account is
  `cooking-buddy@junction-2026-514714.iam.gserviceaccount.com` with the "Agent Platform
  User" role. In production its JSON key arrives base64-encoded as `GOOGLE_CREDENTIALS_B64`
  (base64 because Kamal's env files double backslashes and would break the JSON). Locally,
  point `GOOGLE_APPLICATION_CREDENTIALS` at the JSON key file.
- **Request:** `{ recipe, step_index, question, servings?, image? }`, where `recipe` matches
  `RecipeSchema` in `server/models/domain.js` and `image` is `{ mime_type, data }` with
  base64 data (JPEG/PNG/WebP; shrink photos to about 1 megapixel first). **Response:**
  `{ answer, model, ms }`. Answers are 1–2 sentences, plain text, meant to be shown and
  spoken.
- Typical answer time is 1.5–2.5 s. The server warms up its Google token and connection
  at startup and every 15 minutes, because a cold first call took about 8 s.
- The endpoint is public and every call costs money, so it's limited to 30 requests per
  minute per client IP (taken from Cloudflare's `cf-connecting-ip`).

## Layout

```
app/      Glasses web app: React + Vite + @wearables-ui-toolkit/mrbd. Built to static files.
server/   Node server: serves app/dist, health at /up, API under /api (zod for validation).
          ask.js = /api/ask, recipes.js = /api/recipes, http.js = shared HTTP helpers,
          ai/ = everything that calls Gemini (gemini.js = shared client, warm-up, status;
          one file per task, e.g. answer.js for /api/ask), models/ = schemas,
          recipes/ = recipe JSON files, engine.js / session.js = recipe logic (server/README.md).
config/   Kamal deploy config.   .kamal/secrets reads secrets from the environment.
.github/  Deploy workflow and the pinned SSH host key of the server.
```

## Commands

```sh
cd server && npm install && npm start   # :8787, serves app/dist if built
cd app && npm run dev           # :5173, proxies /api to :8787
cd app && npm run build         # typecheck + production build
cd server && npm run smoke      # smoke test; add -- https://cook.simonnars.com for prod
cd server && npm test           # unit tests: engine, session, recipes, request validation
cd server && npm run ask        # real questions through /api/ask (calls Gemini, costs ~nothing)
                                #   add -- https://cook.simonnars.com, or --image photo.jpg
```

Testing the AI in a browser (also in production): open `/test.html`
(https://cook.simonnars.com/test.html). It's a plain dev page, not glasses UI: pick a recipe,
step and servings, ask a question, optionally add a phone photo, and see the answer and
timings. `GET /api/status` shows whether Gemini is configured and reachable without
spending anything.

To run `/api/ask` locally: `GOOGLE_APPLICATION_CREDENTIALS=/path/to/key.json npm start`.

Deploy = push to `main`. It's live in about 75 s. Markdown-only pushes don't deploy.
There is no CI test job: the Docker build fails on a broken app build, and kamal-proxy only
switches over when `/up` is healthy. Run the smoke test locally when you change the server.

## Glasses web app rules

- Use the `meta-wearables-webapp` plugin skills (enabled in `.claude/settings.json`):
  `ai-glasses-webapp-build` + `ai-glasses-webapp-ui` for UI work, `ai-glasses-webapp-device`
  for Neural Band and dictation input, `ai-glasses-webapp-test` before handing off.
- Never use `ai-glasses-webapp-publish` or Vercel. Production is our own server.
- Use UI Toolkit components and keep the toolkit structure validator passing.
- The display is additive: black is transparent, so keep the dark window background.

## Deploy and the shared server

- Kamal deploys one container to a Hetzner VPS shared with two other apps, behind one
  shared kamal-proxy that routes by hostname.
- **Never** run `kamal remove`, `kamal setup` or `kamal proxy reboot` from this repo. They
  touch the shared proxy and take the other apps down too.
- Deploys swap the container. Don't deploy during the demo.
- `cook.simonnars.com` must stay **Proxied** in Cloudflare (the server only accepts web
  traffic from Cloudflare), with SSL mode Full (strict).
- Container memory is capped at 256 MB.
- Secrets live only in GitHub repo secrets (`KAMAL_SSH_PRIVATE_KEY`,
  `TLS_CERTIFICATE_PEM`, `TLS_PRIVATE_KEY_PEM`, `GOOGLE_CREDENTIALS_B64`). Never commit
  secrets: Google automatically disables service account keys it finds in public code.

## Porting notes

- A WebSocket relay with rooms (glasses ↔ phone camera page) was removed on 2026-11-14:
  the native phone app makes it unnecessary. If a live demo screen for judges or a remote
  debug console is ever needed, restore it from git history: `git log -- app/src/relay.ts` (last version in commit `ff8963c`).
