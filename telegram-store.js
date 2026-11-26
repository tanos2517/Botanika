'use strict';

const STATE_TTL_SECONDS = 60 * 60 * 24 * 90;

function redisConfig() {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) {
    const error = new Error('Upstash Redis storage is not configured');
    error.status = 503;
    throw error;
  }
  return { url: url.replace(/\/+$/, ''), token };
}

async function redisCommand(command) {
  const { url, token } = redisConfig();
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(command),
    signal: AbortSignal.timeout(8000)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.error) {
    throw new Error(data.error || `Telegram storage returned HTTP ${response.status}`);
  }
  return data.result;
}

async function getTelegramState(userId, language) {
  const raw = await redisCommand(['GET', `botanika:telegram:${userId}`]);
  if (!raw) return { lang: language, mode: '', chat: [], plants: [], analyses: [] };
  let state;
  try {
    state = JSON.parse(raw);
  } catch {
    throw new Error('Telegram user state is invalid JSON');
  }
  if (!state || typeof state !== 'object' || Array.isArray(state)) {
    throw new Error('Telegram user state has an invalid shape');
  }
  return {
    lang: typeof state.lang === 'string' ? state.lang : language,
    mode: typeof state.mode === 'string' ? state.mode : '',
    chat: Array.isArray(state.chat) ? state.chat.slice(-12) : [],
    plants: Array.isArray(state.plants) ? state.plants.slice(0, 30) : [],
    analyses: Array.isArray(state.analyses) ? state.analyses.slice(0, 10) : []
  };
}

async function saveTelegramState(userId, state) {
  await redisCommand([
    'SET',
    `botanika:telegram:${userId}`,
    JSON.stringify(state),
    'EX',
    STATE_TTL_SECONDS
  ]);
}

module.exports = { getTelegramState, saveTelegramState, redisCommand };
