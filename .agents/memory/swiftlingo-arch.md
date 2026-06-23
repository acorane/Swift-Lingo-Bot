---
name: SwiftLingo Architecture
description: Key decisions, quirks, and constraints for the SwiftLingo Telegram Mini App marketplace
---

## Auth
- JWT stored in localStorage as `swiftlingo_token`
- Injected via `setAuthTokenGetter` from `lib/api-client-react/src/index.ts`
- Dev mode: any non-empty `initData` string accepted by `/api/auth/telegram`; creates user with telegramId `"dev_user_1"`
- Production HMAC: if both `TELEGRAM_BOT_TOKEN` env var and `NODE_ENV=production` are set, HMAC-SHA256 hash is validated against the bot token. Without the env var, all initData is accepted.
- Middleware: `artifacts/api-server/src/middlewares/auth.ts` — verifies JWT using `SESSION_SECRET`

## Platform fee
- 10% hardcoded in `handleAcceptBid` in `artifacts/api-server/src/routes/bids.ts`
- `translatorPayout = agreedPrice * 0.9`, `platformFee = agreedPrice * 0.1`

## Chat gate
- Messages are only sent/fetched when contract `paymentStatus === "confirmed"` or `"released"`
- Enforced server-side in messages route; frontend also gates the UI

## API codegen
- Source of truth: `lib/api-spec/` (OpenAPI YAML)
- Generated output: `lib/api-client-react/src/generated/api.ts`
- Re-run: `pnpm --filter @workspace/api-spec run codegen`
- Never edit generated file manually

## Express 5 param types
- `req.params.someId` is typed `string | string[]` in Express 5 (not just `string`)
- Always cast: `parseInt(String(req.params.someId ?? ""))` before using in parseInt
- This affects ALL route files with URL params

## i18n
- Stored in `artifacts/swiftlingo/src/lib/i18n.tsx`
- Language persisted in localStorage as `swiftlingo_lang`
- Three locales: en, uz, ru; ~70 keys covering all pages

## TypeScript quirks
- `ListNotificationsParams.unreadOnly` is boolean, not string
- `ListJobsParams.limit` and `offset` are numbers, not strings
- `getGetMyTranslatorApplicationQueryKey` IS exported from the generated API — don't define a local duplicate
- Express 5 params → always use `String(req.params.x ?? "")` before parseInt

## Deployment
- Frontend served as static via Replit CDN at `/`
- API runs as a VM process at `/api`
- Replit managed PostgreSQL — `DATABASE_URL` auto-provisioned
- All 11 tables created via `pnpm --filter @workspace/db run push`
- Production schema synced automatically on Publish via Replit diff+apply
- Health check: `/api/healthz`

## Vite build quirks
- vite.config.ts throws if `PORT` or `BASE_PATH` not set — but only at DEV time (not during `vite build`)
- Fixed with `isBuild = process.argv.includes("build")` guard

**Why:** These are runtime-invisible decisions that caused bugs and are not derivable from code inspection alone.
**How to apply:** Check these constraints before writing new route handlers, API calls, or auth logic.
