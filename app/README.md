# FrontDesk First core (Business 4)

Cloudflare Worker (Free plan) + D1. Handles website enquiries, Razorpay webhooks, 15-minute health/budget checks, the 8 PM IST daily report (with missed-day recovery), and nightly cleanup.

## Test
npm install && npm test        # 10 unit tests (node:test, node:sqlite D1 shim)
npx wrangler dev --local --test-scheduled   # local workerd smoke test

## Deploy (needs CLOUDFLARE_API_TOKEN scoped to Workers, Pages, D1)
npx wrangler d1 create frontdeskfirst-prod      # put database_id in wrangler.toml
npx wrangler d1 execute frontdeskfirst-prod --remote --file migrations/0001_init.sql
npx wrangler secret put NTFY_TOPIC               # long random topic
npx wrangler secret put ADMIN_TOKEN
npx wrangler secret put RAZORPAY_WEBHOOK_SECRET  # after Razorpay KYC
npx wrangler secret put GMAIL_CLIENT_ID / GMAIL_CLIENT_SECRET / GMAIL_REFRESH_TOKEN / REPORT_FROM / REPORT_TO
npx wrangler deploy
npx wrangler pages deploy ../site --project-name frontdeskfirst

Never commit secrets or customer data.
