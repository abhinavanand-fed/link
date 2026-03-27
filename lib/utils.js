import { randomBytes } from 'node:crypto';

const CODE_PATTERN = /^[A-Za-z0-9_-]{3,32}$/;

export function escapeHtml(value = '') {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function isValidHttpUrl(input = '') {
  try {
    const parsed = new URL(input);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

export function isValidCustomCode(code = '') {
  return CODE_PATTERN.test(code);
}

export function generateCode(length = 6) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = randomBytes(length);
  let code = '';

  for (let i = 0; i < length; i += 1) {
    code += alphabet[bytes[i] % alphabet.length];
  }

  return code;
}

export function toIsoOrNull(datetimeLocal = '') {
  const trimmed = String(datetimeLocal).trim();
  if (!trimmed) return null;

  const date = new Date(trimmed);
  if (Number.isNaN(date.valueOf())) return null;

  return date.toISOString();
}

export function isExpired(expiresAt) {
  if (!expiresAt) return false;
  const expDate = new Date(expiresAt);
  if (Number.isNaN(expDate.valueOf())) return false;
  return Date.now() >= expDate.getTime();
}
