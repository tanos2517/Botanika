'use strict';

const { authenticateTelegramRequest, verifyTelegramInitData } = require('./telegram-auth');
const { getWebSession } = require('./account-sync');

const COOKIE_NAME = 'botanika_sync';

function sessionToken(req) {
  const cookies = String(req.headers.cookie || '').split(';');
  for (const cookie of cookies) {
    const [name, ...parts] = cookie.trim().split('=');
    if (name === COOKIE_NAME) return parts.join('=');
  }
  return '';
}

async function authenticateWebSession(req) {
  const userId = await getWebSession(sessionToken(req));
  if (!userId) {
    const error = new Error('Connect this browser to your Telegram account first.');
    error.status = 401;
    throw error;
  }
  return { id: userId, method: 'web' };
}

async function authenticateAccountRequest(req) {
  const initData = Array.isArray(req.headers['x-telegram-init-data'])
    ? req.headers['x-telegram-init-data'][0]
    : req.headers['x-telegram-init-data'];
  if (initData) {
    const identity = verifyTelegramInitData(initData);
    if (identity) return { id: identity.id, method: 'telegram', user: identity.user };
    const error = new Error('Telegram authorization expired. Reopen Botanika from the bot.');
    error.status = 401;
    throw error;
  }

  const token = sessionToken(req);
  if (token) {
    const userId = await getWebSession(token);
    if (userId) return { id: userId, method: 'web' };
  }
  const error = new Error('Open Botanika from the Telegram bot and try again.');
  error.status = 401;
  throw error;
}

module.exports = {
  authenticateAccountRequest,
  authenticateTelegramRequest,
  authenticateWebSession
};
