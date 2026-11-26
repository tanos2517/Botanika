'use strict';

const crypto = require('crypto');
const { askOpenRouter, requestBody } = require('../lib/openrouter');
const LANGUAGES = require('../lib/languages');
const { parsePlantAnalysis } = require('../lib/plant-analysis');
const { putPlantPhoto, parseImageDataUrl, deletePlantPhoto } = require('../lib/blob-storage');
const { deleteArchiveItem, getArchiveItem, listArchive, saveArchiveItem } = require('../lib/archive-store');
const { authenticateTelegramRequest } = require('../lib/telegram-auth');
const { getTelegramState, saveTelegramState, redisCommand } = require('../lib/telegram-store');
const { getSharedRecord, mergeSharedRecord } = require('../lib/account-sync');
const { getMiniAppSettings, saveMiniAppSettings, validTimezone } = require('../lib/miniapp-settings');

const ARCHIVE_MIGRATION_PREFIX = 'botanika:archive-migrated:';
const ANALYSIS_RATE_SECONDS = 8;

function createSharedId() {
  return Math.floor(Date.now() / 1000) * 100000 + crypto.randomInt(100000);
}

function languageFromTelegram(user) {
  const requested = String(user.language_code || 'ru').split('-')[0];
  return Object.prototype.hasOwnProperty.call(LANGUAGES, requested) ? requested : 'ru';
}

function sharedHistoryItem(analysis) {
  const result = analysis.result || {};
  return {
    id: analysis.recordId,
    gardenId: analysis.gardenId,
    telegramAnalysisId: analysis.id,
    updatedAt: analysis.createdAt || Date.now(),
    name: analysis.name,
    latin: result.latin || '',
    family: result.family || '',
    type: result.type || '',
    confidence: result.confidence || 0,
    description: result.description || '',
    care: result.care || {},
    watering_days: analysis.wateringDays,
    problems: result.problems || [],
    toxic: result.toxic || '',
    fun_fact: result.fun_fact || '',
    imagePath: analysis.imagePath || '',
    date: new Date(analysis.createdAt || Date.now()).toISOString()
  };
}

async function migrateLegacyArchive(userId, state, shared) {
  const marker = `${ARCHIVE_MIGRATION_PREFIX}${userId}`;
  if (await redisCommand(['GET', marker])) return;

  for (const analysis of state.analyses) {
    if (!Number.isSafeInteger(analysis.recordId) || analysis.recordId <= 0) {
      analysis.recordId = createSharedId();
    }
    if (!Number.isSafeInteger(analysis.gardenId) || analysis.gardenId <= 0) {
      analysis.gardenId = createSharedId();
    }
    if (analysis.name && analysis.result) {
      await saveArchiveItem(userId, sharedHistoryItem(analysis));
    }
    analysis.archiveSynced = true;
  }
  if (state.analyses.length) await saveTelegramState(userId, state);

  for (const item of shared.history) await saveArchiveItem(userId, item);
  await redisCommand(['SET', marker, '1']);
}

function parseBaseUrl(req) {
  return new URL(req.url, 'https://botanika.invalid');
}

function imageAnalysisPrompt(language) {
  return `You are a careful botanist. Identify the plant in the attached image and answer in ${language}. Return ONLY a valid JSON object with fields: {"name":"","latin":"","family":"","type":"","confidence":0,"description":"","care":{"water":"","light":"","soil":"","temperature":""},"watering_days":7,"problems":[],"toxic":"","fun_fact":""}. Use a whole number for confidence and watering_days (1-60). Mention visible symptoms without claiming a certain disease from an image alone. Give safe, practical care advice and clearly state uncertainty.`;
}

async function analyzeImage(userId, language, imageData) {
  const { bytes, contentType } = parseImageDataUrl(imageData);
  const rateKey = `botanika:miniapp-analysis-rate:${userId}`;
  const allowed = await redisCommand(['SET', rateKey, '1', 'EX', ANALYSIS_RATE_SECONDS, 'NX']);
  if (allowed !== 'OK') {
    const error = new Error('Please wait a few seconds before analyzing another photo.');
    error.status = 429;
    throw error;
  }

  const image = `data:${contentType};base64,${bytes.toString('base64')}`;
  const text = await askOpenRouter([
    { role: 'system', content: imageAnalysisPrompt(LANGUAGES[language] || LANGUAGES.en) },
    {
      role: 'user',
      content: [
        { type: 'text', text: 'Identify this plant and provide the requested care information.' },
        { type: 'image_url', image_url: { url: image } }
      ]
    }
  ], 1200, 35000);
  const result = parsePlantAnalysis(text);
  const imagePath = await putPlantPhoto(userId, bytes, contentType);
  const id = createSharedId();
  const timestamp = Date.now();
  const analysis = {
    id,
    gardenId: createSharedId(),
    telegramAnalysisId: `miniapp:${id}`,
    updatedAt: timestamp,
    name: result.name.trim(),
    latin: result.latin || '',
    family: result.family || '',
    type: result.type || '',
    confidence: result.confidence,
    description: result.description || '',
    care: result.care,
    watering_days: result.watering_days,
    problems: result.problems,
    toxic: result.toxic || '',
    fun_fact: result.fun_fact || '',
    imagePath,
    date: new Date(timestamp).toISOString()
  };

  try {
    await saveArchiveItem(userId, analysis);
    await mergeSharedRecord(userId, { history: [analysis] });
  } catch (error) {
    try {
      await mergeSharedRecord(userId, {
        tombstones: { history: { [String(analysis.id)]: Date.now() } }
      });
    } catch (cleanupError) {
      console.error('Could not remove an incomplete Mini App analysis from shared history:', cleanupError.message);
    }
    try {
      await deleteArchiveItem(userId, analysis.id);
    } catch (cleanupError) {
      console.error('Could not remove an incomplete plant analysis:', cleanupError.message);
    }
    try {
      await deletePlantPhoto(userId, imagePath);
    } catch (cleanupError) {
      console.error('Could not remove an unlinked plant photo:', cleanupError.message);
    }
    throw error;
  }
  return analysis;
}

