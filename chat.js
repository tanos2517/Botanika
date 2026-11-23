const { askOpenRouter, sendError, requestBody } = require('../lib/openrouter');

module.exports = async function chat(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const body = requestBody(req);
  if (!body || !Array.isArray(body.messages) || body.messages.length < 1 || body.messages.length > 20) {
    return res.status(400).json({ error: 'Request must contain 1 to 20 messages' });
  }
  if (Buffer.byteLength(JSON.stringify(body)) > 3500000) {
    return res.status(413).json({ error: 'Request is too large. Reduce the number or size of photos.' });
  }

  try {
    const text = await askOpenRouter(body.messages, body.max_tokens);
    return res.status(200).json({ text });
  } catch (error) {
    return sendError(res, error);
  }
};
