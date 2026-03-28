import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { generateCode } from './utils.js';

export class LinkStore {
  constructor({ mongoUri, dbName = 'linklite', collectionName = 'links', fallbackFilePath }) {
    this.mongoUri = mongoUri;
    this.dbName = dbName;
    this.collectionName = collectionName;
    this.fallbackFilePath = fallbackFilePath;

    this.client = null;
    this.collection = null;
    this.mongodbModule = null;
    this.localWriteQueue = Promise.resolve();

    this.useLocalFallback = !this.mongoUri;
    if (this.useLocalFallback) {
      this.ensureFallbackFile();
    }
  }

  ensureFallbackFile() {
    const filePath = this.fallbackFilePath;
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, JSON.stringify({ links: [] }, null, 2));
    }
  }

  readLocal() {
    const raw = fs.readFileSync(this.fallbackFilePath, 'utf-8');
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed.links)) parsed.links = [];
    return parsed;
  }

  writeLocalAtomic(data) {
    const tmpFilePath = `${this.fallbackFilePath}.${process.pid}.tmp`;
    fs.writeFileSync(tmpFilePath, JSON.stringify(data, null, 2));
    fs.renameSync(tmpFilePath, this.fallbackFilePath);
  }

  async withLocalWriteLock(fn) {
    const run = async () => fn();
    this.localWriteQueue = this.localWriteQueue.then(run, run);
    return this.localWriteQueue;
  }

  async loadMongoModule() {
    if (!this.mongodbModule) {
      this.mongodbModule = await import('mongodb');
    }
    return this.mongodbModule;
  }

  async connect() {
    if (this.useLocalFallback) return null;
    if (this.collection) return this.collection;

    const { MongoClient, ServerApiVersion } = await this.loadMongoModule();

    this.client = new MongoClient(this.mongoUri, {
      serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true
      }
    });

    await this.client.connect();

    const db = this.client.db(this.dbName);
    this.collection = db.collection(this.collectionName);

    await this.collection.createIndex({ shortCode: 1 }, { unique: true });
    await this.collection.createIndex({ createdAt: -1 });
    await this.collection.createIndex({ expiresAt: 1 });
    await this.collection.createIndex({ ownerId: 1, createdAt: -1 });

    return this.collection;
  }

  async close() {
    if (this.client) {
      await this.client.close();
      this.client = null;
      this.collection = null;
    }
  }

  async getRecent(limit = 20, ownerId = null) {
    if (this.useLocalFallback) {
      const allLinks = this.readLocal().links;
      const filtered = ownerId ? allLinks.filter((item) => item.ownerId === ownerId) : allLinks;
      return filtered
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
        .slice(0, limit);
    }

    const collection = await this.connect();
    const query = ownerId ? { ownerId } : {};
    return collection.find(query).sort({ createdAt: -1 }).limit(limit).toArray();
  }

  async getByCode(code) {
    if (this.useLocalFallback) {
      return this.readLocal().links.find((item) => item.shortCode === code) ?? null;
    }

    const collection = await this.connect();
    return collection.findOne({ shortCode: code });
  }

  async codeExists(code) {
    if (this.useLocalFallback) {
      return Boolean(await this.getByCode(code));
    }

    const collection = await this.connect();
    const count = await collection.countDocuments({ shortCode: code }, { limit: 1 });
    return count > 0;
  }

  buildRecord({ originalUrl, shortCode, ownerId, expiresAt = null, title = '' }) {
    return {
      id: randomUUID(),
      ownerId,
      shortCode,
      originalUrl,
      title,
      expiresAt,
      createdAt: new Date().toISOString(),
      clickCount: 0,
      visits: []
    };
  }

  async create({ originalUrl, customCode = null, ownerId, expiresAt = null, title = '' }) {
    if (!ownerId) {
      throw new Error('ownerId is required.');
    }

  async create({ originalUrl, customCode = null, expiresAt = null, title = '' }) {
    if (this.useLocalFallback) {
      return this.withLocalWriteLock(async () => {
        const data = this.readLocal();

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

        if (!shortCode) throw new Error('Could not generate a unique short code.');
        if (data.links.some((item) => item.shortCode === shortCode)) {
          throw new Error('Short code already exists.');
        }

        const record = this.buildRecord({ originalUrl, shortCode, ownerId, title, expiresAt });
        data.links.push(record);
        this.writeLocalAtomic(data);
        return record;
      });
    }

    const collection = await this.connect();
    let lastError = null;

    for (let i = 0; i < 25; i += 1) {
      const shortCode = customCode || generateCode();
      const record = this.buildRecord({ originalUrl, shortCode, ownerId, title, expiresAt });

      try {
        await collection.insertOne(record);
        return record;
      } catch (error) {
        lastError = error;
        const duplicateKeyError = error && (error.code === 11000 || String(error.message || '').includes('E11000'));
        if (!duplicateKeyError || customCode) {
          throw error;
        }
      }
    }

    throw lastError || new Error('Could not generate a unique short code.');
  }

  async addVisit(code, { userAgent = '', referer = '' }) {
    const visit = {
      visitedAt: new Date().toISOString(),
      userAgent,
      referer
    };

    if (this.useLocalFallback) {
      return this.withLocalWriteLock(async () => {
        const data = this.readLocal();
        const link = data.links.find((item) => item.shortCode === code);
        if (!link) return null;

        link.clickCount += 1;
        link.visits.unshift(visit);
        link.visits = link.visits.slice(0, 200);

        this.writeLocalAtomic(data);
        return link;
      });
    }

    const collection = await this.connect();
    await collection.updateOne(
      { shortCode: code },
      {
        $inc: { clickCount: 1 },
        $push: {
          visits: {
            $each: [visit],
            $position: 0,
            $slice: 200
          }
        }
      }
    );

    return this.getByCode(code);
  }

  async cleanupExpired() {
    const nowIso = new Date().toISOString();

    if (this.useLocalFallback) {
      return this.withLocalWriteLock(async () => {
        const data = this.readLocal();
        const before = data.links.length;
        data.links = data.links.filter((item) => !item.expiresAt || item.expiresAt > nowIso);
        const deletedCount = before - data.links.length;
        if (deletedCount > 0) this.writeLocalAtomic(data);
        return deletedCount;
      });
    }

    const collection = await this.connect();
    const result = await collection.deleteMany({ expiresAt: { $type: 'string', $lte: nowIso } });
    return result.deletedCount || 0;
  }
}
