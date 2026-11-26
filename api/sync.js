'use strict';

const { requestBody } = require('../lib/openrouter');
const { deleteArchiveItem, getArchiveItem, saveArchiveItem } = require('../lib/archive-store');
const { deletePlantPhoto } = require('../lib/blob-storage');
const {
  createWebSession,
  deleteWebSession,
  getSharedRecord,
  getWebSession,
  mergeSharedRecord,
  redeemLinkCode
} = require('../lib/account-sync');

const COOKIE_NAME = 'botanika_sync';

function sessionToken(req) {
  const cookies = String(req.headers.cookie || '').split(';');
  for (const cookie of cookies) {
    const [name, ...parts] = cookie.trim().split('=');
    if (name === COOKIE_NAME) return parts.join('=');
  }
  return '';
}

function setSessionCookie(res, token) {
  res.setHeader(
    'Set-Cookie',
    `${COOKIE_NAME}=${token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=2592000`
  );
}

function clearSessionCookie(res) {
  res.setHeader(
    'Set-Cookie',
    `${COOKIE_NAME}=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0`
  );
}

module.exports = async function sync(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const body = req.method === 'POST' ? requestBody(req) : null;
    if (req.method === 'POST' && (!body || typeof body !== 'object' || Array.isArray(body))) {
      return res.status(400).json({ error: 'Invalid sync request' });
    }
    if (body && JSON.stringify(body).length > 500000) {
      return res.status(413).json({ error: 'Sync data is too large' });
    }

    if (req.method === 'POST' && body.action === 'link') {
      const code = typeof body.code === 'string' ? body.code.trim().toUpperCase() : '';
      if (!/^[A-F0-9]{12}$/.test(code)) {
        return res.status(400).json({ error: 'Enter the 12-character code from the Telegram bot.' });
      }
      const telegramUserId = await redeemLinkCode(code);
      if (!telegramUserId) {
        return res.status(400).json({ error: 'That code has expired or was already used. Request a new code in Telegram.' });
      }
      const token = await createWebSession(telegramUserId);
      setSessionCookie(res, token);
      return res.status(200).json({ linked: true });
    }

    const token = sessionToken(req);
    const telegramUserId = await getWebSession(token);
    if (!telegramUserId) {
      clearSessionCookie(res);
      return res.status(401).json({ error: 'Connect this site to your Telegram account first.' });
    }

    if (req.method === 'GET') {
      const record = await getSharedRecord(telegramUserId);
      return res.status(200).json({ linked: true, record });
    }

    if (body.action === 'disconnect') {
      await deleteWebSession(token);
      clearSessionCookie(res);
      return res.status(200).json({ linked: false });
    }

    const record = await mergeSharedRecord(telegramUserId, body);
    for (const item of record.history) await saveArchiveItem(telegramUserId, item);
    const deletedIds = Object.keys(body.tombstones?.history || {}).slice(-30);
    for (const id of deletedIds) {
      const item = await getArchiveItem(telegramUserId, id);
      await deleteArchiveItem(telegramUserId, id);
      if (item?.imagePath && !record.greenhouse.some(plant => plant.imagePath === item.imagePath)) {
        await deletePlantPhoto(telegramUserId, item.imagePath);
      }
    }
    return res.status(200).json({ linked: true, record });
  } catch (error) {
    console.error('Account sync failed:', error.message);
    const status = Number.isInteger(error.status) ? error.status : 502;
    return res.status(status).json({ error: error.message || 'Account sync failed' });
  }
};
