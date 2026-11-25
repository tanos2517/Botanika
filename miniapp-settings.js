'use strict';

const { redisCommand } = require('./telegram-store');
const LANGUAGES = require('./languages');

const SETTINGS_PREFIX = 'botanika:miniapp-settings:';
const REMINDER_QUEUE = 'botanika:reminder-queue';
const SAVE_SETTINGS_SCRIPT = `
local value = cjson.decode(ARGV[1])
redis.call('SET', KEYS[1], ARGV[1])
if value.remindersEnabled then
  redis.call('ZADD', KEYS[2], tonumber(ARGV[2]), ARGV[3])
else
  redis.call('ZREM', KEYS[2], ARGV[3])
end
return ARGV[1]
`;

function validTimezone(value) {
  if (typeof value !== 'string' || value.length > 100) return '';
  try {
    new Intl.DateTimeFormat('en', { timeZone: value }).format();
    return value;
  } catch {
    return '';
  }
}

function defaultSettings(language, timezone) {
  return {
    language: Object.prototype.hasOwnProperty.call(LANGUAGES, language) ? language : 'ru',
    timezone: validTimezone(timezone) || 'UTC',
    remindersEnabled: false,
    reminderHour: 9
  };
}

async function getMiniAppSettings(userId, language, timezone) {
  const raw = await redisCommand(['GET', `${SETTINGS_PREFIX}${userId}`]);
  if (!raw) return defaultSettings(language, timezone);
  let value;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error('Mini App settings are invalid JSON');
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Mini App settings have an invalid shape');
  }
  return {
    language: Object.prototype.hasOwnProperty.call(LANGUAGES, value.language)
      ? value.language
      : defaultSettings(language, timezone).language,
    timezone: validTimezone(value.timezone) || validTimezone(timezone) || 'UTC',
    remindersEnabled: value.remindersEnabled === true,
    reminderHour: 9
  };
}

async function saveMiniAppSettings(userId, settings) {
  const language = Object.prototype.hasOwnProperty.call(LANGUAGES, settings.language)
    ? settings.language
    : 'ru';
  const timezone = validTimezone(settings.timezone) || 'UTC';
  const remindersEnabled = settings.remindersEnabled === true;
  const value = { language, timezone, remindersEnabled, reminderHour: 9 };
  await redisCommand([
    'EVAL',
    SAVE_SETTINGS_SCRIPT,
    '2',
    `${SETTINGS_PREFIX}${userId}`,
    REMINDER_QUEUE,
    JSON.stringify(value),
    String(Date.now()),
    String(userId)
  ]);
  return value;
}

module.exports = {
  REMINDER_QUEUE,
  defaultSettings,
  getMiniAppSettings,
  saveMiniAppSettings,
  validTimezone
};
