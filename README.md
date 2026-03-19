# Shopify Image Audit Pro — deployable starter

This is a stronger publishable starter than the original ZIP. It includes:

- OAuth install flow
- SQLite shop and settings storage
- Embedded-style app UI
- Product image audit dashboard
- `app/uninstalled` webhook registration and cleanup
- Privacy policy and support pages you can replace with your real business details
- Dockerfile for deployment

## What this app is ready for

- installation on a development store
- deployment to a live Node host
- use in your Shopify developer dashboard as a hosted app URL

## What you still must do before public App Store submission

- replace the privacy policy text with your real legal copy
- replace the support page with your actual support contact
- host the app on a public HTTPS URL
- verify all required Shopify listing information in your Partner / Dev Dashboard
- add any mandatory compliance webhooks and business workflows needed for your specific app

## Quick start

1. Copy `.env.example` to `.env`
2. Fill in your Shopify API key, API secret, scopes, and public `APP_URL`
3. Run `npm install`
4. Run `npm run dev`
5. In the Shopify Dev Dashboard, set:
   - App URL = your `APP_URL`
   - Allowed redirection URL = `${APP_URL}/auth/callback`
6. Visit `/auth?shop=your-store.myshopify.com`

## Current scopes

- `read_products`

## Notes

This app audits images only. It does not re-upload optimized media. If you want true optimization and replacement, the next step is staged uploads plus file creation in the Admin GraphQL API.
