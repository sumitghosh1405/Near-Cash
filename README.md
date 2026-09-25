# Near Cash — V16

V16 upgrades the existing V15/V18 serverless build without removing the working authentication, Have/Need listings, expiry, chat, notifications, block/report, PWA, Cash Radar or Live Map.

## V16 additions
- Smart Cash Radar with 500 m / 1 km / 3 km primary ranges.
- Deterministic server-side Smart Match Score: distance 35%, amount compatibility 30%, freshness 20%, trust/activity 15%.
- Server-computed trust labels: New, Verified, Established.
- Exact coordinates are never returned by `/api/nearby`; radar uses distance/bearing only and Live Map renders randomized approximate points.
- Nearby-match notifications with radius, Have/Need and enable/disable preferences plus cooldown/deduplication.
- Server-validated transaction state flow: matched → chatting → meetup → both confirmed → completed.
- Completion cannot be duplicated and confirmation is server-side.
- Location denial remains functional with list-based fallback.
- Backward-compatible D1 schema additions.
- Expiry processing and server timestamps.
- Existing OpenStreetMap/OSRM serverless Live Map remains available at `/live-map/`.

## Deploy
1. `npm install`
2. Keep the existing D1 ID in `wrangler.jsonc`.
3. Run `npx wrangler d1 execute near-cash-db --remote --file=schema.sql`
4. Configure the SMS provider secrets.
5. `npx wrangler deploy`

## Required production configuration
- SMS provider (`TWILIO_*` or `SMS_WEBHOOK_URL`).
- `DEV_OTP` must be disabled in production.
- HTTPS is required for GPS.
- Keep the D1 and Durable Object bindings from `wrangler.jsonc`.

## Privacy
The server stores a coarse-enough matching location representation and calculates distance/bearing server-side. The public nearby API does not return another user's latitude/longitude. Never place exact home/work coordinates in listing text.

## Validation
Run:
- `node --check src/index.js`
- `node --check public/app.js`
- `node --check public/live.js`
- `node --check public/live-map/app.js`
- `node --check public/live-map-addon.js`

External GPS, browser permissions, Cloudflare, OpenStreetMap and OSRM services remain real-world dependencies, so no software package can honestly guarantee literal 100% real-world accuracy or zero failures under every external condition.

### Exchange PIN security
- When an exchange reaches `meetup`, the cash provider can generate a 6-digit one-time Exchange PIN.
- The PIN is scoped to that specific thread and stored only as a SHA-256-derived hash; the plaintext PIN is returned only to the provider at generation time.
- The other participant verifies the PIN server-side. After successful verification, the hash is cleared and the PIN cannot be reused.
- The PIN does not use a short 15/30-minute timeout. It remains active until verified or the exchange is otherwise closed/completed.
- If the provider loses the unverified PIN, they can generate a replacement; the previous PIN becomes invalid.
- Verification is limited to five incorrect attempts per exchange, with additional request rate limiting.
- Completion is blocked server-side until PIN verification and both participant confirmations are recorded.
- The Exchange PIN is not a banking PIN, UPI PIN, password, or identity guarantee.


## Live Map privacy update
- The Live Map does not display nearby users or listings as location markers.
- A participant location is available only from an active accepted exchange.
- Participant location is approximate and refreshed while current; stale locations are hidden.
- Exchange chat includes the Live Map entry point for that specific exchange.
- Match scoring weights are not shown to users; the radar uses short labels such as Strong match, Good match, or Nearby match.


## V17 live-network fixes
- Added a separate **Live Posts** view for active Cash Offers and Cash Requests, including the user's own live posts.
- Dashboard, radar, and Live Posts now refresh from the server every 7 seconds and also react to live SSE listing events.
- Expanded event notifications for posting, matching, messages, exchange state changes/completion, settings changes, and location activation.
- Nearby-match notifications now open the Live Posts view.
- GPS continuously watches the user's position after permission is granted; the last recent GPS fix is restored automatically so maps do not require manual coordinate entry or a refresh.
- Live Map stores the last recent GPS fix locally and starts centered there while the browser reacquires live GPS.
- No manual latitude/longitude input is required.
