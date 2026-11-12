# shopable-video

A public Shopify app for shoppable videos (carousels, stories, pop-ups and a swipe player with add to cart), built for parity with Whatmore, Moast and Reelfy.

## Start here

Read `docs/plan.md` before any work. It holds the v1 scope (45 numbered features), the architecture, the data model, the interfaces, the milestones with done criteria, the Shopify limits and the open decisions. Work milestone by milestone, in order.

## Layout

| Path | What |
| --- | --- |
| `app/` | App server and admin UI (React Router, Polaris web components). Routes stay thin and call `@sv/core` |
| `packages/shared` | Types and pure logic shared by every side, including the storefront bundle: `SvEvent`, plans and `Entitlements`, widget settings, show rules, translations, Shopify data names. No Node or DB imports |
| `packages/core` | Server-side domain logic used by the app and the worker: Prisma client, Shopify client, job queue, library, tagging, widgets, Publisher, analytics, imports |
| `services/worker` | Job runner on the Postgres queue, plus the recurring-job scheduler |
| `services/ingest` | Receives event batches from the web pixel |
| `extensions/sv-theme` | Theme app extension: Liquid blocks, app embed, storefront TypeScript in `src/` bundled to `assets/` |
| `extensions/sv-pixel` | Web pixel |
| `prisma/` | Schema and migrations (Postgres) |

## Commands

```bash
docker compose up -d db          # or any local Postgres 16
cp .env.example .env
npx prisma migrate dev           # apply migrations to sv_dev
npm test                         # vitest; needs Postgres, uses the sv_test database
npm run typecheck && npm run lint
npm run build && npm run build:services && npm run build:storefront
npm run dev                      # shopify app dev (needs a Partner login; run on your machine)
npm run worker                   # worker from source
npm run ingest                   # ingest from source
```

Tests use a real Postgres at `postgresql://postgres:postgres@localhost:5432/sv_test` (override with `DATABASE_URL`). Run `DATABASE_URL=...sv_test npx prisma migrate deploy` once first. Shopify is faked in tests with `@sv/core/testing`.

## Rules

- Postgres is the source of truth. Every write to Shopify goes through the Publisher and the Shopify client in `packages/core`.
- Do not add access scopes beyond the list in `shopify.app.toml` (plan, build rules).
- Storefront code must stay small: no frameworks, and `npm run build:storefront && node scripts/check-storefront-size.mjs` must pass.
- Keep `shopify.app.toml` metaobject and metafield definitions in sync with `packages/shared/src/shopify-defs.ts`.

## Agent skills

### Issue tracker

Issues live in GitHub Issues for jolo18/shopable-video, via the gh CLI. See `docs/agents/issue-tracker.md`. In Claude Code cloud sessions the `gh` CLI can only search; use the GitHub MCP tools there instead.

### Triage labels

The five default triage labels: needs-triage, needs-info, ready-for-agent, ready-for-human, wontfix. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `GLOSSARY.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.
