const { askOpenRouter, sendError, requestBody } = require('../lib/openrouter');

const languages = {
  ru: 'Russian', en: 'English', uz: 'Uzbek', az: 'Azerbaijani', de: 'German',
  fr: 'French', es: 'Spanish', pt: 'Portuguese', ar: 'Arabic', tr: 'Turkish',
  uk: 'Ukrainian', kk: 'Kazakh', ky: 'Kyrgyz', tg: 'Tajik', fa: 'Persian',
  hi: 'Hindi', bn: 'Bengali', zh: 'Chinese', ja: 'Japanese', ko: 'Korean',
  it: 'Italian', nl: 'Dutch', pl: 'Polish', cs: 'Czech', sk: 'Slovak',
  sv: 'Swedish', no: 'Norwegian', da: 'Danish', fi: 'Finnish', el: 'Greek',
  he: 'Hebrew', id: 'Indonesian', ms: 'Malay', th: 'Thai', vi: 'Vietnamese', ro: 'Romanian'
};

function parseJson(text) {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('AI returned an invalid encyclopedia response');
  return JSON.parse(text.slice(start, end + 1));
}

async function findImages(query) {
  const url = new URL('https://commons.wikimedia.org/w/api.php');
  url.search = new URLSearchParams({
    action: 'query',
    generator: 'search',
    gsrsearch: `${query} plant`,
    gsrnamespace: '6',
    gsrsetlang: 'en',
    gsrlimit: '6',
    prop: 'imageinfo',
    iiprop: 'url',
    iiurlwidth: '700',
    format: 'json'
  });
  const response = await fetch(url, {
    headers: { 'User-Agent': 'BotanikaAI/1.0 (plant encyclopedia)' },
    signal: AbortSignal.timeout(12000)
  });
  if (!response.ok) throw new Error(`Wikimedia returned HTTP ${response.status}`);
  const data = await response.json();
  return Object.values(data.query?.pages || {})
    .filter(page => page.imageinfo?.[0]?.thumburl)
    .map(page => ({
      title: page.title,
      url: page.imageinfo[0].thumburl,
      page_url: page.imageinfo[0].descriptionurl
    }));
}

async function findWikipedia(query, language) {
  const url = new URL(`https://${language}.wikipedia.org/w/api.php`);
  url.search = new URLSearchParams({
    action: 'query',
    generator: 'search',
    gsrsearch: query,
    gsrlimit: '1',
    prop: 'extracts|info|pageimages',
    exintro: '1',
    explaintext: '1',
    inprop: 'url',
    pithumbsize: '700',
    format: 'json'
  });
  const response = await fetch(url, {
    headers: { 'User-Agent': 'BotanikaAI/1.0 (plant encyclopedia)' },
    signal: AbortSignal.timeout(12000)
  });
  if (!response.ok) throw new Error(`Wikipedia returned HTTP ${response.status}`);
  const data = await response.json();
  const page = Object.values(data.query?.pages || {})[0];
  if (!page) return null;
  return {
    title: page.title,
    url: page.fullurl,
    extract: page.extract || '',
    image: page.thumbnail?.source || ''
  };
}

module.exports = async function encyclopedia(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const body = requestBody(req);
  const query = typeof body?.query === 'string' ? body.query.trim() : '';
  if (!query || query.length > 120) {
    return res.status(400).json({ error: 'Enter a plant name or query of up to 120 characters.' });
  }

  const languageCode = Object.prototype.hasOwnProperty.call(languages, body.lang) ? body.lang : 'ru';
  const language = languages[languageCode];
  const system = `You are a careful plant encyclopedia. Answer in ${language}. Return only a valid JSON object with exactly these fields: {"title":"","scientific_name":"","summary":"","care":{"watering":"","light":"","soil":"","temperature":""},"uses":"","toxicity":"","interesting_facts":[""],"disclaimer":""}. Give practical general care, distinguish traditional uses from proven medical benefits, never claim a plant cures disease, and state uncertainty when identification is ambiguous. Warn about human or pet toxicity when known. Keep summary useful and concise.`;
  const messages = [
    { role: 'system', content: system },
    { role: 'user', content: `Plant search: ${query}` }
  ];

  try {
    const [answer, imageResults, wikiResult] = await Promise.allSettled([
      askOpenRouter(messages, 1200),
      findImages(query),
      findWikipedia(query, languageCode)
    ]);
    if (answer.status === 'rejected') throw answer.reason;

    const record = parseJson(answer.value);
    const commonsImages = imageResults.status === 'fulfilled' ? imageResults.value : [];
    const reference = wikiResult.status === 'fulfilled' ? wikiResult.value : null;
    const images = [
      ...(reference?.image ? [{ title: reference.title, url: reference.image, page_url: reference.url }] : []),
      ...commonsImages
    ];
    const search = encodeURIComponent(query);
    record.images = images;
    record.reference = reference;
    record.sources = [
      { title: reference?.title || 'Поиск в Wikipedia', url: reference?.url || `https://${languageCode}.wikipedia.org/w/index.php?search=${search}` },
      { title: 'Wikimedia Commons', url: `https://commons.wikimedia.org/w/index.php?search=${search}` }
    ];
    res.setHeader('Cache-Control', 'public, s-maxage=900, stale-while-revalidate=3600');
    return res.status(200).json(record);
  } catch (error) {
    return sendError(res, error);
  }
};
