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

  writeLocal(data) {
    fs.writeFileSync(this.fallbackFilePath, JSON.stringify(data, null, 2));
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

    return this.collection;
  }

  async close() {
    if (this.client) {
      await this.client.close();
      this.client = null;
      this.collection = null;
    }
  }

  async getRecent(limit = 20) {
    if (this.useLocalFallback) {
      return this.readLocal().links
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
        .slice(0, limit);
    }

    const collection = await this.connect();
    return collection.find({}).sort({ createdAt: -1 }).limit(limit).toArray();
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

  async create({ originalUrl, customCode = null, expiresAt = null, title = '' }) {
    let shortCode = customCode;

    if (!shortCode) {
      for (let i = 0; i < 25; i += 1) {
        const candidate = generateCode();
        const exists = await this.codeExists(candidate);
        if (!exists) {
          shortCode = candidate;
          break;
        }
      }
    }

    if (!shortCode) {
      throw new Error('Could not generate a unique short code.');
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

    if (this.useLocalFallback) {
      const data = this.readLocal();
      if (data.links.some((item) => item.shortCode === shortCode)) {
        throw new Error('Short code already exists.');
      }
      data.links.push(record);
      this.writeLocal(data);
      return record;
    }

    const collection = await this.connect();
    await collection.insertOne(record);
    return record;
  }

  async addVisit(code, { ipAddress = '', userAgent = '', referer = '' }) {
    const visit = {
      visitedAt: new Date().toISOString(),
      ipAddress,
      userAgent,
      referer
    };

    if (this.useLocalFallback) {
      const data = this.readLocal();
      const link = data.links.find((item) => item.shortCode === code);
      if (!link) return null;

      link.clickCount += 1;
      link.visits.unshift(visit);
      link.visits = link.visits.slice(0, 200);

      this.writeLocal(data);
      return link;
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
}
