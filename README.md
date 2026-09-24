# Near Cash v2

Live cash-matching web app: phone sign-in, GPS radar, live chat, reports and blocking.
Zero dependencies (Node 18+).

## Files
Everything sits in one folder: server.js, package.json, index.html, app.js, live.js, styles.css, sw.js, manifest.webmanifest and the icon PNGs (in an icons folder, or next to the other files if your uploader cannot make folders).

## Run
    npm start        # http://localhost:3000

Dev mode shows the SMS code on screen. Location works on localhost and on HTTPS only.

## Production settings
- NODE_ENV=production hides on-screen codes and requires an SMS provider.
- TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM: sends codes through Twilio. Also DEFAULT_COUNTRY_CODE (default 91) for numbers typed without a +.
- DEV_OTP=true: shows the code on screen even in production. For testing only; anyone could sign in as any phone number.
- SMS_WEBHOOK_URL (+ SMS_WEBHOOK_TOKEN): endpoint that receives {to, message} and sends the SMS (MSG91, Twilio, etc. via a small relay).
- ADMIN_KEY: enables GET /api/admin/reports with header x-admin-key.
- PORT: listen port. Deploy behind HTTPS (Render, Railway, Fly.io, or a VPS with Caddy/nginx).

## Privacy design
The server stores each user's location rounded to about 110 m. Other users only receive an approximate distance (0.1 km steps) and direction, never coordinates.

## Before real money at scale
1. Replace data/db.json with PostgreSQL (all data access is in server.js).
2. Use a real SMS provider and add identity checks.
3. Add moderation tooling for reports, push notifications and monitoring.
4. Have an Indian lawyer review the cash-exchange model, terms and privacy policy.

Near Cash does not hold or move money.
