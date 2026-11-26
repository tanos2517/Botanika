'use strict';

const crypto = require('crypto');

const MAX_INIT_DATA_AGE_SECONDS = 24 * 60 * 60;

function verifyTelegramInitData(initData) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    const error = new Error('Telegram Mini App authentication is not configured');
    error.status = 503;
    throw error;
  }
  if (typeof initData !== 'string' || !initData || initData.length > 8192) return null;

  const params = new URLSearchParams(initData);
  const values = new Map();
  for (const [key, value] of params) {
    if (values.has(key)) return null;
    values.set(key, value);
  }

  const providedHash = values.get('hash') || '';
  if (!/^[a-f0-9]{64}$/i.test(providedHash)) return null;
  values.delete('hash');
  const authDate = Number(values.get('auth_date'));
  const now = Math.floor(Date.now() / 1000);
  if (!Number.isSafeInteger(authDate) || authDate > now + 30 || now - authDate > MAX_INIT_DATA_AGE_SECONDS) return null;

  const checkString = [...values.entries()]
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
  const secretKey = crypto.createHmac('sha256', 'WebAppData').update(token).digest();
  const expectedHash = crypto.createHmac('sha256', secretKey).update(checkString).digest();
  const receivedHash = Buffer.from(providedHash, 'hex');
  if (receivedHash.length !== expectedHash.length || !crypto.timingSafeEqual(receivedHash, expectedHash)) return null;

  let user;
  try {
    user = JSON.parse(values.get('user') || '');
  } catch {
    return null;
  }
  if (!user || !Number.isSafeInteger(user.id) || user.id <= 0) return null;
  return { id: String(user.id), user, authDate };
}

function requestInitData(req) {
  const value = req.headers['x-telegram-init-data'];
  return Array.isArray(value) ? value[0] : value;
}

async function authenticateTelegramRequest(req) {
  const identity = verifyTelegramInitData(requestInitData(req));
  if (!identity) {
    const error = new Error('Open Botanika from the Telegram bot and try again.');
    error.status = 401;
    throw error;
  }
  return identity;
}

module.exports = { authenticateTelegramRequest, verifyTelegramInitData };
