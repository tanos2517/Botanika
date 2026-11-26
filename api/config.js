'use strict';

module.exports = function publicConfig(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const username = String(process.env.TELEGRAM_BOT_USERNAME || '').trim().replace(/^@/, '');
  if (!/^[A-Za-z0-9_]{5,32}$/.test(username)) {
    return res.status(503).json({ error: 'TELEGRAM_BOT_USERNAME is not configured.' });
  }

  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json({ telegramBotUrl: `https://t.me/${username}` });
};
