# Near Cash — Cloudflare Free Deployment

This version moves the Node/JSON-file backend to Cloudflare Workers + D1 + SQLite-backed Durable Objects while keeping the existing frontend and API paths. It removes the Render Free cold-start page.

## Important
- The JSON file database is replaced by D1. The ZIP you supplied did not contain a persistent `data/db.json`, so there is no existing database to migrate in this package.
- Phone OTP still requires your `SMS_WEBHOOK_URL` and optional `SMS_WEBHOOK_TOKEN` secrets.
- Live updates use a Durable Object (`UserStream`).
- The frontend files are unchanged from the supplied Near Cash v4 package.

## Deploy
1. Install Node.js 18+.
2. Install Wrangler: `npm install`.
3. Log in: `npx wrangler login`.
4. Create the database: `npx wrangler d1 create near-cash-db`.
5. Put the returned database ID into `wrangler.jsonc` in place of `REPLACE_WITH_D1_DATABASE_ID`.
6. Initialize schema: `npx wrangler d1 execute near-cash-db --remote --file=schema.sql`.
7. Set secrets:
   - `npx wrangler secret put SMS_WEBHOOK_URL`
   - `npx wrangler secret put SMS_WEBHOOK_TOKEN`
8. Deploy: `npx wrangler deploy`.

## Local development
`npx wrangler dev`

Sign-in codes: add the text variable DEV_OTP=true (Workers > Settings > Variables and Secrets) to show the code on screen while testing. For real texts add secrets TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM (or SMS_WEBHOOK_URL). Remove DEV_OTP before real users arrive; while it is on, anyone can sign in as any phone number.

## Google Maps view
Open config.js, paste your Google Maps JavaScript API key between the quotes, and redeploy. In Google Cloud, restrict the key to your website address. Without a key the Map tab shows a setup note and the radar still works.


## Admin analytics dashboard

This build adds a read-only admin endpoint for the separate Near Cash Admin Dashboard. It does not change the normal app routes or UI.

### Cloudflare setup

1. In the Near Cash Worker, add a secret named `ADMIN_ANALYTICS_KEY`.
2. Use a long random value as the secret. Do not commit it to GitHub.
3. Deploy this Worker.
4. In the separate `near-cash-admin` repository, set the API base to this Worker URL (for example, `https://your-worker.workers.dev`).
5. Open the admin dashboard and enter the same admin key.

The dashboard calls `GET /api/admin/summary` with `X-Admin-Key`. The endpoint reads existing D1 data and returns privacy-safe aggregate statistics.

The endpoint supports CORS for the separate dashboard and does not expose phone numbers, session tokens, PINs, message text, or exact user locations.
