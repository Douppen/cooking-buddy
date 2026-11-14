# Cooking Buddy

Hands-free recipe steps and answers on Meta Ray-Ban Display glasses, driven by the Neural
Band. Live at **https://cook.simonnars.com**.

1. The recipe on the glasses' display, one step per screen. Swipe or pinch to move between steps.
2. Ask about the recipe by voice ("how much butter?") and get a short answer that knows
   the current step.

## Layout

```
app/      React + Vite glasses web app (Meta UI Toolkit), built into static files.
server/   Node server: serves app/dist, the API under /api, health check at /up.
config/   Kamal deploy config (shared Hetzner VPS).
```

One container serves everything, so the app and its API share one origin. The plan is to
port the app to a native Meta glasses app later, reusing the same API. [CLAUDE.md](CLAUDE.md)
has the rules that keep that port cheap.

- **API, recipes and server internals:** [server/README.md](server/README.md)
- **Project rules and decisions** (AI setup, porting, deploy safety): [CLAUDE.md](CLAUDE.md)

## Develop

Needs Node 24+ (`nvm install && nvm use` reads [.nvmrc](.nvmrc)).

```sh
cd server && npm install && npm start     # :8787, serves app/dist if built
cd app && npm install && npm run dev      # :5173, proxies /api to :8787
```

Before pushing a server change: `cd server && npm test`, then `npm run build` in `app/`
and `npm run smoke` against a running server.

For AI answers locally, start the server with
`GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account-key.json`. Without credentials,
everything else still works. To try questions in a browser, open `/test.html`.

## Deploy

Push to `main` (Markdown-only changes don't deploy). GitHub Actions runs
`bundle exec kamal deploy`. The image is built (a broken app build stops the deploy here),
pushed to `ghcr.io/douppen/cooking-buddy` and pulled on the box. kamal-proxy then switches
`cook.simonnars.com` over once `/up` is healthy. It's live in about 75 s. There's no
separate test job, so run the checks above locally.

Repo secrets: `KAMAL_SSH_PRIVATE_KEY` (the `deploy` user key), `TLS_CERTIFICATE_PEM` and
`TLS_PRIVATE_KEY_PEM` (Cloudflare origin cert for simonnars.com), and
`GOOGLE_CREDENTIALS_B64` (base64 of the Google service account's JSON key).

Deploys swap the container, so an in-flight request can fail. Don't deploy during the demo.

### Infra facts

- Box: Hetzner VPS `46.224.236.167`, shared with two other apps behind one kamal-proxy.
  Its firewall only accepts 80/443 from Cloudflare, so `cook` must stay **Proxied**.
- DNS: `A cook → 46.224.236.167`, proxied, in the Cloudflare `simonnars.com` zone. SSL mode
  for this host must be Full (strict); Flexible causes a redirect loop.
- Container memory is capped at 256 MB.

## Operating (from a laptop with SSH access as `deploy`)

Export `KAMAL_REGISTRY_PASSWORD` (a GHCR personal access token) and the two TLS variables first.

| Situation         | Command                    |
| ----------------- | -------------------------- |
| Live logs         | `kamal app logs -f`        |
| Versions on box   | `kamal app containers`     |
| Roll back         | `kamal rollback <version>` |
| Stuck lock        | `kamal lock release`       |

**Never** run `kamal remove`, `kamal setup` or `kamal proxy reboot` here: they touch the
shared kamal-proxy and take the other apps on the box down with it.
