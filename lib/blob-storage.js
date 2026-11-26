'use strict';

const crypto = require('crypto');

const MAX_IMAGE_BYTES = 2_500_000;
const EXTENSIONS = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp'
};

function invalidPhoto(message) {
  const error = new Error(message);
  error.status = 400;
  return error;
}

async function blobSdk() {
  try {
    return await import('@vercel/blob');
  } catch (error) {
    throw new Error(`Vercel Blob SDK is unavailable: ${error.message}`);
  }
}

function validateImage(userId, bytes, contentType) {
  if (!/^\d{1,20}$/.test(String(userId))) throw new Error('Invalid image owner');
  if (!Buffer.isBuffer(bytes) || !bytes.length || bytes.length > MAX_IMAGE_BYTES) {
    throw invalidPhoto('Plant photos must be up to 2.5 MB.');
  }
  if (!Object.prototype.hasOwnProperty.call(EXTENSIONS, contentType)) {
    throw invalidPhoto('Only JPEG, PNG, and WebP plant photos are supported.');
  }
  const validSignature = contentType === 'image/jpeg'
    ? bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
    : contentType === 'image/png'
      ? bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
      : bytes.length >= 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP';
  if (!validSignature) throw invalidPhoto('The photo content does not match its image format.');
}

function validatePhotoPath(userId, pathname) {
  const ownerId = String(userId);
  if (!/^\d{1,20}$/.test(ownerId)
    || typeof pathname !== 'string'
    || !pathname.startsWith(`photos/${ownerId}/`)
    || pathname.includes('..')
    || !/^photos\/\d{1,20}\/[A-Za-z0-9._-]+\.(?:jpg|png|webp)$/.test(pathname)) {
    const error = new Error('Plant photo not found.');
    error.status = 404;
    throw error;
  }
}

function parseImageDataUrl(value) {
  if (typeof value !== 'string') throw invalidPhoto('A plant photo is required.');
  const match = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  if (!match) throw invalidPhoto('The photo must be JPEG, PNG, or WebP.');
  const bytes = Buffer.from(match[2], 'base64');
  if (bytes.toString('base64') !== match[2]) throw invalidPhoto('The photo encoding is invalid.');
  return { bytes, contentType: match[1] };
}

async function putPlantPhoto(userId, bytes, contentType) {
  validateImage(userId, bytes, contentType);
  const { put } = await blobSdk();
  const pathname = `photos/${userId}/${Date.now()}-${crypto.randomBytes(12).toString('hex')}.${EXTENSIONS[contentType]}`;
  const result = await put(pathname, bytes, {
    access: 'private',
    addRandomSuffix: false,
    contentType
  });
  return result.pathname;
}

async function getPlantPhoto(userId, pathname) {
  validatePhotoPath(userId, pathname);
  const { get } = await blobSdk();
  return get(pathname, { access: 'private' });
}

async function deletePlantPhoto(userId, pathname) {
  validatePhotoPath(userId, pathname);
  const { del } = await blobSdk();
  return del(pathname, { access: 'private' });
}

module.exports = {
  MAX_IMAGE_BYTES,
  deletePlantPhoto,
  getPlantPhoto,
  parseImageDataUrl,
  putPlantPhoto
};
