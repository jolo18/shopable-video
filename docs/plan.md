# Plan: shoppable video app for Shopify

Handoff from the planning sessions (Cowork, 2026-11-11 and 2026-11-12). Read this before starting any milestone. The original plan doc with drawn C2, C3 and C4 diagrams is at https://claude.ai/artifact/1iSLsX8gxKZsAxF4vALfx5 (needs Jose's claude.ai login). Everything an agent needs to build is restated below.

## Goal

A public Shopify app for shoppable videos, at feature parity with Whatmore, Moast and Reelfy. Parity is 75 features. v1 ships the 45 most used (60%). The other 30 follow after release in three waves.

Working name: shopable-video. The final app name is not decided yet.

## Status

- Planning done. No app code yet.
- Repo: https://github.com/jolo18/shopable-video, branch `main`, nothing committed yet. Currently public.
- Agent skill docs are in `docs/agents/` (GitHub issues, default triage labels, single-context domain docs).
- Triage labels `needs-triage`, `needs-info`, `ready-for-agent` and `ready-for-human` are not created yet: the first token lacked Issues write. Create them with `gh label create` once `gh` has a token with Issues read/write. `wontfix` already exists.

## Open before milestone 1

1. **Rust or TypeScript for the ingest API and worker.** Everything else is TypeScript either way. Rust fit: ingest is the best case (hot path, tiny surface, no Shopify library needed), and the worker's import pipeline is good (streams big files with flat memory). Stats jobs gain little, because they're mostly SQL. The app server stays TypeScript, since Shopify has no Rust server library. Mixing languages means two toolchains, shared contracts generated for both sides, and a plain Postgres job table instead of a Node-only queue library.
2. **Final app name.** It can stay "shopable-video" until the listing.
3. **Jose's setup:** Shopify Partner account, a Partner dev store with a few products, Shopify CLI installed (`npm i -g @shopify/cli`, Node 22+), and local Postgres (Docker or Postgres.app).

## Confirmed decisions

| # | Decision | Choice |
| --- | --- | --- |
| 1 | Video hosting | The merchant's own Shopify Files, like Moast and Reelfy. No CDN bill, unlimited views on every plan |
| 2 | Stack | TypeScript on Shopify's React Router app template, Postgres. Ingest and worker language still open, see above |
| 3 | Hosting | GCP: Cloud Run and Cloud SQL |
| 4 | Social import | A paid fetch provider behind an interface, with a rights checkbox before import. Provider, key and budget come before milestone 7 |
| 5 | Pricing | Free plan plus paid tiers gated on video count and features, unlimited views. Billed with Shopify App Pricing |
| 7 | v1 line | The 45 rows marked v1 below |

## Features

Yes = offered. Paid = paid plans only. No = not advertised. ? = can't tell from public pages.

### Import and library

| # | Feature | Whatmore | Moast | Reelfy | Release |
| --- | --- | --- | --- | --- | --- |
| 1 | Upload from device, in bulk | Yes | Yes | Yes | v1 |
| 2 | Import from an Instagram or TikTok link | Yes | Yes | Yes | v1 |
| 3 | Import by username: browse a profile, pick videos | Yes | Yes | Yes | v1 |
| 4 | Daily auto-sync of social accounts | Paid | Paid | No | v1 |
| 5 | Import from hashtags and brand mentions | No | Yes | No | Later |
| 6 | YouTube import | Yes | No | No | Later |
| 7 | Media library with search, filters, bulk actions | Yes | Yes | Yes | v1 |
| 8 | Compression, renditions, poster images | Yes | Yes | Yes | v1 |
| 9 | Title, caption and cover image per video | ? | Yes | Yes | v1 |
| 10 | Remove audio from a video | No | Yes | No | Later |
| 11 | UGC collection widget: shoppers upload videos | No | Paid | No | Later |
| 12 | AI image and video generation studio | Yes | No | No | Later |

### Shoppable layer

