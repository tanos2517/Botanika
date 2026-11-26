'use strict';

const crypto = require('crypto');
const { getSharedRecord } = require('../lib/account-sync');
const { REMINDER_QUEUE, getMiniAppSettings, validTimezone } = require('../lib/miniapp-settings');
const { reminderMessage } = require('../lib/reminder-messages');
const { redisCommand } = require('../lib/telegram-store');
const { telegram } = require('../lib/telegram-api');

const REMINDER_HOUR = 9;
const CHECK_INTERVAL_MS = 30 * 60 * 1000;
const LOCK_TTL_SECONDS = 180;
const SENT_TTL_SECONDS = 48 * 60 * 60;
const MAX_USERS_PER_RUN = 30;

function safeEqual(left, right) {
  const a = Buffer.from(String(left || ''));
  const b = Buffer.from(String(right || ''));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function localClock(timezone, now) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: validTimezone(timezone) || 'UTC',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(new Date(now));
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return {
    date: `${values.year}-${values.month}-${values.day}`,
    minutes: Number(values.hour) * 60 + Number(values.minute)
  };
}

async function processUser(userId, now) {
  const numericUserId = Number(userId);
  if (!Number.isSafeInteger(numericUserId) || numericUserId <= 0) {
    await redisCommand(['ZREM', REMINDER_QUEUE, String(userId)]);
    return false;
  }

  const lockKey = `botanika:reminder-lock:${userId}`;
  const lock = crypto.randomBytes(16).toString('hex');
  const acquired = await redisCommand(['SET', lockKey, lock, 'EX', LOCK_TTL_SECONDS, 'NX']);
  if (acquired !== 'OK') return false;

  let keepQueued = true;
  try {
    const settings = await getMiniAppSettings(String(userId), 'ru');
    if (!settings.remindersEnabled) {
      keepQueued = false;
      await redisCommand(['ZREM', REMINDER_QUEUE, String(userId)]);
      return false;
    }

    const clock = localClock(settings.timezone, now);
    if (clock.minutes < REMINDER_HOUR * 60) return false;
    const sentKey = `botanika:reminder-sent:${userId}:${clock.date}`;
    if (await redisCommand(['GET', sentKey])) return false;

    const shared = await getSharedRecord(String(userId));
    const duePlants = shared.greenhouse.filter(plant => {
      const days = Math.max(1, Number(plant.days) || 7);
      const last = Math.max(0, Number(plant.last) || 0);
      return last + days * 24 * 60 * 60 * 1000 <= now;
    });
    if (!duePlants.length) return false;

    const message = reminderMessage(settings.language, duePlants);
    await telegram('sendMessage', {
      chat_id: numericUserId,
      text: message.text,
      reply_markup: message.reply_markup,
      link_preview_options: { is_disabled: true }
    });
    await redisCommand(['SET', sentKey, '1', 'EX', SENT_TTL_SECONDS]);
    return true;
  } finally {
    if (keepQueued) {
      await redisCommand(['ZADD', REMINDER_QUEUE, String(now + CHECK_INTERVAL_MS), String(userId)]);
    }
    const currentLock = await redisCommand(['GET', lockKey]);
    if (currentLock === lock) await redisCommand(['DEL', lockKey]);
  }
}

module.exports = async function reminders(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const secret = process.env.SCHEDULER_SECRET;
  if (!secret) return res.status(503).json({ error: 'SCHEDULER_SECRET is not configured.' });
  const authorization = req.headers.authorization || '';
  if (!safeEqual(authorization, `Bearer ${secret}`)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const now = Date.now();
    const users = await redisCommand([
      'ZRANGEBYSCORE',
      REMINDER_QUEUE,
      '-inf',
      String(now),
      'LIMIT',
      '0',
      String(MAX_USERS_PER_RUN)
    ]);
    const results = await Promise.all((Array.isArray(users) ? users : []).map(async userId => {
      try {
        return await processUser(String(userId), now);
      } catch (error) {
        console.error(`Care reminder failed for Telegram account ${userId}:`, error.message);
        return false;
      }
    }));
    const sent = results.filter(Boolean).length;
    return res.status(200).json({ checked: Array.isArray(users) ? users.length : 0, sent });
  } catch (error) {
    console.error('Care reminder scheduler failed:', error.message);
    return res.status(502).json({ error: 'Could not process care reminders.' });
  }
};
