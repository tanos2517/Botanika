'use strict';

function parsePlantAnalysis(text) {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('AI returned an invalid plant analysis');
  let result;
  try {
    result = JSON.parse(text.slice(start, end + 1));
  } catch {
    throw new Error('AI returned malformed plant analysis JSON');
  }
  const confidence = Number(result?.confidence);
  if (!result || typeof result.name !== 'string' || !result.name.trim()
    || !result.care || typeof result.care !== 'object' || Array.isArray(result.care)
    || !Number.isFinite(confidence) || confidence < 0 || confidence > 100
    || !Number.isFinite(Number(result.watering_days))) {
    throw new Error('AI response is missing required plant analysis fields');
  }
  result.confidence = Math.round(confidence);
  result.watering_days = Math.max(1, Math.min(60, Math.round(Number(result.watering_days))));
  result.problems = Array.isArray(result.problems)
    ? result.problems.filter(problem => typeof problem === 'string').slice(0, 5)
    : [];
  return result;
}

module.exports = { parsePlantAnalysis };
