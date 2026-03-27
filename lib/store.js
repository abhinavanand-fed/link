import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { generateCode } from './utils.js';

const DEFAULT_DATA = { links: [] };

export class LinkStore {
  constructor(filePath) {
    this.filePath = filePath;
    this.ensureFile();
  }

  ensureFile() {
    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    if (!fs.existsSync(this.filePath)) {
      fs.writeFileSync(this.filePath, JSON.stringify(DEFAULT_DATA, null, 2));
    }
  }

  read() {
    const raw = fs.readFileSync(this.filePath, 'utf-8');
    const data = JSON.parse(raw);
    if (!data.links || !Array.isArray(data.links)) data.links = [];
    return data;
  }

  write(data) {
    fs.writeFileSync(this.filePath, JSON.stringify(data, null, 2));
  }

  getAllLinks() {
    return this.read().links.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  }

  getRecent(limit = 20) {
    return this.getAllLinks().slice(0, limit);
  }

  getByCode(code) {
    return this.read().links.find((item) => item.shortCode === code) ?? null;
  }

  codeExists(code) {
    return Boolean(this.getByCode(code));
  }

  create({ originalUrl, customCode = null, expiresAt = null, title = '' }) {
    const data = this.read();
    let shortCode = customCode;

    if (!shortCode) {
      for (let i = 0; i < 25; i += 1) {
        const candidate = generateCode();
        if (!data.links.some((item) => item.shortCode === candidate)) {
          shortCode = candidate;
          break;
        }
      }
    }

    if (!shortCode) {
      throw new Error('Could not generate a unique short code.');
    }

    if (data.links.some((item) => item.shortCode === shortCode)) {
      throw new Error('Short code already exists.');
    }

    const now = new Date().toISOString();
    const record = {
      id: randomUUID(),
      shortCode,
      originalUrl,
      title,
      expiresAt,
      createdAt: now,
      clickCount: 0,
      visits: []
    };

    data.links.push(record);
    this.write(data);
    return record;
  }

  addVisit(code, { ipAddress = '', userAgent = '', referer = '' }) {
    const data = this.read();
    const link = data.links.find((item) => item.shortCode === code);
    if (!link) return null;

    link.clickCount += 1;
    link.visits.unshift({
      visitedAt: new Date().toISOString(),
      ipAddress,
      userAgent,
      referer
    });

    link.visits = link.visits.slice(0, 200);
    this.write(data);
    return link;
  }
}
