# Shopify Image Audit Pro

A minimal Shopify app with a complete UI and backend that installs through OAuth, stores shop tokens in SQLite, and audits product featured images through the GraphQL Admin API.

## What this app does

- installs on a Shopify store with OAuth
- loads an embedded-style admin app shell
- scans product featured images
- shows dimensions, file size, score, and basic optimization recommendations
- stores audit settings per shop

## Stack

- Node.js + Express
- SQLite via better-sqlite3
- Vanilla HTML/CSS/JS frontend
- Shopify GraphQL Admin API

## 1) Create the Shopify app

In Shopify Dev Dashboard, create an app and set:

- **App URL** → your public tunnel or domain, for example `https://abc123.trycloudflare.com`
- **Allowed redirection URL(s)** → `https://abc123.trycloudflare.com/auth/callback`
- **Scopes** → `read_products`

## 2) Configure environment variables

Copy `.env.example` to `.env` and fill in your real values.

## 3) Install dependencies

```bash
npm install
```

## 4) Start the app

```bash
npm run dev
```

## 5) Install on your store

Open:

```bash
https://your-public-domain.example.com/auth?shop=your-store.myshopify.com
```

After approving, Shopify redirects back to `/app?shop=...`.

## Notes

- This project is designed to be easy to understand and extend.
- For production, add webhook handling, a proper session/token strategy, CSP headers, and a stronger deployment flow.
- The app currently audits image health. It does **not** replace product images automatically.

## Useful next upgrades

- webhook registration for product updates
- background job queue for large scans
- bulk export CSV
- media replacement flow using `stagedUploadsCreate` + `fileCreate`
