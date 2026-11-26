'use strict';

const { redisCommand } = require('./telegram-store');
const { sanitizeSyncRecord } = require('./account-sync');

const SAVE_ARCHIVE_SCRIPT = `
local item = cjson.decode(ARGV[1])
local oldRaw = redis.call('GET', KEYS[1])
if oldRaw then
  local old = cjson.decode(oldRaw)
  if (tonumber(old.updatedAt) or 0) > (tonumber(item.updatedAt) or 0) then
    item = old
  end
end
local encoded = cjson.encode(item)
redis.call('SET', KEYS[1], encoded)
redis.call('ZADD', KEYS[2], tonumber(item.updatedAt) or 0, tostring(item.id))
return encoded
`;

const DELETE_ARCHIVE_SCRIPT = `
redis.call('DEL', KEYS[1])
redis.call('ZREM', KEYS[2], ARGV[1])
return 1
`;

function archiveKeys(userId, itemId) {
  return {
    item: `botanika:archive:${userId}:${itemId}`,
    index: `botanika:archive-index:${userId}`
  };
}

function cleanArchiveItem(item, userId) {
  const cleaned = sanitizeSyncRecord({ history: [item] }, userId).history[0];
  if (!cleaned) throw new Error('Analysis record is invalid');
  return cleaned;
}

async function saveArchiveItem(userId, item) {
  const clean = cleanArchiveItem(item, userId);
  const keys = archiveKeys(userId, clean.id);
  const raw = await redisCommand([
    'EVAL',
    SAVE_ARCHIVE_SCRIPT,
    '2',
    keys.item,
    keys.index,
    JSON.stringify(clean)
  ]);
  return cleanArchiveItem(JSON.parse(raw), userId);
}

async function getArchiveItem(userId, itemId) {
  const id = Number(itemId);
  if (!Number.isSafeInteger(id) || id <= 0) return null;
  const { item } = archiveKeys(userId, id);
  const raw = await redisCommand(['GET', item]);
  if (!raw) return null;
  return cleanArchiveItem(JSON.parse(raw));
}

async function listArchive(userId, offset, limit) {
  const start = Math.max(0, Math.min(1000000, Math.floor(Number(offset) || 0)));
  const size = Math.max(1, Math.min(30, Math.floor(Number(limit) || 20)));
  const { index } = archiveKeys(userId, 0);
  const [ids, total] = await Promise.all([
    redisCommand(['ZREVRANGE', index, String(start), String(start + size - 1)]),
    redisCommand(['ZCARD', index])
  ]);
  if (!Array.isArray(ids) || !ids.length) return { items: [], total: Number(total) || 0 };
  const rawItems = await redisCommand(['MGET', ...ids.map(id => archiveKeys(userId, id).item)]);
  const items = (Array.isArray(rawItems) ? rawItems : [])
    .filter(Boolean)
    .map(raw => cleanArchiveItem(JSON.parse(raw), userId));
  return { items, total: Number(total) || 0 };
}

async function deleteArchiveItem(userId, itemId) {
  const id = Number(itemId);
  if (!Number.isSafeInteger(id) || id <= 0) return false;
  const keys = archiveKeys(userId, id);
  await redisCommand(['EVAL', DELETE_ARCHIVE_SCRIPT, '2', keys.item, keys.index, String(id)]);
  return true;
}

module.exports = { deleteArchiveItem, getArchiveItem, listArchive, saveArchiveItem };