| # | Feature | Whatmore | Moast | Reelfy | Release |
| --- | --- | --- | --- | --- | --- |
| 13 | Tag products on a video | Yes | Yes | Yes | v1 |
| 14 | Several products on one video | Yes | Paid | Yes | v1 |
| 15 | Product card: image, name, price, sale price | Yes | Yes | Yes | v1 |
| 16 | Add to cart inside the player | Yes | Yes | Yes | v1 |
| 17 | Product sheet with variant picker | Yes | ? | ? | v1 |
| 18 | Button choices: add to cart, buy now, view product | Yes | ? | Yes | v1 |
| 19 | Cart drawer and cart count refresh | ? | ? | Custom per theme | v1 |
| 20 | Review app integration: star ratings on product cards | Yes | Yes | Yes | v1 |
| 21 | AI product tagging suggestions | Yes | No | No | Later |
| 22 | Autopilot: fetch, tag and publish with no review | Paid | No | No | Later |
| 23 | Auto-hide videos when products sell out | Paid | No | No | Later |
| 24 | Quizzes, polls and lead capture in video | Paid | No | ? | Later |
| 25 | Share button and link to a single video | Yes | ? | ? | v1 |
| 26 | Likes and view counts | Yes | Yes | ? | Later |
| 27 | WhatsApp chat button | Yes | No | No | Later |

### Widgets and placements

| # | Feature | Whatmore | Moast | Reelfy | Release |
| --- | --- | --- | --- | --- | --- |
| 28 | Carousel | Yes | Yes | Yes | v1 |
| 29 | Stories | Yes | Yes | Yes | v1 |
| 30 | Floating pop-up player | Yes | Yes | Yes | v1 |
| 31 | Grid | Yes | Yes | Yes | v1 |
| 32 | Featured single video or banner | Paid | Yes | ? | v1 |
| 33 | Product page widget filled from tagged products | Yes | Yes | Yes | v1 |
| 34 | Collection pages with per-collection videos | Paid | Yes | Yes | v1 |
| 35 | Full-screen swipe player | Yes | Yes | Yes | v1 |
| 36 | Extra layouts: stacked, 3D carousel, hover cards | Yes | No | Yes | Later |
| 37 | Shop-by-video page | Paid | ? | No | Later |
| 38 | Embed code for page builders and old themes | Yes | ? | Yes | v1 |
| 39 | Shoppable video in emails (Klaviyo) | Paid | Paid | Yes | Later |
| 40 | Publish videos to the Shop app | No | Yes | No | Later |
| 41 | Mobile app SDK | Yes | No | No | Later |
| 42 | Other platforms and headless | Yes | No | No | Later |
| 43 | Video in the product media gallery | Paid | No | No | Later |
| 44 | Video Answers: AI Q&A on product pages | Yes | No | No | Later |

### Player and customization

| # | Feature | Whatmore | Moast | Reelfy | Release |
| --- | --- | --- | --- | --- | --- |
| 45 | Muted autoplay previews, play on hover | Yes | Yes | Yes | v1 |
| 46 | Player controls: swipe, mute, progress, auto-advance | Yes | Yes | Yes | v1 |
| 47 | Lazy loading with a cap on active videos | Yes | Yes | Yes | v1 |
| 48 | Video quality by device and connection | Yes | Yes | Yes | v1 |
| 49 | Style settings: colors, fonts, corners, spacing, text | Yes | Yes | Yes | v1 |
| 50 | Per-device layout: columns and card sizes | ? | ? | Yes | v1 |
| 51 | Carousel behaviour: arrows, dots, auto-rotate | Yes | ? | Yes | v1 |
| 52 | Pop-up behaviour: corner, shape, delay, reappear | Yes | Yes | Yes | v1 |
| 53 | Show rules by page, product and collection | Yes | Yes | Yes | v1 |
| 54 | Custom CSS | Yes | Via support | Yes | v1 |
| 55 | Storefront text translation | ? | Paid | Yes | v1 |
| 56 | Pick and order videos per widget | Yes | Yes | Yes | v1 |
| 57 | AI styling from a prompt | Yes | Yes | No | Later |
| 58 | Auto-sort videos by performance | ? | Yes | No | Later |
| 59 | Personalization by shopper location | Paid | No | No | Later |
| 60 | A/B testing with a holdout group | Paid | No | No | Later |

### Analytics and marketing

