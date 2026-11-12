# shopable-video

A public Shopify app for shoppable videos: carousels, stories, grids, featured videos and a floating pop-up, with a full-screen swipe player where shoppers add to cart without leaving the video. Videos live in the merchant's own Shopify Files, so there is no CDN bill and views are unlimited on every plan.

The full plan, scope and architecture are in [docs/plan.md](docs/plan.md).

## What's built

Milestones 1 to 8 of the plan are built and tested against a fake Shopify. None of it has run on a real dev store yet; see [Testing on a dev store](#testing-on-a-dev-store).

| Milestone | Where |
| --- | --- |
| 1. Foundations: template, Postgres, compliance webhooks, CI, Docker | `app/`, `prisma/`, `.github/workflows/ci.yml`, `docker-compose.yml` |
| 2. Video library: direct uploads to Shopify Files, status, search, filters, bulk delete, title, caption, cover | `packages/core/src/videos`, `app/routes/app.videos.*` |
| 3. Tagging and widgets: multi-product tags, widget editor for 5 layouts with live preview, Publisher | `packages/core/src/{tagging,widgets,publisher,publishing}.ts`, `app/routes/app.widgets.*` |
| 4. Storefront widgets: app blocks, app embed, loader, player, styling, show rules, translations, custom CSS | `extensions/sv-theme` |
| 5. Buying from video: product sheet, variants, add to cart, buy now, cart drawer refresh, review stars, share links | `extensions/sv-theme/src/{player,sheet,cart}.ts` |
| 6. Analytics: web pixel, ingest, rollups, attribution, dashboard | `extensions/sv-pixel`, `services/ingest`, `packages/core/src/analytics`, `app/routes/app.analytics.tsx` |
| 7. Social import: link and username import, rights checkbox, job queue, dedupe, daily sync | `packages/core/src/imports`, `app/routes/app.import.tsx` |
| 8. Plans and onboarding: billing, entitlements, branding badge, setup checklist, embed code, settings | `packages/core/src/billing.ts`, `app/routes/app.{plans,settings,_index}.tsx` |

## Run it locally

You need Node 22.12+, Docker, a [Shopify Partner account](https://partners.shopify.com) and a Partner dev store with a few products.

```bash
npm install -g @shopify/cli
```

```bash
git clone https://github.com/jolo18/shopable-video.git
cd shopable-video
git checkout claude/laughing-ramanujan-7d0o8h
npm install
cp .env.example .env
```

Start Postgres, run migrations, and start the worker and ingest service:

```bash
docker compose up -d --build
```

Connect the code to a Partner app (creates one the first time; pick your dev store when asked):

```bash
npm run config:link
```

Start the app server. This logs in to your Partner account in the browser, opens a tunnel, and installs the app on your dev store:

```bash
npm run dev
```

Press `p` in the terminal to open the app in your store admin.

### Local settings

- `.env` is read by the worker container. Copy `SHOPIFY_API_KEY` and `SHOPIFY_API_SECRET` into it from `shopify app env show` so the worker can call Shopify, then restart it with `docker compose up -d worker`.
- `INGEST_URL` must be reachable from the shopper's browser. For dev-store testing, expose port 8081 with a tunnel (for example `cloudflared tunnel --url http://localhost:8081`) and put that URL in `.env` before `npm run dev`.
- `IMPORT_PROVIDER=fake` serves sample posts so social import can be tested without a paid provider. Set `IMPORT_SAMPLE_VIDEO_URL` to a small public MP4 to upload a real video; without it the fake upload is a stub that Shopify rejects during processing.

## Testing on a dev store

Each milestone's done criteria from the plan, as a checklist:

1. **Foundations:** the app installs and opens inside Shopify admin.
2. **Library:** select 20 videos in Videos → Upload; all 20 reach "ready".
3. **Widgets:** tag products on a video, create a carousel, add videos, Publish. In Shopify admin → Content → Metaobjects you should see "Shoppable video widget" entries.
4. **Storefront:** follow the setup checklist on the app's home page. Check all five layouts and the Product videos block on Dawn, Horizon and three other popular themes, on phone and desktop.
5. **Buying:** add to cart from a video. The cart drawer or count should update on all five test themes. Try a product with variants, buy now and a share link.
6. **Analytics:** on a paid test plan, watch a video, add to cart, check out with a test payment. Within about five minutes the order appears under Analytics against that video.
7. **Social import:** paste a reel link; it lands in the library. With auto-sync on, the next day's sync picks up new posts. This needs the real provider for real videos.
8. **Onboarding:** a fresh install reaches a live widget in under five minutes.

## Tests

Tests run against a real Postgres. With the Docker database running:

```bash
psql postgresql://postgres:postgres@localhost:5432/postgres -c "create database sv_test"
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/sv_test npx prisma migrate deploy
npm test
```

Also: `npm run typecheck`, `npm run lint`, `npm run build:storefront && node scripts/check-storefront-size.mjs` (loader under 10 KB gzipped).

## Deploy (Cloud Run and Cloud SQL)

1. Create a GCP project, an Artifact Registry Docker repo named `shopable-video`, and a Cloud SQL Postgres 16 instance with a database.
2. Store secrets in Secret Manager: `sv-database-url`, `sv-shopify-api-key`, `sv-shopify-api-secret`, `sv-import-provider-key`.
3. Deploy the three services:

```bash
PROJECT_ID=my-project REGION=us-central1 SQL_INSTANCE=my-project:us-central1:sv ./deploy/cloudrun.sh
```

4. Set the app's URL in `shopify.app.toml` (or a `shopify.app.production.toml`), rerun the script with `SHOPIFY_APP_URL` set, then deploy the app config and extensions:

```bash
npm run deploy
```

Before release, set `BILLING_TEST=false`. If you set up plans in the Partner Dashboard with Shopify managed pricing, set `SHOPIFY_MANAGED_PRICING_HANDLE` to the app's handle, and the Plans page sends merchants to Shopify's plan page instead.

## Still open

- **Import provider:** pick the paid fetch provider, then map its API in `HttpProvider` (`packages/core/src/imports/provider.ts`). Set `IMPORT_PROVIDER`, `IMPORT_PROVIDER_BASE_URL` and `IMPORT_PROVIDER_API_KEY`.
- **Things only a real store can confirm:** Liquid output of the blocks, the `$app` metaobject lookups in Liquid, Horizon's cart drawer hooks, the Storefront API embed, and the Lighthouse impact. These were written from Shopify's documentation and checked only by unit tests.
- **Milestone 9 (launch)** is not started.
