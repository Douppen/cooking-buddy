# Cooking Buddy

Hackathon project: hands-free recipe steps and answers on **Meta Ray-Ban Display** glasses,
driven by the **Meta Neural Band**. The user is cooking at home with messy hands, glasses on,
phone out of reach (but nearby: the glasses need their paired phone either way).

Live at https://cook.simonnars.com.

## The prototype: "Glance + ask"

Keep the glasses UI minimal. It's a glance at one line, not a phone screen on your face.

- **First, pick a recipe** (`/`): a "Recipes" list, one row per recipe. Recipes the AI wrote
  for this cook come first, then the library (`GET /api/recipes`; an edited one says "Your
  version"), then a last row, **"Cook something new"**. Pinch opens a row; the system Back
  gesture returns to the list.
- **Cook something new** (`/new`): the cook says a dish ("carbonara for 4") and the AI writes
  a classic recipe (`POST /api/recipes/generate`, ~6–8 s), then cooking starts.
- **Then cook** (`/cook/:id`). The HUD shows only the current step's instruction as one
  line, plus a small step counter ("3/6"). No header, ingredient list, panels or buttons.
- **Swipe** (`next` / `prev`) moves between steps. **Pinch** (`select`) on the ask field asks
  by voice through the glasses' dictation.
- **The answer briefly replaces the step** on the HUD and is read aloud, then the step comes
  back. The answer knows the recipe and the current step (`/api/ask`).
- **Saying "I don't have X" or "can I skip X" edits the recipe**: the AI makes the smallest
  change, rewrites the affected steps, and the HUD says "RECIPE UPDATED" with what changed
  (~6–8 s). The cook stays on the same step. "Do I need X?" answers, and marks X optional
  when the dish works without it.
- **Recipes the AI wrote or edited live on the device** (`localStorage`, see
  `app/src/recipeStore.ts`), not on the server. Editing a library recipe makes a device-only
  "Your version" under the same id; the server's recipe file never changes.

Nice to have, only once that works: timers per step, scaling servings, a way to reset an
edited recipe to the original. Add them without breaking the one-line rule.

App code: `main.tsx` (router), `RecipesContext.tsx` (server and saved recipes, kept across
screens), `recipeStore.ts` (device storage), `pages/` (one file per screen), `Cooking.tsx`
(the cooking screen), `cookingState.ts` (step, ask and edit logic, free of React: the spec
for the native port).

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
  short answer (plus the whole updated recipe when it changed it).
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

## AI (`/api/ask`, `/api/recipes/generate`)

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
  `{ answer, model, ms }`, plus `{ recipe, change_summary }` when the cook's words changed
  the recipe. Answers are 1–2 sentences, plain text, meant to be shown and spoken.
- **New recipes:** `POST /api/recipes/generate` with `{ request: "carbonara for 4" }` returns
  `{ recipe, model, ms }`: a classic recipe with `origin: "generated"` and a `gen-…` id. The
  server doesn't store it; the device does and sends it to `/api/ask` like any recipe.
- **Recipe format for the AI:** Gemini writes a "draft" (`RecipeDraftSchema`: no ids or step
  indexes) as structured JSON (`server/ai/recipeFormat.js`), and `toRecipe()` in
  `models/domain.js` turns it into a valid `Recipe`. Ingredients have `optional`; recipes
  have `origin` (`library` / `generated`) and `edits` (short notes on AI changes). Don't put
  `minItems`/`maxItems` in the Gemini schema: on both lists together Gemini rejects it as
  INVALID_ARGUMENT; Zod enforces list lengths instead.
- Typical times: a question 1.5–2.5 s, an edit 6–8.5 s (Gemini rewrites the whole recipe),
  a new recipe 6–8 s. The server warms up its Google token and connection at startup and
  every 15 minutes, because a cold first call took about 8 s. A backup request
  (`withBackup` in `server/ai/gemini.js`) covers Gemini's occasional stalls: after 10 s for
  `/api/ask`, 15 s for a new recipe.
- The endpoints are public and every call costs money: `/api/ask` is limited to 30 requests
  and `/api/recipes/generate` to 10 per minute per client IP (Cloudflare's
  `cf-connecting-ip`).

## Layout

```
app/      Glasses web app: React + Vite + @wearables-ui-toolkit/mrbd. Built to static files.
server/   Node server: serves app/dist, health at /up, API under /api (zod for validation).
          ask.js = /api/ask, generate.js = /api/recipes/generate, recipes.js = /api/recipes,
          http.js = shared request handling, ai/ = everything that calls Gemini (gemini.js =
          shared client, warm-up, withBackup; one file per task), models/domain.js = recipe
          schema, recipes/ = recipe JSON files, scaling.js = servings and units.
          Stateless: step state and AI-written recipes live in the app (server/README.md).
config/   Kamal deploy config.   .kamal/secrets reads secrets from the environment.
.github/  Deploy workflow and the pinned SSH host key of the server.
```

## Commands

```sh
cd server && npm install && npm start   # :8787, serves app/dist if built
cd app && npm run dev           # :5173, proxies /api to :8787
cd app && npm run build         # typecheck + production build
cd server && npm run smoke      # smoke test; add -- https://cook.simonnars.com for prod
cd server && npm test           # unit tests: recipes, scaling, prompts, AI drafts, validation
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
- Server-side step state was removed on 2026-11-14, since the app owns the step index
  (`app/src/cookingState.ts`): `server/session.js` (sessions, pub/sub, auto-advance after 2
  confident camera frames), `RecipeEngine` in `server/engine.js`, and the unused schemas
  `models/protocol.js` and `models/vision.js` (camera frame → step classification). For
  camera step detection in the native app, start from `git show 441e5ea:server/session.js`
  and `git show 441e5ea:server/models/vision.js`.
