import { randomUUID } from 'node:crypto';
import { MongoClient, ServerApiVersion } from 'mongodb';
import { generateCode } from './utils.js';

export class LinkStore {
  constructor({ mongoUri, dbName = 'linklite', collectionName = 'links' }) {
    this.mongoUri = mongoUri;
    this.dbName = dbName;
    this.collectionName = collectionName;
    this.client = null;
    this.collection = null;
  }

  async connect() {
    if (this.collection) return this.collection;

    if (!this.mongoUri) {
      throw new Error('MONGODB_URI is missing. Set it in your environment before starting the server.');
    }

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
    const collection = await this.connect();
    return collection.find({}).sort({ createdAt: -1 }).limit(limit).toArray();
  }

  async getByCode(code) {
    const collection = await this.connect();
    return collection.findOne({ shortCode: code });
  }

  async codeExists(code) {
    const collection = await this.connect();
    const count = await collection.countDocuments({ shortCode: code }, { limit: 1 });
    return count > 0;
  }

  async create({ originalUrl, customCode = null, expiresAt = null, title = '' }) {
    const collection = await this.connect();
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

    await collection.insertOne(record);
    return record;
  }

  async addVisit(code, { ipAddress = '', userAgent = '', referer = '' }) {
    const collection = await this.connect();
    const visit = {
      visitedAt: new Date().toISOString(),
      ipAddress,
      userAgent,
      referer
    };

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
