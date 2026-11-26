'use strict';

const crypto = require('crypto');
const { redisCommand } = require('./telegram-store');

const LINK_TTL_SECONDS = 10 * 60;
const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;

const MERGE_SCRIPT = `
local raw = redis.call('GET', KEYS[1])
local current = raw and cjson.decode(raw) or {}
local incoming = cjson.decode(ARGV[1])
current.tombstones = current.tombstones or {}

local function mergeTombstones(name)
  local merged = {}
  for id, time in pairs((current.tombstones or {})[name] or {}) do
    merged[id] = tonumber(time) or 0
  end
  for id, time in pairs((incoming.tombstones or {})[name] or {}) do
    local value = tonumber(time) or 0
    if value > (merged[id] or 0) then merged[id] = value end
  end
  local ordered = {}
  for id, time in pairs(merged) do
    table.insert(ordered, { id = id, time = time })
  end
  table.sort(ordered, function(a, b) return a.time > b.time end)
  local bounded = {}
  for index, entry in ipairs(ordered) do
    if index > 500 then break end
    bounded[entry.id] = entry.time
  end
  current.tombstones[name] = bounded
end

local function mergeItems(name, limit)
  local byId = {}
  local function idString(value)
    if type(value) == 'number' then return string.format('%.0f', value) end
    return tostring(value)
  end
  local function add(item)
    if not item or item.id == nil then return end
    local id = idString(item.id)
    local old = byId[id]
    if not old or (tonumber(item.updatedAt) or 0) >= (tonumber(old.updatedAt) or 0) then
      byId[id] = item
    end
  end
  for _, item in ipairs(current[name] or {}) do add(item) end
  for _, item in ipairs(incoming[name] or {}) do add(item) end

  local items = {}
  local deleted = current.tombstones[name] or {}
  for id, item in pairs(byId) do
    local removedAt = tonumber(deleted[id])
    local changedAt = tonumber(item.updatedAt) or 0
    if not removedAt or removedAt < changedAt then table.insert(items, item) end
  end
  table.sort(items, function(a, b)
    return (tonumber(a.updatedAt) or 0) > (tonumber(b.updatedAt) or 0)
  end)
  while #items > limit do table.remove(items) end
  current[name] = items
end

mergeTombstones('history')
mergeTombstones('greenhouse')
mergeItems('history', 30)
mergeItems('greenhouse', 30)
current.updatedAt = tonumber(incoming.updatedAt) or tonumber(current.updatedAt) or 0
local encoded = cjson.encode(current)
redis.call('SET', KEYS[1], encoded)
return encoded
`;

const REDEEM_LINK_SCRIPT = `
local value = redis.call('GET', KEYS[1])
if value then redis.call('DEL', KEYS[1]) end
return value
`;

function isRecord(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
}

function boundedText(value, maxLength) {
  return typeof value === 'string' ? value.slice(0, maxLength) : '';
}

