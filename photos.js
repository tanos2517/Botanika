'use strict';

const { Readable } = require('node:stream');
const { requestBody } = require('../lib/openrouter');
const { authenticateAccountRequest, authenticateWebSession } = require('../lib/request-auth');
const { getPlantPhoto, parseImageDataUrl, putPlantPhoto } = require('../lib/blob-storage');

function photoPath(req) {
  const url = new URL(req.url, 'https://botanika.invalid');
  return url.searchParams.get('path') || '';
}

module.exports = async function photos(req, res) {
  try {
    if (req.method === 'POST') {
      const identity = await authenticateWebSession(req);
      const body = requestBody(req);
      if (!body || typeof body !== 'object' || Array.isArray(body)
        || JSON.stringify(body).length > 3800000) {
        return res.status(413).json({ error: 'Photo upload is invalid or too large.' });
      }
      const { bytes, contentType } = parseImageDataUrl(body.image);
      const pathname = await putPlantPhoto(identity.id, bytes, contentType);
      return res.status(201).json({ imagePath: pathname });
    }

    if (req.method === 'GET') {
      const identity = await authenticateAccountRequest(req);
      const pathname = photoPath(req);
      const result = await getPlantPhoto(identity.id, pathname);
      if (!result || result.statusCode !== 200) return res.status(404).send('Not found');
      res.statusCode = 200;
      res.setHeader('Content-Type', result.blob.contentType);
      res.setHeader('Cache-Control', 'private, max-age=300');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      const stream = Readable.fromWeb(result.stream);
      stream.on('error', error => {
        console.error('Plant photo streaming failed:', error.message);
        if (!res.headersSent) res.statusCode = 502;
        res.end();
      });
      stream.pipe(res);
      return;
    }

    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    console.error('Plant photo request failed:', error.message);
    const status = Number.isInteger(error.status) ? error.status : 502;
    return res.status(status).json({ error: error.message || 'Plant photo request failed.' });
  }
};
