'use strict';

const API_URL = 'https://openrouter.ai/api/v1/chat/completions';

async function askOpenRouter(messages, maxTokens, timeoutMs = 60000) {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) {
    const error = new Error('OPENROUTER_API_KEY is not configured on the server');
    error.status = 503;
    throw error;
  }

  const response = await fetch(API_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': process.env.APP_URL || 'https://vercel.app',
      'X-Title': 'Botanika AI Pro'
    },
    body: JSON.stringify({
      model: process.env.OPENROUTER_MODEL || 'nvidia/nemotron-3.5-super-vl:free',
      messages,
      max_tokens: Math.max(100, Math.min(3000, Number(maxTokens) || 1200))
    }),
    signal: AbortSignal.timeout(timeoutMs)
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error?.message || `AI provider returned HTTP ${response.status}`);
    error.status = response.status === 429 ? 429 : 502;
    throw error;
  }
  const text = data.choices?.[0]?.message?.content;
  if (typeof text !== 'string' || !text.trim()) {
    const error = new Error('AI provider returned an empty response');
    error.status = 502;
    throw error;
  }
  return text;
}

function sendError(res, error) {
  const status = Number.isInteger(error.status) ? error.status : 502;
  res.status(status).json({ error: error.message || 'The request failed' });
}

function requestBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') {
    try { return JSON.parse(req.body); } catch { return null; }
  }
  return null;
}

module.exports = { askOpenRouter, sendError, requestBody };

