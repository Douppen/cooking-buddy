# Cooking Buddy server

Backend for Cooking Buddy on Meta Ray-Ban Display glasses. It serves the glasses web app,
holds the recipes and the recipe logic (scaling, unit conversion, step state), and answers
questions about the current step with Gemini. The glasses app stays thin so a future native
app can call the same endpoints (see the repo's `CLAUDE.md`). For running the whole project
and deploying, see the [root README](../README.md).

Plain Node (`node:http`), ESM, no framework. Validation with Zod. Dependencies: `zod` and
`@google/genai`.

---

## Run it

Needs **Node 24+** (`engines` in `package.json`; the Docker image uses `node:24`). With nvm,
`nvm install && nvm use` in the repo root picks it up from `.nvmrc`.

```sh
npm install
npm start                    # :8787, serves ../app/dist if it's built
npm test                     # unit tests, no server and no Gemini needed
npm run smoke                # HTTP checks against a running server (needs app/dist built)
npm run smoke -- https://cook.simonnars.com
npm run ask                  # real questions through /api/ask (calls Gemini, costs ~nothing)
npm run ask -- --image photo.jpg
```

Without Google credentials the server still starts. Everything works except
`POST /api/ask`, which answers 503.

### Environment

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `8787` | Listen port |
| `PUBLIC_DIR` | `../app/dist` | Built glasses app to serve (`/srv/public` in Docker) |
| `GOOGLE_APPLICATION_CREDENTIALS` | none | Local dev: path to the service account JSON key |
| `GOOGLE_CREDENTIALS_B64` | none | Production: base64 of that JSON key (wins if both are set) |
| `GEMINI_MODEL` | `gemini-4-hydrogen` | Fallback model: `gemini-3.8-flash` |
| `GEMINI_LOCATION` | `eu` | Google Cloud location; keep it in the EU |

---

## Directory tree

```text
server/
├── ai/                # Everything that calls Gemini
│   ├── gemini.js      # Shared client: credentials, EU location, warm-up, /api/status info
│   └── answer.js      # /api/ask: system prompt, recipe as text, the Gemini call
├── models/
│   ├── domain.js      # Recipe, ingredient and step schemas (Zod)
│   ├── protocol.js    # HUD sync / control message schemas (Zod), from the removed relay
│   ├── vision.js      # Step classification result for camera frames (Zod, not used yet)
│   └── index.js       # Barrel export for models
├── recipes/           # Recipe JSON files, validated against RecipeSchema at startup
├── engine.js          # Pure math: scaling, unit conversion, HUD formatting
├── session.js         # In-memory cooking session state machine + pub/sub (not wired up yet)
├── recipes.js         # Loads recipes/, GET /api/recipes and /api/recipes/:id
├── ask.js             # POST /api/ask: validation, rate limit, errors; calls ai/answer.js
├── http.js            # sendJson, readBody, clientIp, per-IP rate limiter
├── server.js          # HTTP server: routes, static app files, /up health check
├── unit.test.js       # npm test: engine, session, recipes and request validation
├── smoke.js           # npm run smoke: HTTP checks against a running server
├── ask-check.js       # npm run ask: real questions through /api/ask (calls Gemini)
└── package.json
```

---

## Endpoints

| Route | What it does |
| --- | --- |
| `GET /up` | Health check for Kamal and Docker, answers `OK` |
| `GET /api/status` | `{ ok, ai: { configured, model, location, last_warm_up }, recipes }`. Free: never calls the model |
| `GET /api/recipes` | `[{ recipe_id, title, base_servings, step_count }]` |
| `GET /api/recipes/:id` | One full recipe (matches `RecipeSchema`), or 404 |
| `POST /api/ask` | `{ recipe, step_index, question, servings?, image? }` → `{ answer, model, ms }` |
| `GET /*` | The built glasses app; unknown paths without an extension get `index.html`, missing assets 404. `/test.html` is a browser page for trying `/api/ask` |

All JSON responses are sent with `cache-control: no-store`. Errors are `{ error }`.

### `POST /api/ask` in detail

- `recipe`: the full recipe object (the client sends it, so the server needs no session).
- `step_index`: 0-based and must be less than `recipe.steps.length`.
- `question`: 1–500 characters after trimming.
- `servings`: integer from 1 to 100, default `recipe.base_servings`.
- `image`: `{ mime_type: "image/jpeg" | "image/png" | "image/webp", data }`, where `data` is
  plain base64 with no `data:` prefix. Shrink photos to about 1 megapixel first. The body
  limit is 3 MB.

| Status | When |
| --- | --- |
| 200 | `{ answer, model, ms }`: 1–2 plain-text sentences, at most about 30 words |
| 400 | Not JSON, or fails validation (`issues: [{ path, message }]`) |
| 405 / 415 / 413 | Not POST / not `application/json` / body over 3 MB |
| 429 | More than 30 requests in a minute from one client IP (`cf-connecting-ip`) |
| 502 | Gemini failed or timed out (20 s) |
| 503 | No Google credentials configured |

---

## Adding a recipe

Drop a JSON file in `recipes/` that matches `RecipeSchema` (`models/domain.js`). See
`buttermilk-pancakes.json`. Rules:

- `recipe_id` is lowercase letters, digits and dashes (the `/api/recipes/:id` route only
  matches `[a-z0-9-]+`).
- Amounts are for `base_servings`, in `g`, `ml` or `unit` (a count, such as eggs).
- Steps have an `index`, a short `title`, an `instruction` of about 15 words or fewer for the
  HUD, optional `visual_cues` and an optional `timer_sec`.

Files are validated at startup. An invalid recipe stops the server, so it fails the deploy's
health check instead of failing on a user. `npm test` catches it first.

---

## File responsibilities

### `models/` (data contracts)

Runtime schemas in **Zod** for payloads entering or leaving the backend.

- **`domain.js`**: normalized recipes: base metric units (`g`, `ml`, `unit`), substitutions,
  short step instructions, visual cues and timers.
- **`protocol.js`**: tagged `{ t, ... }` messages written for the WebSocket relay, which was
  removed (see "Porting notes" in `CLAUDE.md`). Only `HudSyncMessageSchema` is still used,
  by `engine.js` to validate its HUD state.
- **`vision.js`**: result shape for classifying a camera frame into a recipe step (for the
  native app, which gets camera access).

### `engine.js` (stateless computation)

Pure functions with no side effects: `scaleIngredients()` and `convertUnitSystem()` (metric
or imperial, with practical cooking rounding: oz/lbs for grams, fl oz/cups for millilitres,
counts unchanged), plus `RecipeEngine`, which wraps a recipe with servings, units and the
active step and produces the HUD state. Its navigation stops at the last step.

### `session.js` (session state machine)

In-memory cooking sessions (`RecipeSession`, `SessionStore`): current step, scale factor,
unit system, completed steps and recent camera classifications. `getView()` builds the HUD
view with `engine.js`. Unlike `RecipeEngine`, `nextStep()` on the last step moves past it
and the view reports `isFinished`. A debounce gate auto-advances only after 2 consecutive
frames with confidence >= 0.8. Subscribers are notified on every change, and idle sessions
are removed after 4 hours. Not wired to any endpoint yet.

### `recipes.js` (recipe store)

Reads and validates every `recipes/*.json` once at startup and keeps them in memory.

### `ai/` (everything that calls Gemini)

One shared client, one file per AI task. Gemini handles both text and images, so camera
step detection (`vision.js`) and any LLM command parsing would be new files here using the
same client. Speech-to-text is not here: the device transcribes, and the server only gets
text.

- **`gemini.js`**: creates the client from the service account key (EU location, 20 s
  timeout), returns `null` without credentials, warms up the Google token and connection at
  startup and every 15 minutes with the free `countTokens` call (a cold first question took
  about 8 s instead of about 2 s), and reports `aiStatus()` for `/api/status`. Credentials
  and region details are in `CLAUDE.md` under "AI".
- **`answer.js`**: `answerQuestion()` builds the prompt (`recipeContext()`: amounts scaled to
  the requested servings, substitutes, the current step marked) and asks Gemini with
  reasoning level `LOW` for a 1–2 sentence answer.

### `ask.js` (POST /api/ask)

The HTTP side of answers: content type and size checks, the per-IP rate limit (30 a
minute), Zod validation (`AskRequestSchema`), then `ai/answer.js`, mapping failures to the
status codes above.

### `http.js` (shared helpers)

`sendJson()`, `readBody()` with a size limit, `clientIp()` (Cloudflare's
`cf-connecting-ip` first) and `createRateLimiter()`.

### `server.js` (HTTP)

Routes `/api/*`, serves the built app (long caching for fingerprinted `/assets/`,
`no-cache` for everything else), falls back to `index.html` for client routes, and shuts
down cleanly on SIGTERM.
