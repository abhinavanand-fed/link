import { randomBytes } from 'node:crypto';
import net from 'node:net';

const CODE_PATTERN = /^[A-Za-z0-9_-]{3,32}$/;
const STRICT_ISO_WITH_TZ = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/;

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

export function isPrivateOrLocalHost(hostname = '') {
  const normalized = hostname.toLowerCase();
  if (!normalized) return true;
  if (normalized === 'localhost') return true;

  if (net.isIP(normalized) === 4) {
    if (normalized.startsWith('10.')) return true;
    if (normalized.startsWith('127.')) return true;
    if (normalized.startsWith('192.168.')) return true;
    const secondOctet = Number(normalized.split('.')[1] || 0);
    if (normalized.startsWith('172.') && secondOctet >= 16 && secondOctet <= 31) return true;
    if (normalized.startsWith('169.254.')) return true;
  }

  if (net.isIP(normalized) === 6) {
    if (normalized === '::1') return true;
    if (normalized.startsWith('fc') || normalized.startsWith('fd')) return true;
    if (normalized.startsWith('fe80:')) return true;
  }

  return false;
}

export function isSafePublicHttpUrl(input = '') {
  if (!isValidHttpUrl(input)) return false;
  const parsed = new URL(input);
  return !isPrivateOrLocalHost(parsed.hostname);
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

export function toIsoOrNull(datetimeInput = '') {
  const trimmed = String(datetimeInput).trim();
  if (!trimmed) return null;
  if (!STRICT_ISO_WITH_TZ.test(trimmed)) return null;

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