| # | Feature | Whatmore | Moast | Reelfy | Release |
| --- | --- | --- | --- | --- | --- |
| 61 | Funnel per widget and video: views, clicks, carts, orders, revenue | Paid | Yes | Paid | v1 |
| 62 | Watch time and completion | Paid | ? | ? | v1 |
| 63 | Orders attributed to videos | Paid | Yes | Paid | v1 |
| 64 | Top videos and top products | Paid | Paid | ? | v1 |
| 65 | What to tag next: product ranking and AI insights | Yes | No | No | Later |
| 66 | Meta retargeting audiences from video events | Paid | No | No | Later |
| 67 | Meta catalog feed with video | Paid | No | No | Later |
| 68 | AI search and SEO data: schema, transcripts, alt text | Paid | Paid | No | Later |
| 69 | Shopify Flow triggers | No | Yes | No | Later |

### App platform

| # | Feature | Whatmore | Moast | Reelfy | Release |
| --- | --- | --- | --- | --- | --- |
| 70 | No-code install: app embed, app blocks, setup checklist | Yes | Yes | Yes | v1 |
| 71 | Plans and billing through Shopify | Yes | Yes | Yes | v1 |
| 72 | Branding badge on free, removed on paid | ? | Yes | No | v1 |
| 73 | Speed budget: small loader, lazy everything | Yes | Yes | Yes | v1 |
| 74 | Public JavaScript events API | Yes | No | Yes | Later |
| 75 | Multi-store management | Paid | No | No | Later |

### Post-release waves

1. **Quick wins:** 26, 36, 37, 23, 74, 5, 6, 10, 69.
2. **Upgrade drivers:** 21, 22, 58, 60, 65, 39, 68, 57, 24, 11, 40. Shop app publishing (40) needs a spike first.
3. **Long tail:** 66, 67, 43, 44, 59, 27, 75, 41, 42, 12. Build when a paying customer asks.

## Architecture

The storefront never calls our servers to show a video. Videos sit in the merchant's Shopify Files, widget data sits in app-owned metaobjects and metafields, and the theme reads both in Liquid. Our backend handles the admin, imports and analytics. The web pixel is the only storefront traffic that reaches our servers.

### Containers (C2)

| Container | Tech | Does |
| --- | --- | --- |
| Admin UI | React Router, Polaris web components, in Shopify admin | Library, tagging, widget editor with live preview, analytics, plan |
| App server | Node, React Router, TypeScript | Auth, admin API, webhooks, publishes to Shopify |
| Worker | Node or Rust, job queue in Postgres | Imports, daily sync, rollups, attribution |
| Ingest API | Node or Rust | Takes event batches from the web pixel |
| Postgres | Cloud SQL | Library, widgets, jobs, events, stats |
| Theme app extension | Liquid, small TypeScript bundle, no framework | Widgets, player, add to cart on the storefront |
| Web pixel | Shopify pixel sandbox | Forwards widget events and checkout events to ingest |

External: Shopify Admin API (GraphQL), Shopify storefront (Liquid render, video CDN, cart, checkout), and the fetch provider (Instagram and TikTok video files).

### Components (C3)

- **App server:** admin routes, webhook routes (uninstall, billing, privacy), auth and session (token exchange). Services: library, upload (staged upload targets, file create, status), tagging (video to product links, product metafield lists), widget (layouts, order, styles, show rules, drafts), analytics (reads rollups and attributed orders), entitlements (plan to limits). Integration: Publisher (copies published state to metaobjects and metafields), Shopify client (GraphQL, retries, rate limit backoff), data access (ORM plus job queue). Every write to Shopify goes through the Publisher and the Shopify client.
- **Worker:** a job runner polling the Postgres queue. A sync scheduler (once a day per connected username, queues new posts). An import pipeline (one job per video: fetch, dedupe, upload, wait for Shopify processing, save to library). Provider adapters (primary and fallback). A Shopify uploader (streams to a staged upload, then creates the file). Stats jobs (rollups every few minutes, order attribution, event cleanup).
- **Ingest:** a receiver, a validator (known shop, valid schema, rate limit per shop) and a batch writer (bulk inserts into `events`).
- **Storefront:** Liquid blocks (an app embed for the loader, pop-up and show rules, a widget block and a product videos block) print posters, markup and one JSON data island per widget. A loader under 10 KB finds widgets and lazy-loads the rest. Layout renderers: carousel, stories, grid, featured, pop-up. A preview manager runs muted autoplay with three at most and picks the rendition by screen and network. The player loads on first tap, and so does the product sheet (variants, price, stars, add to cart, buy now, view product). A cart adapter adds the line, then refreshes the drawer (Dawn, Horizon, generic). An event publisher calls `Shopify.analytics.publish`. An embed hydrator serves snippets in page builders and reads the same metaobjects through the Storefront API.
- **Web pixel:** a subscriber (widget events plus checkout started and completed) and a sender (batches with the client id and beacons them to ingest).

