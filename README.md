# Cooking Buddy

Hands-free recipe steps and answers on Meta Ray-Ban Display glasses, driven by the Neural
Band. Live at **https://cook.simonnars.com**.

```
app/      React + Vite glasses web app (Meta UI Toolkit). Built into static files.
server/   Node server: serves app/dist, health at /up, API under /api.
config/   Kamal deploy config (shared Hetzner VPS).
```

One container serves everything, so the app and its API share one origin. The plan is to
port this to a native Meta glasses app later; see [CLAUDE.md](CLAUDE.md) for what that
means for how we build.

## Develop

```sh
cd server && npm install && npm start     # :8787 (serves app/dist if built)
cd app && npm install && npm run dev      # :5173, proxies /api to :8787
```

Smoke test a running server: `cd server && npm run smoke` (or `-- https://cook.simonnars.com`).

## Deploy

Push to `main` (Markdown-only changes don't deploy). GitHub Actions runs
`bundle exec kamal deploy`: the image is built (a broken app build stops here), pushed to
`ghcr.io/douppen/cooking-buddy`, the box pulls it, and kamal-proxy switches
`cook.simonnars.com` over once `/up` is healthy. There's no separate test job, so run
`npm run smoke` locally when you touch the server.

Repo secrets: `KAMAL_SSH_PRIVATE_KEY` (the `deploy` user key), `TLS_CERTIFICATE_PEM` and
`TLS_PRIVATE_KEY_PEM` (Cloudflare origin cert for simonnars.com).

Deploys swap the container, so an in-flight request can fail. Don't deploy during the demo.

### Infra facts

- Box: Hetzner VPS `46.224.236.167`, shared with two other apps behind one kamal-proxy.
  Its firewall only accepts 80/443 from Cloudflare, so `cook` must stay **Proxied**.
- DNS: `A cook → 46.224.236.167`, proxied, in the Cloudflare `simonnars.com` zone. SSL mode
  for this host must be Full (strict); Flexible causes a redirect loop.
- Container memory capped at 256 MB.

## Operating (from a laptop with SSH access as `deploy`)

Export `KAMAL_REGISTRY_PASSWORD` (a GHCR PAT) and the two TLS vars first.

| Situation         | Command                    |
| ----------------- | -------------------------- |
| Live logs         | `kamal app logs -f`        |
| Versions on box   | `kamal app containers`     |
| Roll back         | `kamal rollback <version>` |
| Stuck lock        | `kamal lock release`       |

**Never** run `kamal remove`, `kamal setup` or `kamal proxy reboot` here: they touch the
shared kamal-proxy and take the other apps on the box down with it.
