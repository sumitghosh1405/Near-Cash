# Near Cash V1

A modern, mobile-first, functional static web app for the Near Cash V1 concept.

## Included
- Futuristic responsive UI
- Home dashboard
- I NEED CASH flow
- I HAVE CASH flow
- Nearby matching
- Approximate-area matching UI
- Auto-expiring cash availability
- Transaction/activity view
- Profile
- Safety page
- Local persistence with browser localStorage
- Responsive mobile navigation

## Run
No build tool is required for the demo. Open `index.html` in a browser, or deploy the folder to GitHub Pages/Netlify/Vercel as a static site.

## GitHub
```bash
git init
git add .
git commit -m "Initial Near Cash V1"
git branch -M main
git remote add origin YOUR_REPOSITORY_URL
git push -u origin main
```

## Important production note
This is a functional V1 frontend/demo, not a completed real-money production backend. It deliberately uses localStorage so the UX can be tested without a server. Before real transactions, replace localStorage with a secure backend, real authentication/OTP, server-side authorization, database, realtime messaging, rate limiting, abuse prevention, monitoring, and appropriate identity verification. The actual Indian cash-exchange/payment model and legal documents should be reviewed before launch.


## App icon set
- `icons/favicon.png` — browser favicon.
- `icons/icon-192.png` and `icons/icon-512.png` — installable/PWA icons.
- `icons/apple-touch-icon.png` — iOS home-screen icon.
- Additional 48px/96px PNG sizes are included for browser/UI use.