### Interfaces (C4)

| Interface | Methods | Callers | v1 implementation |
| --- | --- | --- | --- |
| VideoStore | createUpload(file), finalize(uploadId), get(videoId), remove(videoId) | Upload service, import pipeline | ShopifyFilesStore. Later: external CDN for stores past Shopify's caps |
| ImportProvider | listProfile(username), resolve(url), download(video) | Import pipeline, sync scheduler | Primary and fallback provider adapters, tried in order |
| Publisher | publishVideo(video), publishWidget(widget), publishProduct(id), publishConfig(shop) | Widget and tagging services | ShopifyPublisher: upserts metaobjects and metafields |
| CartAdapter | matches(theme), add(variant, qty), refresh(cart) | Product sheet | Theme adapters: Dawn, Horizon, generic fallback |

Shared types: `SvEvent` (type, shop, widgetId, videoId, productId, value, ts) has the same shape in the widget, the pixel and ingest. `Entitlements` (maxVideos, multiTag, branding, analytics, autoSync) is derived from the plan and read on both sides.

### Data model

Postgres is the source of truth. Shopify holds a published copy, and nothing on the Shopify side is edited directly, so a republish can always rebuild it. Every table carries `shop_id`.

| Table | Columns |
| --- | --- |
| shops | id, domain, plan, settings, access_token_enc |
| videos | id, shop_id, title, caption, shopify_file_id, source, metaobject_id, status |
| video_products | video_id, product_id, position |
| widgets | id, shop_id, type, status, settings, rules, metaobject_id |
| widget_videos | widget_id, video_id, position |
| social_accounts | id, shop_id, platform, username, auto_sync, last_synced_at |
| import_jobs | id, shop_id, source_url, social_account_id, status, error, video_id |
| events | ts, shop_id, client_id, type, widget_id, video_id, product_id, value. Kept 14 days |
| stats_daily | shop_id, day, widget_id, video_id, impressions, views, watch_ms, clicks, carts, orders, revenue |
| attributed_orders | shop_id, order_id, client_id, video_id, kind, value, currency |

Shopify side: `sv_video` metaobject (file, title, caption, cover, products), `sv_widget` metaobject (type, videos, settings), a product metafield (list of sv_video), a collection metafield (one sv_widget), and an app-data metafield for config (plan flags, pop-up rules, cart mode, custom CSS). Use the `$app` reserved prefix for every one.

No customer names, emails or addresses are stored. Visitors are keyed by Shopify's anonymous client id.

Attribution: **direct** means the shopper added the item to cart from a video and bought it within 7 days. **Influenced** means the shopper watched a video in the 7 days before ordering. Keep the two apart.

## Build rules

- Posters render from Liquid, so a widget paints before any JavaScript runs.
- Previews use the smallest rendition, start on scroll, and play three at once at most.
- Product name, price, variants and stock come from Liquid and the theme's product data, never from our DB.
- Cap a widget at 50 videos in v1 (Liquid loops return 50 entries without pagination).
- Access scopes for v1: write_files, write_metaobjects, write_products, write_pixels, read_customer_events, unauthenticated_read_metaobjects, unauthenticated_read_product_listings. Ask for nothing else. No customer, order or theme scopes.
- Implement the three privacy webhooks: customers/data_request, customers/redact, shop/redact.
- All tracking goes through the web pixel, so Shopify's consent settings apply.

## Milestones

Each one must be usable on a dev store before the next starts.

