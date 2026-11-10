# RRALLC Home Services

Responsive Expo / React Native Web site for furniture assembly and small home services in California City and Mojave.

## Run on your Mac

1. Install Node.js 20.19+ if needed.
2. In Terminal: `cd rrallc-home-services`
3. Run: `npm install`
4. Run: `npx expo start --web`
5. Open the URL printed in Terminal (usually http://localhost:8081).

## Before publishing

- In `app/index.tsx`, replace `CONTACT_EMAIL = ''` with your real business email. Quote requests then open the visitor's email app with the details prefilled; this is **not** automatic submission or a database-backed booking system.
- Optionally set `CONTACT_PHONE` and add a phone button if desired.
- Review prices, services, licensing requirements, and your business name registration.
- Publish with `npx expo export --platform web` and host the `dist` folder using a static host.

## Notes

- Pricing is based on the provided RRALLC Home Services PDF.
- Flat-rate starting prices are estimates, not guaranteed final quotes.
- The $100 minimum is a minimum labor charge, **not** an extra fee on top of hourly labor.
- Some wall-mounted/permanently installed work may require licensing or permits in California.