function validId(value) {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function ownedImagePath(value, userId) {
  const pathname = boundedText(value, 300);
  const ownerId = String(userId || '');
  if (!/^\d{1,20}$/.test(ownerId)
    || !pathname.startsWith(`photos/${ownerId}/`)
    || pathname.includes('..')
    || !/^photos\/\d{1,20}\/[A-Za-z0-9._-]+\.(?:jpg|png|webp)$/.test(pathname)) return '';
  return pathname;
}

function sanitizeHistoryItem(item, userId) {
  if (!isRecord(item)) return null;
  const id = validId(item.id);
  const name = boundedText(item.name, 120).trim();
  if (id === null || !name) return null;
  const care = isRecord(item.care) ? item.care : {};
  const confidence = Number(item.confidence);
  const problems = Array.isArray(item.problems)
    ? item.problems.filter(value => typeof value === 'string').slice(0, 10).map(value => value.slice(0, 180))
    : [];
  return {
    id,
    gardenId: validId(item.gardenId),
    telegramAnalysisId: boundedText(item.telegramAnalysisId, 80),
    imagePath: ownedImagePath(item.imagePath, userId),
    updatedAt: Math.max(0, Number(item.updatedAt) || 0),
    name,
    latin: boundedText(item.latin, 120),
    family: boundedText(item.family, 120),
    type: boundedText(item.type, 80),
    confidence: Number.isFinite(confidence) ? Math.max(0, Math.min(100, confidence)) : 0,
    description: boundedText(item.description, 1200),
    care: {
      water: boundedText(care.water, 300),
      light: boundedText(care.light, 300),
      soil: boundedText(care.soil, 300),
      temperature: boundedText(care.temperature, 300)
    },
    watering_days: Math.max(1, Math.min(60, Math.round(Number(item.watering_days) || 7))),
    problems,
    toxic: boundedText(item.toxic, 500),
    fun_fact: boundedText(item.fun_fact, 500),
    date: boundedText(item.date, 80)
  };
}

function sanitizeGreenhouseItem(item, userId) {
  if (!isRecord(item)) return null;
  const id = validId(item.id);
  const name = boundedText(item.name, 120).trim();
  if (id === null || !name) return null;
  return {
    id,
    updatedAt: Math.max(0, Number(item.updatedAt) || 0),
    name,
    days: Math.max(1, Math.min(60, Math.round(Number(item.days) || 7))),
    last: Math.max(0, Number(item.last) || 0),
    sourceAnalysisId: boundedText(item.sourceAnalysisId, 80),
    imagePath: ownedImagePath(item.imagePath, userId)
  };
}

function sanitizeTombstones(value) {
  const result = { history: {}, greenhouse: {} };
  if (!isRecord(value)) return result;
  for (const collection of ['history', 'greenhouse']) {
    if (!isRecord(value[collection])) continue;
    for (const [id, time] of Object.entries(value[collection]).slice(-500)) {
      const valid = validId(id);
      if (valid !== null) result[collection][String(valid)] = Math.max(0, Number(time) || 0);
    }
  }
  return result;
}

function sanitizeSyncRecord(value, userId) {
  if (!isRecord(value)) return { history: [], greenhouse: [], tombstones: { history: {}, greenhouse: {} } };
  const history = (Array.isArray(value.history) ? value.history : [])
    .map(item => sanitizeHistoryItem(item, userId)).filter(Boolean)
    .sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 30);
  const greenhouse = (Array.isArray(value.greenhouse) ? value.greenhouse : [])
    .map(item => sanitizeGreenhouseItem(item, userId)).filter(Boolean)
    .sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 30);
  return {
    history,
    greenhouse,
    tombstones: sanitizeTombstones(value.tombstones),
    updatedAt: Math.max(0, Number(value.updatedAt) || Date.now())
  };
}

async function createLinkCode(telegramUserId) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const code = crypto.randomBytes(6).toString('hex').toUpperCase();
    const result = await redisCommand([
      'SET',
      `botanika:link:${code}`,
      String(telegramUserId),
      'EX',
      LINK_TTL_SECONDS,
      'NX'
    ]);
    if (result === 'OK') return code;
  }
  throw new Error('Could not create a Telegram link code');
}

async function redeemLinkCode(code) {
  const value = await redisCommand([
    'EVAL',
    REDEEM_LINK_SCRIPT,
    '1',
    `botanika:link:${code}`
  ]);
  return value && /^\d{1,20}$/.test(String(value)) ? String(value) : null;
}

async function createWebSession(telegramUserId) {
  const token = crypto.randomBytes(32).toString('hex');
  await redisCommand([
    'SET',
    `botanika:websession:${token}`,
    String(telegramUserId),
    'EX',
    SESSION_TTL_SECONDS
  ]);
  return token;
}

async function getWebSession(token) {
  if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) return null;
  const value = await redisCommand(['GET', `botanika:websession:${token}`]);
  return value && /^\d{1,20}$/.test(String(value)) ? String(value) : null;
}

async function deleteWebSession(token) {
  if (typeof token === 'string' && /^[a-f0-9]{64}$/.test(token)) {
    await redisCommand(['DEL', `botanika:websession:${token}`]);
  }
}

async function getSharedRecord(telegramUserId) {
  const raw = await redisCommand(['GET', `botanika:shared:${telegramUserId}`]);
  if (!raw) return sanitizeSyncRecord({}, telegramUserId);
  let value;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error('Shared account data is invalid JSON');
  }
  return sanitizeSyncRecord(value, telegramUserId);
}

async function mergeSharedRecord(telegramUserId, incoming) {
  const record = sanitizeSyncRecord(incoming, telegramUserId);
  record.updatedAt = Date.now();
  const raw = await redisCommand([
    'EVAL',
    MERGE_SCRIPT,
    '1',
    `botanika:shared:${telegramUserId}`,
    JSON.stringify(record)
  ]);
  try {
    return sanitizeSyncRecord(JSON.parse(raw), telegramUserId);
  } catch {
    throw new Error('Could not read the merged account data');
  }
}

module.exports = {
  createLinkCode,
  createWebSession,
  deleteWebSession,
  getSharedRecord,
  getWebSession,
  mergeSharedRecord,
  redeemLinkCode,
  sanitizeSyncRecord
};