1. **Foundations.** Scaffold from Shopify's React Router template, install and auth, Postgres, compliance webhooks, CI, staging deploy. Done when the app installs on a dev store and opens inside Shopify admin.
2. **Video library.** Upload straight from the browser to Shopify Files, processing status, library with search, filters and bulk actions, title, caption and cover. Done when 20 videos upload in one go and show as ready.
3. **Tagging and widgets.** Product picker with multi-product tags, widget editor for the five layouts with live preview, publish to metaobjects and metafields. Done when a published widget holds everything a theme needs.
4. **Storefront widgets.** Theme app extension with app blocks, app embed, loader and swipe player, styling, show rules, translations, custom CSS. Done when all five layouts and the product page widget play on five popular themes, phone and desktop.
5. **Buying from video.** Product sheet with variants, add to cart, buy now, cart drawer refresh, review stars, share links. Done when add to cart from a video updates the cart on all five test themes.
6. **Analytics.** Event schema, web pixel, ingest, rollups, attribution, dashboard. Done when a test order shows up against the right video within minutes.
7. **Social import.** Link and username import with a rights checkbox, job queue with progress, dedupe, daily auto-sync. Done when a pasted reel link lands in the library and the next day's sync picks up a new post.
8. **Plans and onboarding.** Shopify App Pricing plans, limits and entitlements, branding badge, setup checklist with deep links into the theme editor, embed code. Done when a fresh install reaches a live widget in under five minutes.
9. **Launch.** Beta on a real store, Lighthouse test by Shopify's method, theme and device QA, security pass, listing copy, screenshots, demo store, App Store submission. Done when the listing is approved.

## Shopify limits that shape the build

| Limit | Value |
| --- | --- |
| Videos per store (counted with 3D models) | Basic and Partner dev stores 250, Grow 1,000, Advanced 5,000, Plus 50,000 |
| Video file | 1 GB, 10 minutes, MP4, MOV or WebM. Trial-plan stores can't upload video |
| Storefront speed | The app may not cut the weighted Lighthouse score (home 17%, product 40%, collection 43%) by more than 10 points |
| Theme app extension | Loader JS 10 KB compressed (guideline), 100 KB of Liquid in total, 30 blocks, 10 MB of files |
| Liquid | 50 entries per loop without pagination, 250 with, 20 metaobject lookups by handle per page |
| Metafields | JSON 128 KB, list fields 128 items (1,024 for metaobject references) |
| Web pixel | Name, email, phone and address arrive null without protected data approval. We don't need them |

## Risks

| Risk | Plan |
| --- | --- |
| Social import runs on unofficial fetchers. TikTok's official API returns no video file. Instagram's media_url covers professional accounts only, drops reels with copyrighted audio, and needs Meta app review | Provider behind ImportProvider with a fallback, rights checkbox, official Instagram connect in the backlog |
| Shopify's video caps (250 on Basic) | Usage meter and clear errors now, external storage behind VideoStore later |
| Cart drawers differ per theme | Adapters for the Dawn and Horizon families, a generic fallback, and a setting to open the cart page instead |
| Video weight against the 10-point speed rule | Posters first, smallest rendition for previews, Lighthouse measured at every milestone |
| Shoppers who decline tracking send no events | Report consented traffic only and label it that way |

## Competitors (checked 2026-11-11)

| | Whatmore | Moast | Reelfy |
| --- | --- | --- | --- |
| Rating (reviews) | 5.0 (398) | 5.0 (348) | 4.8 (256) |
| Paid plans, USD a month | 29, 79, 149 (249 and custom on their site) | 15 | 9.99, 19.99, 39.99 |
| Free plan | 15 videos, 300 video clicks a month | Unlimited views, 10 videos per widget, 1 product per video, branding | 10 videos, 1 gallery per widget, no analytics |
| Video hosting | Own CDN, meters clicks | Merchant's Shopify Files | Merchant's Shopify Files |

Sources: [Whatmore](https://apps.shopify.com/whatmore-live), [Moast](https://apps.shopify.com/moast-interactive-ugc), [Reelfy](https://apps.shopify.com/reelfy), [Shopify file limits](https://help.shopify.com/en/manual/shopify-admin/productivity-tools/file-uploads), [theme app extension limits](https://shopify.dev/docs/apps/build/online-store/theme-app-extensions/configuration), [storefront performance](https://shopify.dev/docs/apps/build/performance/storefront).
