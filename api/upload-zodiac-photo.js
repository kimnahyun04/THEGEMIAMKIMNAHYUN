import crypto from 'node:crypto';
import { put } from '@vercel/blob';

const MAX_IMAGE_BYTES = 3 * 1024 * 1024;

function sendJson(response, status, payload) {
  response.statusCode = status;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('Cache-Control', 'no-store');
  response.end(JSON.stringify(payload));
}

function isAllowedOrigin(request) {
  const origin = request.headers.origin;

  if (!origin) return true;

  const configuredOrigin = process.env.PHOTO_UPLOAD_ORIGIN?.replace(/\/$/, '');

  if (configuredOrigin) {
    return origin === configuredOrigin;
  }

  const requestHost = request.headers['x-forwarded-host'] || request.headers.host;

  try {
    return new URL(origin).host === requestHost;
  } catch {
    return false;
  }
}

async function readImageBody(request) {
  if (Buffer.isBuffer(request.body)) {
    return request.body;
  }

  if (typeof request.body === 'string') {
    return Buffer.from(request.body);
  }

  const chunks = [];
  let totalBytes = 0;

  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += buffer.length;

    if (totalBytes > MAX_IMAGE_BYTES) {
      throw new Error('IMAGE_TOO_LARGE');
    }

    chunks.push(buffer);
  }

  return Buffer.concat(chunks);
}

export default async function handler(request, response) {
  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST');
    sendJson(response, 405, { error: 'POST 요청만 사용할 수 있어요.' });
    return;
  }

  if (!isAllowedOrigin(request)) {
    sendJson(response, 403, { error: '허용되지 않은 사이트에서 보낸 요청이에요.' });
    return;
  }

  const storeId = process.env.ZODIAC_BLOB_STORE_ID;

  if (!storeId) {
    sendJson(response, 500, {
      error: '별자리 전용 저장소(ZODIAC_BLOB_STORE_ID)를 프로젝트에 연결해 주세요.'
    });
    return;
  }

  const contentType = String(request.headers['content-type'] || '').split(';')[0];
  const contentLength = Number(request.headers['content-length'] || 0);

  if (contentType !== 'image/jpeg') {
    sendJson(response, 415, { error: 'JPG 사진만 업로드할 수 있어요.' });
    return;
  }

  if (contentLength > MAX_IMAGE_BYTES) {
    sendJson(response, 413, { error: '사진 용량은 3MB 이하여야 해요.' });
    return;
  }

  try {
    const image = await readImageBody(request);

    if (!image.length) {
      sendJson(response, 400, { error: '업로드할 사진이 비어 있어요.' });
      return;
    }

    if (image.length > MAX_IMAGE_BYTES) {
      sendJson(response, 413, { error: '사진 용량은 3MB 이하여야 해요.' });
      return;
    }

    const pathname = `zodiac-photos/${Date.now()}-${crypto.randomUUID()}.jpg`;
    const blob = await put(pathname, image, {
      access: 'public',
      storeId,
      addRandomSuffix: true,
      contentType: 'image/jpeg',
      cacheControlMaxAge: 3600
    });

    sendJson(response, 200, { url: blob.url });
  } catch (error) {
    console.error(error);

    if (error?.message === 'IMAGE_TOO_LARGE') {
      sendJson(response, 413, { error: '사진 용량은 3MB 이하여야 해요.' });
      return;
    }

    sendJson(response, 500, {
      error: '별자리 사진 저장소 연결을 확인해 주세요.'
    });
  }
}

export const config = {
  api: {
    bodyParser: false
  }
};