async function updateSettings(userId, body, currentSettings) {
  if (body.language !== undefined
    && (typeof body.language !== 'string' || !Object.prototype.hasOwnProperty.call(LANGUAGES, body.language))) {
    const error = new Error('Select a supported language.');
    error.status = 400;
    throw error;
  }
  if (body.timezone !== undefined && !validTimezone(body.timezone)) {
    const error = new Error('Select a valid time zone.');
    error.status = 400;
    throw error;
  }
  if (body.remindersEnabled !== undefined && typeof body.remindersEnabled !== 'boolean') {
    const error = new Error('Reminder preference must be true or false.');
    error.status = 400;
    throw error;
  }
  const language = typeof body.language === 'string' && Object.prototype.hasOwnProperty.call(LANGUAGES, body.language)
    ? body.language
    : currentSettings.language;
  const timezone = validTimezone(body.timezone) || currentSettings.timezone;
  const remindersEnabled = typeof body.remindersEnabled === 'boolean'
    ? body.remindersEnabled
    : currentSettings.remindersEnabled;
  const settings = await saveMiniAppSettings(userId, { language, timezone, remindersEnabled });
  const state = await getTelegramState(userId, language);
  if (state.lang !== language) {
    state.lang = language;
    await saveTelegramState(userId, state);
  }
  return settings;
}

module.exports = async function miniapp(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const identity = await authenticateTelegramRequest(req);
    const timezoneHeader = req.headers['x-time-zone'];
    const timezone = validTimezone(Array.isArray(timezoneHeader) ? timezoneHeader[0] : timezoneHeader);
    const language = languageFromTelegram(identity.user);
    const state = await getTelegramState(identity.id, language);
    const settings = await getMiniAppSettings(identity.id, state.lang || language, timezone);

    if (req.method === 'GET') {
      const shared = await getSharedRecord(identity.id);
      await migrateLegacyArchive(identity.id, state, shared);
      const pageUrl = parseBaseUrl(req);
      const offset = pageUrl.searchParams.get('offset');
      const limit = pageUrl.searchParams.get('limit');
      const page = await listArchive(identity.id, offset, limit);
      return res.status(200).json({
        user: { firstName: String(identity.user.first_name || '').slice(0, 80) },
        settings,
        history: page.items,
        totalHistory: page.total,
        greenhouse: shared.greenhouse
      });
    }

    const body = requestBody(req);
    if (!body || typeof body !== 'object' || Array.isArray(body)
      || JSON.stringify(body).length > 3800000) {
      return res.status(413).json({ error: 'The request is invalid or too large.' });
    }

    if (body.action === 'settings') {
      const next = await updateSettings(identity.id, body, settings);
      return res.status(200).json({ settings: next });
    }

    if (body.action === 'analyze') {
      const analysis = await analyzeImage(identity.id, settings.language, body.image);
      return res.status(201).json({ analysis });
    }

    if (body.action === 'water') {
      const id = Number(body.id);
      if (!Number.isSafeInteger(id) || id <= 0) return res.status(400).json({ error: 'Invalid plant id.' });
      const shared = await getSharedRecord(identity.id);
      const plant = shared.greenhouse.find(item => item.id === id);
      if (!plant) return res.status(404).json({ error: 'Plant not found.' });
      plant.last = Date.now();
      plant.updatedAt = plant.last;
      const merged = await mergeSharedRecord(identity.id, { greenhouse: [plant] });
      return res.status(200).json({ greenhouse: merged.greenhouse });
    }

    if (body.action === 'add-to-greenhouse') {
      const analysis = await getArchiveItem(identity.id, body.id);
      if (!analysis) return res.status(404).json({ error: 'Analysis not found.' });
      const shared = await getSharedRecord(identity.id);
      const sourceAnalysisId = analysis.telegramAnalysisId || `archive:${analysis.id}`;
      if (shared.greenhouse.some(item => item.sourceAnalysisId === sourceAnalysisId)) {
        return res.status(200).json({ greenhouse: shared.greenhouse, alreadyAdded: true });
      }
      const plant = {
        id: analysis.gardenId || analysis.id,
        updatedAt: Date.now(),
        name: analysis.name,
        days: analysis.watering_days,
        last: Date.now(),
        sourceAnalysisId,
        imagePath: analysis.imagePath
      };
      const merged = await mergeSharedRecord(identity.id, { greenhouse: [plant] });
      return res.status(200).json({ greenhouse: merged.greenhouse, alreadyAdded: false });
    }

    if (body.action === 'delete-history') {
      const analysis = await getArchiveItem(identity.id, body.id);
      if (!analysis) return res.status(404).json({ error: 'Analysis not found.' });
      const shared = await getSharedRecord(identity.id);
      await mergeSharedRecord(identity.id, {
        tombstones: { history: { [String(analysis.id)]: Date.now() } }
      });
      await deleteArchiveItem(identity.id, analysis.id);
      if (analysis.imagePath
        && !shared.greenhouse.some(plant => plant.imagePath === analysis.imagePath)) {
        await deletePlantPhoto(identity.id, analysis.imagePath);
      }
      return res.status(200).json({ deleted: true });
    }

    return res.status(400).json({ error: 'Unknown Mini App action.' });
  } catch (error) {
    console.error('Telegram Mini App request failed:', error.message);
    const status = Number.isInteger(error.status) ? error.status : 502;
    return res.status(status).json({ error: error.message || 'Mini App request failed.' });
  }
};
