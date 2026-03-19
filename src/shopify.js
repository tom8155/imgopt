const crypto = require('crypto');
const axios = require('axios');

const API_VERSION = process.env.SHOPIFY_API_VERSION || '2026-01';
const WEBHOOK_API_VERSION = process.env.WEBHOOK_API_VERSION || API_VERSION;

function sanitizeShop(shop) {
  if (!shop || typeof shop !== 'string') return null;

  const trimmed = shop.trim().toLowerCase();
  return /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(trimmed) ? trimmed : null;
}

function generateNonce() {
  return crypto.randomBytes(16).toString('hex');
}

function normalizeAppUrl() {
  const raw = process.env.APP_URL;
  if (!raw) {
    throw new Error('Missing APP_URL environment variable');
  }
  return raw.replace(/\/+$/, '');
}

function verifyHmac(query) {
  const { hmac, signature, ...rest } = query;

  if (!hmac) return false;

  const message = Object.keys(rest)
    .sort()
    .map((key) => {
      const value = Array.isArray(rest[key]) ? rest[key].join(',') : String(rest[key]);
      return `${key}=${value}`;
    })
    .join('&');

  const generated = crypto
    .createHmac('sha256', process.env.SHOPIFY_API_SECRET)
    .update(message)
    .digest('hex');

  try {
    return crypto.timingSafeEqual(
      Buffer.from(generated, 'utf8'),
      Buffer.from(hmac, 'utf8')
    );
  } catch {
    return false;
  }
}

function verifyWebhookHmac(rawBody, hmacHeader) {
  if (!hmacHeader || !rawBody) return false;

  const digest = crypto
    .createHmac('sha256', process.env.SHOPIFY_API_SECRET)
    .update(rawBody)
    .digest('base64');

  try {
    return crypto.timingSafeEqual(
      Buffer.from(digest, 'utf8'),
      Buffer.from(hmacHeader, 'utf8')
    );
  } catch {
    return false;
  }
}

function buildInstallUrl({ shop, state }) {
  const cleanShop = sanitizeShop(shop);
  if (!cleanShop) {
    throw new Error('Invalid Shopify shop domain');
  }

  const appUrl = normalizeAppUrl();
  const scopes = process.env.SHOPIFY_SCOPES || 'read_products,write_products';

  const params = new URLSearchParams({
    client_id: process.env.SHOPIFY_API_KEY,
    scope: scopes,
    redirect_uri: `${appUrl}/auth/callback`,
    state,
  });

  return `https://${cleanShop}/admin/oauth/authorize?${params.toString()}`;
}

async function exchangeCodeForToken({ shop, code }) {
  const cleanShop = sanitizeShop(shop);
  if (!cleanShop) {
    throw new Error('Invalid Shopify shop domain');
  }

  const response = await axios.post(
    `https://${cleanShop}/admin/oauth/access_token`,
    {
      client_id: process.env.SHOPIFY_API_KEY,
      client_secret: process.env.SHOPIFY_API_SECRET,
      code,
    },
    {
      headers: {
        'Content-Type': 'application/json',
      },
      timeout: 30000,
    }
  );

  return response.data;
}

async function adminGraphQL({ shop, accessToken, query, variables = {} }) {
  const cleanShop = sanitizeShop(shop);
  if (!cleanShop) {
    throw new Error('Invalid Shopify shop domain');
  }

  const response = await axios.post(
    `https://${cleanShop}/admin/api/${API_VERSION}/graphql.json`,
    { query, variables },
    {
      headers: {
        'X-Shopify-Access-Token': accessToken,
        'Content-Type': 'application/json',
      },
      timeout: 30000,
    }
  );

  if (response.data.errors?.length) {
    throw new Error(response.data.errors.map((e) => e.message).join('; '));
  }

  if (response.data.data && Object.values(response.data.data).some((v) => v?.userErrors?.length)) {
    const messages = [];

    for (const value of Object.values(response.data.data)) {
      if (value?.userErrors?.length) {
        messages.push(...value.userErrors.map((e) => e.message));
      }
    }

    if (messages.length) {
      throw new Error(messages.join('; '));
    }
  }

  return response.data.data;
}

async function registerAppUninstalledWebhook({ shop, accessToken }) {
  const appUrl = normalizeAppUrl();

  const query = `
    mutation RegisterWebhook($topic: WebhookSubscriptionTopic!, $uri: URL!) {
      webhookSubscriptionCreate(
        topic: $topic,
        webhookSubscription: { callbackUrl: $uri, format: JSON }
      ) {
        webhookSubscription { id topic uri }
        userErrors { field message }
      }
    }
  `;

  return adminGraphQL({
    shop,
    accessToken,
    query,
    variables: {
      topic: 'APP_UNINSTALLED',
      uri: `${appUrl}/webhooks/app/uninstalled`,
    },
  });
}

function extractImageMetrics(node) {
  const preview = node?.featuredMedia?.preview?.image;
  if (!preview) return null;

  const width = preview.width || 0;
  const height = preview.height || 0;
  const fileSize = preview.fileSize || null;
  const fileSizeKb = fileSize ? Math.round(fileSize / 1024) : null;
  const megapixels =
    width && height ? Number(((width * height) / 1000000).toFixed(2)) : null;

  return {
    productId: node.id,
    title: node.title,
    handle: node.handle,
    status: node.status,
    imageId: preview.id,
    src: preview.url,
    width,
    height,
    megapixels,
    fileSize,
    fileSizeKb,
  };
}

function buildAuditSummary(images, thresholdKb = 400) {
  const total = images.length;
  const oversized = images.filter((item) => (item.fileSizeKb || 0) >= thresholdKb);
  const missingSize = images.filter((item) => item.fileSizeKb == null);

  const averageKb = total
    ? Math.round(images.reduce((sum, item) => sum + (item.fileSizeKb || 0), 0) / total)
    : 0;

  const estimatedSavingsKb = oversized.reduce((sum, item) => {
    const current = item.fileSizeKb || 0;
    const target = Math.max(Math.round(current * 0.45), thresholdKb * 0.6);
    return sum + Math.max(current - target, 0);
  }, 0);

  return {
    totalImages: total,
    oversizedImages: oversized.length,
    missingSizeData: missingSize.length,
    averageKb,
    estimatedSavingsKb,
  };
}

module.exports = {
  API_VERSION,
  WEBHOOK_API_VERSION,
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
};
