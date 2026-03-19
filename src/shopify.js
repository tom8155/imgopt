const crypto = require('crypto');
const axios = require('axios');

const API_VERSION = process.env.SHOPIFY_API_VERSION || '2026-01';

function sanitizeShop(shop) {
  if (!shop || typeof shop !== 'string') return null;
  const trimmed = shop.trim().toLowerCase();
  const valid = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(trimmed);
  return valid ? trimmed : null;
}

function generateNonce() {
  return crypto.randomBytes(16).toString('hex');
}

function buildInstallUrl({ shop, state }) {
  const params = new URLSearchParams({
    client_id: process.env.SHOPIFY_API_KEY,
    scope: process.env.SHOPIFY_SCOPES,
    redirect_uri: `${process.env.APP_URL}/auth/callback`,
    state,
  });

  return `https://${shop}/admin/oauth/authorize?${params.toString()}`;
}

function verifyHmac(query) {
  const { hmac, signature, ...rest } = query;
  if (!hmac) return false;

  const message = Object.keys(rest)
    .sort()
    .map((key) => {
      const value = Array.isArray(rest[key]) ? rest[key].join(',') : `${rest[key]}`;
      return `${key}=${value}`;
    })
    .join('&');

  const generated = crypto
    .createHmac('sha256', process.env.SHOPIFY_API_SECRET)
    .update(message)
    .digest('hex');

  try {
    return crypto.timingSafeEqual(Buffer.from(generated), Buffer.from(hmac));
  } catch {
    return false;
  }
}

async function exchangeCodeForToken({ shop, code }) {
  const response = await axios.post(
    `https://${shop}/admin/oauth/access_token`,
    {
      client_id: process.env.SHOPIFY_API_KEY,
      client_secret: process.env.SHOPIFY_API_SECRET,
      code,
    },
    {
      headers: {
        'Content-Type': 'application/json',
      },
    },
  );

  return response.data;
}

async function adminGraphQL({ shop, accessToken, query, variables = {} }) {
  const response = await axios.post(
    `https://${shop}/admin/api/${API_VERSION}/graphql.json`,
    { query, variables },
    {
      headers: {
        'X-Shopify-Access-Token': accessToken,
        'Content-Type': 'application/json',
      },
      timeout: 30000,
    },
  );

  if (response.data.errors?.length) {
    throw new Error(response.data.errors.map((e) => e.message).join('; '));
  }

  return response.data.data;
}

function extractImageMetrics(node) {
  const preview = node?.featuredMedia?.preview?.image;
  if (!preview) return null;

  const width = preview.width || 0;
  const height = preview.height || 0;
  const originalSrc = preview.url;
  const fileSize = preview.fileSize || null;
  const fileSizeKb = fileSize ? Math.round(fileSize / 1024) : null;
  const megapixels = width && height ? Number(((width * height) / 1000000).toFixed(2)) : null;

  return {
    productId: node.id,
    title: node.title,
    handle: node.handle,
    status: node.status,
    imageId: preview.id,
    src: originalSrc,
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

  return {
    totalImages: total,
    oversizedImages: oversized.length,
    missingSizeData: missingSize.length,
    averageKb,
    estimatedSavingsKb: oversized.reduce((sum, item) => {
      const current = item.fileSizeKb || 0;
      const target = Math.max(Math.round(current * 0.45), thresholdKb * 0.6);
      return sum + Math.max(current - target, 0);
    }, 0),
  };
}

module.exports = {
  adminGraphQL,
  API_VERSION,
  buildAuditSummary,
  buildInstallUrl,
  exchangeCodeForToken,
  extractImageMetrics,
  generateNonce,
  sanitizeShop,
  verifyHmac,
};
