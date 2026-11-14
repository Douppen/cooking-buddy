# Cooking Buddy

Hackathon project: hands-free recipe steps and answers on **Meta Ray-Ban Display** glasses,
driven by the **Meta Neural Band**. The user is cooking at home with messy hands, glasses on,
phone out of reach (but nearby: the glasses need their paired phone either way).

Live at https://cook.simonnars.com.

## The prototype: "Glance + ask"

Keep the glasses UI simple: plain text lists you scroll, not a phone screen on your face.

- **Home** (`/`): one field at the bottom for a dish or food talk (`POST
  /api/recipes/generate`). A fast EU call sorts it first. Only a named dish ("lasagna",
  "the second one" after ideas, or "yes, do it" when one dish was offered) fetches a recipe; a kind of dish ("a simple middle
  eastern recipe") is food talk. A dish: the AI finds a real recipe on
  the web, converts it, and cooking starts. Food talk ("ideas for a light dinner", "what can
  I make with rice and eggs?"): a short answer (at most 30 words), read aloud, with up to 3
  dishes as rows ("Get the recipe") that ask for that recipe when pinched. Follow-ups work
  ("the second one"): the last 10 turns go along until a recipe opens. While an answer
  shows, the units switch, servings box and last-recipe row step aside so it fits 600×600.
  Anything not about food: "Let's keep it to food…". There is no recipe picker and no built-in recipes. Above the field, only
  the **most recent recipe** as one row ("Back to your recipe"), so a cook who left cooking
  by accident (system Back) pinches it to return. A new dish simply replaces it on top.
  Older recipes stay saved on the device (for a "previous recipes" list later) but aren't shown.
- **Servings:** a box at the bottom of home, styled like a list row ("‹ 2 servings ›",
  "Swipe left or right to change"), 2 by default each time home opens, 1 to 8. Only while
  it has focus, **swipe right** adds one and **swipe left** takes one away. The new recipe is
  scaled to it (see "Servings are the app's job" below). Focus order on home:
  last recipe, dish field, units switch, voice switch, servings.
- **Voice on or off:** a "Voice" switch next to "Imperial units" (same row, kept on the
  device, on by default). Off: answers on home and while cooking are text only (`speak()` in
  `app/src/speech.ts` does nothing).
- **Then cook** (`/cook/:id`): two views side by side. It opens on the **ingredients**
  (title, servings, one line per ingredient). **Swipe right** (`next`) shows **all the
  steps** in one list; swiping right again does nothing. **Swipe left** (`prev`) goes back
  to the ingredients, and no further. Swipe up/down scrolls the list; past its end, focus
  moves to the ask field.
- **Pinch** (`select`) on the ask field asks by voice through the glasses' dictation. The
  field sits under both views. Questions are about **the whole recipe**, not one step: the
  app sends no `step_index` to `/api/ask`.
- **The answer shows above the ask field** on either view for 15 s and is read aloud.
- **Saying "I don't have X", "can I skip X" or a command ("swap the butter for oil", "make it
  vegetarian") edits the recipe**: the AI makes the smallest change, gives swapped-in
  ingredients their own amounts, and rewrites the affected steps (names, amounts, times).
  There's no AI answer then: the server answers with the change summary ("Swapped butter
  for olive oil."), shown under "RECIPE UPDATED", and the app only says "Recipe updated"
  (~6–8 s). Both lists show the new recipe; the cook stays on the
  same view. "Do I need X?" answers, and marks X optional when the dish works without it.
- **Metric or imperial** (a small "Imperial units" switch on `/` between the dish field and the servings, label and toggle only, no row box; kept on the device): every recipe
  stays stored in metric; the app shows amounts in oz/lb/tsp/tbsp/cups and converts °C,
  g, ml and cm in step text (`app/src/units.ts`). `/api/ask` gets `unit_system` so answers
  match. Small amounts (salt, spices, leaveners, extracts, and any liquid under 50 ml, e.g. 15 ml oil → 1 tbsp) are stored in `tsp`/`tbsp`, or
  `pinch` for 1–2 pinches only, and look the same in both systems: tsp in quarters, tbsp in
  halves, 3+ tsp shown as tbsp, more than 2 pinches as tsp. `spoons()` in `app/src/units.ts`
  and `server/scaling.js` share these rules: change both together.
- **Recipes live on the device** (`localStorage`, see `app/src/recipeStore.ts`), not on the
  server. An edit replaces the saved recipe under the same id.

Nice to have, only once that works: timers per step, scaling servings, undoing an edit.
Keep them as plain text in the two lists.

App code: `main.tsx` (router), `RecipesContext.tsx` (the recipes saved on this device, kept
across screens), `recipeStore.ts` (device storage), `pages/` (one file per screen),
`Cooking.tsx` (the cooking screen), `cookingState.ts` (view, ask and edit logic, free of
React: the spec for the native port).

## The plan: web app now, native app later

- **Now:** a Meta Ray-Ban Display **Web App** (React + Meta UI Toolkit), the fastest way to
  build for the hackathon.
- **Later:** an agent ports it to a **native app** built on Meta's Wearables Device Access
  Toolkit: an iOS (Swift) / Android (Kotlin) phone app that drives the glasses' display,
  camera, microphone and speakers over Bluetooth. The main reason is camera access, which
  web apps don't get.

Build everything so that port is cheap:

- **Brains on the server, thin client.** Writing and editing recipes (structured JSON),
  scaling servings and AI answers live in `server/` behind plain JSON HTTP endpoints under
  `/api`. The native app will call the same endpoints. The web app only renders the current
  screen, keeps the cook's recipes, and sends user actions. `/api/ask` takes the recipe and
  the question (and optionally a step), and returns a short answer (plus the whole updated
  recipe when it changed it).
- **Design screens for the native display.** Native apps re-send the whole screen on
  every update over Bluetooth (no partial updates), at 600×600, built from text, images,
  buttons, lists and flex boxes. So: two plain views per recipe (ingredients, steps),
  simple layouts, small images, and nothing that updates every second (show "done at 15:42" or update once a minute
  rather than a ticking countdown).
- **Input as actions, not keys.** On the web, `ArrowLeft` / `ArrowRight` / `Enter` map to
  `prev` / `next` / `select` (`ArrowUp` / `ArrowDown` scroll, through the toolkit's focus
  navigation). Native touchpad and Neural Band events will map to the same
  actions. Keep step and state logic in plain TypeScript, free of React and the DOM, so it
  reads like a spec for the Swift/Kotlin version.
- **Voice is text in, text out.** The web app gets text from the glasses' dictation
  composer; the native app will transcribe mic audio on the phone before calling the same
  `/api/ask`. Audio files never go to the AI.
- **No web-only tricks in core flows** (custom animations, canvas UIs, heavy CSS effects).
  They have no native equivalent.
- Record anything web-specific that a port must rethink under "Porting notes" below.

## AI (`/api/ask`, `/api/recipes/generate`)

- **Gemini on Google Cloud, EU only, except recipe search.** One model for everything,
  `gemini-3.5-flash-lite`, the fastest (set `GEMINI_MODEL`; the previous model was
  `gemini-4-hydrogen`, smarter but slower), location `eu` (the EU multi-region
  endpoint `aiplatform.eu.rep.googleapis.com`), reasoning level `LOW` for speed. Project
  `junction-2026-514714`.
- **The exception, on purpose:** finding a recipe on the web uses Gemini's Google Search
  tool, which Google keeps out of its data residency commitment on every endpoint
  ("Supported capabilities" in the Agent Platform docs) and logs for up to 3 days. This is a
  hackathon project, not production, so we accept that for recipe search only: it runs on
  the `global` endpoint (`GEMINI_SEARCH_LOCATION`) with the same model (`GEMINI_SEARCH_MODEL` can
  override it). The prompt names no example website, so it doesn't favour one.
  `/api/ask` and the fallback recipe writer stay in the EU. Don't "fix" this back without a replacement for web search.
- **Auth is a service account key, not an API key.** Agent Platform API keys only reach the
  global endpoint, so they can't keep processing in the EU. The service account is
  `cooking-buddy@junction-2026-514714.iam.gserviceaccount.com` with the "Agent Platform
  User" role. In production its JSON key arrives base64-encoded as `GOOGLE_CREDENTIALS_B64`
  (base64 because Kamal's env files double backslashes and would break the JSON). Locally,
  point `GOOGLE_APPLICATION_CREDENTIALS` at the JSON key file.
- **Request:** `{ recipe, question, step_index?, servings?, unit_system?, image? }`, where `recipe` matches
  `RecipeSchema` in `server/models/domain.js` and `image` is `{ mime_type, data }` with
  base64 data (JPEG/PNG/WebP; shrink photos to about 1 megapixel first). Without
  `step_index` the answer covers the whole recipe; the web app never sends one. **Response:**
  `{ answer, model, ms }`, plus `{ recipe, change_summary }` when the cook's words changed
  the recipe. Answers are 1–2 sentences, plain text, meant to be shown and spoken.
- **New recipes:** `POST /api/recipes/generate` with `{ request: "carbonara" }` first sorts
  the request (EU, no search, `sortRequest()` in `server/ai/generate.js`; food talk gets its
  answer from this call), then for a named dish returns `{ kind: "recipe", recipe,
  found_online, model, ms }`. Gemini searches the web, picks one well-reviewed
  recipe and rewrites it in our format ; `recipe.source` is the website it used,
  e.g. `{ name: "seriouseats.com" }`. There's no link: with our JSON output format Google
  returns its search queries but not the pages, so `found_online` means Google reported a
  search. If the search fails, Gemini writes the classic version itself (`found_online:
  false`, `source: null`).
  Requests that aren't about food ("write me a poem", gibberish, inedible things) get `422
  { error, not_a_recipe: true }` instead of a recipe: the sorting call decides, before any
  search, and the app shows the server's message. `GET /api/status` shows how the last
  search went. The server stores nothing; the device
  keeps the recipe and sends it to `/api/ask` like any recipe. Edits keep the source.
- **Servings are the app's job, and the setting always wins:** a number in the request
  ("lasagna for 3") is ignored on purpose. A new recipe keeps its source's servings (`base_servings`).
  The servings the cook picked on home are saved on the recipe as `servings` (kept through
  edits). The cooking screen scales the ingredient list and the amounts in step text
  (`scaleAmountsInText()`: numbers with a unit or a counted ingredient, not times or sizes)
  with the same tidy rounding as stored amounts (`cleanAmount()`, spoons under 50 ml), in
  `app/src/units.ts` and `server/scaling.js`. `/api/ask` answers for `recipe.servings`.
- **Counts:** counted ingredients (`base_unit: "unit"`) have `whole`: true for things that
  only come whole (eggs, garlic cloves, bay leaves; set by the AI, and always for a fixed
  list), shown as whole numbers, at least 1. Others (lime, onion) round to halves, at
  least ½. Same in the list, scaled step text and answers.
- **Recipe format for the AI:** Gemini writes a "draft" (`RecipeDraftSchema`: no ids or step
  indexes) as structured JSON (`server/ai/recipeFormat.js`), and `toRecipe()` in
  `models/domain.js` turns it into a valid `Recipe`. Ingredients have `optional`; recipes
  have `origin` (`generated`; `library` only on recipes saved before the built-in ones were
  removed) and `edits` (short notes on AI changes). Don't put
  `minItems`/`maxItems` in the Gemini schema: on both lists together Gemini rejects it as
  INVALID_ARGUMENT; Zod enforces list lengths instead.
- Typical times (measured on `gemini-4-hydrogen`; flash-lite should be faster): a question 1.5–2.5 s, an edit 6–8.5 s (Gemini rewrites the whole recipe),
  a new recipe 6–8 s. The server warms up its Google token and connection at startup and
  every 15 minutes, because a cold first call took about 8 s. A backup request
  (`withBackup` in `server/ai/gemini.js`) covers Gemini's occasional stalls: after 10 s for
  `/api/ask`, 15 s for a new recipe.
- The endpoints are public and every call costs money: `/api/ask` is limited to 30 requests
  and `/api/recipes/generate` to 20 per minute per client IP (Cloudflare's
  `cf-connecting-ip`).

## Layout

```
app/      Glasses web app: React + Vite + @wearables-ui-toolkit/mrbd. Built to static files.
server/   Node server: serves app/dist, health at /up, API under /api (zod for validation).
          ask.js = /api/ask, generate.js = /api/recipes/generate, http.js = shared request
          handling, ai/ = everything that calls Gemini (gemini.js = shared client, warm-up,
          withBackup; one file per task), models/domain.js = recipe schema, scaling.js =
          servings and units, fixtures/ = a test recipe for npm test and npm run ask.
          Stateless, no recipes: the app keeps the cook's recipes (server/README.md).
config/   Kamal deploy config.   .kamal/secrets reads secrets from the environment.
.github/  Deploy workflow and the pinned SSH host key of the server.
```

## Commands

```sh
cd server && npm install && npm start   # :8787, serves app/dist if built
cd app && npm run dev           # :5173, proxies /api to :8787
cd app && npm run build         # typecheck + production build
cd app && npm test              # unit conversion tests (node --test, no browser)
cd server && npm run smoke      # smoke test; add -- https://cook.simonnars.com for prod
cd server && npm test           # unit tests: scaling, prompts, AI drafts, validation
cd server && npm run ask        # real questions through /api/ask (calls Gemini, costs ~nothing)
                                #   add -- https://cook.simonnars.com, or --image photo.jpg
```

Testing the AI in a browser (also in production): open `/test.html`
(https://cook.simonnars.com/test.html). It's a plain dev page, not glasses UI: write a recipe
or pick one saved in this browser (same storage as the app), ask about the whole recipe or
one step, optionally add a phone photo, and see the answer and timings. `GET /api/status` shows whether Gemini is configured and reachable without
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

- Home (`app/src/pages/HomePage.tsx`, 2026-11-14) is built to fit 600×600 with no scrolling:
  last recipe row, dish field, units switch, servings box. The toolkit's slider `ListItem`
  hides its title, so the servings box is a toolkit `Container` that takes left/right
  itself while focused. Native: a focusable row that handles left/right swipes. The units
  and voice switches are toolkit `Switch`es in `Container`s whose surface only shows when
  focused. Speech is the browser's `speechSynthesis`; native uses the phone's TTS.
- The cooking screen (since 2026-11-14) is two views: ingredients, then all steps, each a
  vertical list. On the web, the toolkit `Pager` slides between them and its focus
  navigation scrolls a focused `ScrollView` about 60 px per up/down swipe, then moves focus
  to the ask field. Native: two screens switched by swipe left/right, each a scrolling list
  (check how far the native list scrolls per swipe); the slide is optional. The earlier
  one-step HUD with a step counter is in commit `cbecf34` (`app/src/cookingState.ts`).
- Built-in library recipes (`server/recipes/*.json`, `GET /api/recipes[/:id]`, the "Your
  version" label) were removed on 2026-11-14: every recipe is AI-written and kept on the
  device. To bring back a curated library, start from `git show cbecf34:server/recipes.js`.

- A WebSocket relay with rooms (glasses ↔ phone camera page) was removed on 2026-11-14:
  the native phone app makes it unnecessary. If a live demo screen for judges or a remote
  debug console is ever needed, restore it from git history: `git log -- app/src/relay.ts` (last version in commit `ff8963c`).
- Server-side step state was removed on 2026-11-14, since the app owns the step index
  (`app/src/cookingState.ts`): `server/session.js` (sessions, pub/sub, auto-advance after 2
  confident camera frames), `RecipeEngine` in `server/engine.js`, and the unused schemas
  `models/protocol.js` and `models/vision.js` (camera frame → step classification). For
  camera step detection in the native app, start from `git show 441e5ea:server/session.js`
  and `git show 441e5ea:server/models/vision.js`.
