require('dotenv').config();

const path = require('path');
const express = require('express');
const cookieParser = require('cookie-parser');

const { deleteShop, getSettings, getShop, listShops, upsertSettings, upsertShop } = require('./db');
const {
  API_VERSION,
  adminGraphQL,
  buildAuditSummary,
  buildInstallUrl,
  exchangeCodeForToken,
  extractImageMetrics,
  generateNonce,
  registerAppUninstalledWebhook,
  sanitizeShop,
  verifyHmac,
  verifyWebhookHmac,
} = require('./shopify');

const app = express();
const PORT = Number(process.env.PORT || 3000);

['SHOPIFY_API_KEY', 'SHOPIFY_API_SECRET', 'SHOPIFY_SCOPES', 'APP_URL'].forEach((name) => {
  if (!process.env[name]) throw new Error(`Missing required environment variable: ${name}`);
});

app.disable('x-powered-by');
app.use((req, res, next) => {
  res.setHeader('X-Frame-Options', 'ALLOWALL');
  res.setHeader('Content-Security-Policy', "frame-ancestors https://admin.shopify.com https://*.myshopify.com;");
  next();
});
app.use('/webhooks', express.raw({ type: '*/*', limit: '2mb' }));
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, '..', 'public')));

function ensureInstalled(req, res, next) {
  const shop = sanitizeShop(req.query.shop || req.headers['x-shopify-shop-domain']);
  if (!shop) return res.status(400).json({ error: 'Missing or invalid shop domain.' });

  const record = getShop(shop);
  if (!record) return res.status(401).json({ error: 'App is not installed on this shop.' });

  req.shop = shop;
  req.shopRecord = record;
  next();
}

app.get('/', (_req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'install.html'));
});

app.get('/privacy', (_req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'privacy.html'));
});

app.get('/support', (_req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'support.html'));
});

app.get('/auth', (req, res) => {
  const shop = sanitizeShop(req.query.shop);
  if (!shop) return res.status(400).send('Invalid shop domain. Use format your-store.myshopify.com');

  const state = generateNonce();
  res.cookie('shopify_app_state', state, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 5 * 60 * 1000,
  });

  res.redirect(buildInstallUrl({ shop, state }));
});

app.get('/auth/callback', async (req, res) => {
  try {
    const shop = sanitizeShop(req.query.shop);
    const { code, state } = req.query;

    if (!shop || !code || !state) return res.status(400).send('Missing required OAuth parameters.');
    if (state !== req.cookies.shopify_app_state) return res.status(400).send('State mismatch. Please retry installation.');
    if (!verifyHmac(req.query)) return res.status(400).send('HMAC validation failed.');

    const tokenResponse = await exchangeCodeForToken({ shop, code });
    upsertShop({ shop, accessToken: tokenResponse.access_token, scope: tokenResponse.scope });
    getSettings(shop);
    await registerAppUninstalledWebhook({ shop, accessToken: tokenResponse.access_token });

    res.clearCookie('shopify_app_state');
    res.redirect(`/app?shop=${encodeURIComponent(shop)}`);
  } catch (error) {
    console.error(error.response?.data || error);
    res.status(500).send(`OAuth callback failed: ${error.message}`);
  }
});

app.post('/webhooks/app/uninstalled', (req, res) => {
  const hmac = req.headers['x-shopify-hmac-sha256'];
  if (!verifyWebhookHmac(req.body, hmac)) return res.status(401).send('Invalid webhook signature.');

  const shop = sanitizeShop(req.headers['x-shopify-shop-domain']);
  if (shop) deleteShop(shop);
  res.status(200).send('ok');
});

app.get('/app', (req, res) => {
  const shop = sanitizeShop(req.query.shop);
  if (!shop) return res.redirect('/');
  if (!getShop(shop)) return res.redirect(`/auth?shop=${encodeURIComponent(shop)}`);
  res.sendFile(path.join(__dirname, '..', 'public', 'app.html'));
});

app.get('/api/config', ensureInstalled, (req, res) => {
  res.json({
    apiKey: process.env.SHOPIFY_API_KEY,
    appUrl: process.env.APP_URL,
    apiVersion: API_VERSION,
    shop: req.shop,
  });
});

app.get('/api/settings', ensureInstalled, (req, res) => {
  res.json(getSettings(req.shop));
});

app.post('/api/settings', ensureInstalled, (req, res) => {
  const payload = {
    shop: req.shop,
    image_quality: Math.max(40, Math.min(95, Number(req.body.image_quality || 82))),
    large_image_threshold_kb: Math.max(100, Math.min(5000, Number(req.body.large_image_threshold_kb || 400))),
    auto_scan: req.body.auto_scan ? 1 : 0,
  };
  res.json(upsertSettings(payload));
});

app.get('/api/shops', (_req, res) => {
  res.json({ shops: listShops() });
});

app.get('/api/scan', ensureInstalled, async (req, res) => {
  try {
    const settings = getSettings(req.shop);
    const first = Math.max(1, Math.min(100, Number(req.query.limit || 30)));
    const after = req.query.after || null;

    const query = `
      query ProductImageAudit($first: Int!, $after: String) {
        products(first: $first, after: $after, sortKey: UPDATED_AT) {
          pageInfo { hasNextPage endCursor }
          nodes {
            id
            title
            handle
            status
            featuredMedia {
              ... on MediaImage {
                id
                preview {
                  image {
                    id
                    url
                    width
                    height
                    fileSize
                  }
                }
              }
            }
          }
        }
      }
    `;

    const data = await adminGraphQL({
      shop: req.shop,
      accessToken: req.shopRecord.access_token,
      query,
      variables: { first, after },
    });

    const images = (data.products.nodes || []).map(extractImageMetrics).filter(Boolean);
    const summary = buildAuditSummary(images, settings.large_image_threshold_kb);

    const rows = images.map((item) => {
      const threshold = settings.large_image_threshold_kb;
      const kb = item.fileSizeKb || 0;
      const score = item.fileSizeKb == null ? 50 : kb < threshold * 0.5 ? 95 : kb < threshold ? 78 : kb < threshold * 2 ? 52 : 28;
      const recommendation = item.fileSizeKb == null
        ? 'File size unavailable from Shopify. Keep source images compressed and dimensions tight.'
        : kb >= threshold * 2
          ? 'Very large image. Resize and compress aggressively before upload.'
          : kb >= threshold
            ? 'Large image. Good candidate for optimization.'
            : 'Healthy image. No immediate action needed.';

      return {
        ...item,
        score,
        recommendation,
        estimatedSavedKb: item.fileSizeKb == null ? null : Math.max(Math.round(item.fileSizeKb * 0.35), 0),
      };
    });

    res.json({ settings, summary, rows, pageInfo: data.products.pageInfo });
  } catch (error) {
    console.error(error.response?.data || error);
    res.status(500).json({
      error: 'Failed to scan product images.',
      detail: error.response?.data || error.message,
    });
  }
});

app.get('/health', (_req, res) => {
  res.json({ ok: true, appUrl: process.env.APP_URL });
});

app.listen(PORT, () => {
  console.log(`Shopify app running on http://localhost:${PORT}`);
});
