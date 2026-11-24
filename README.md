# FrontDesk First

Enquiry autopilot for private dental and aesthetic clinics.

- `site/` static website, deployed to Cloudflare Pages (https://frontdeskfirst.pages.dev)
- `app/` Cloudflare Worker + D1 backend (enquiries, Razorpay webhooks, ntfy alerts, 8 PM IST daily report). See `app/README.md`.

Never commit secrets or customer data. Secrets are set with `wrangler secret put`.
