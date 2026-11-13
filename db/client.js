import { MongoClient } from 'mongodb';
import dotenv from 'dotenv';

dotenv.config();

const uri = process.env.MONGODB_URI;
let client;
let database;
let connectionPromise;

const indexes = {
  projects: [
    [{ id: 1 }, { unique: true }],
    [{ title: 1 }, { unique: true, partialFilterExpression: { source: 'manual' } }],
    [{ display_order: 1 }],
  ],
  messages: [[{ created_at: -1 }]],
  analytics_visitors: [
    [{ id: 1 }, { unique: true }],
    [{ last_seen_at: -1 }],
  ],
  analytics_consents: [
    [{ visitor_id: 1, consent_version: 1, created_at: -1 }],
  ],
  analytics_sessions: [
    [{ id: 1 }, { unique: true }],
    [{ visitor_id: 1, started_at: -1 }],
    [{ started_at: -1 }],
  ],
  analytics_page_views: [
    [{ session_id: 1, started_at: -1 }],
    [{ path: 1, started_at: -1 }],
  ],
  analytics_project_views: [[{ project_id: 1, viewed_at: -1 }]],
  analytics_events: [[{ session_id: 1, occurred_at: -1 }]],
};

async function initializeIndexes(db) {
  const projects = db.collection('projects');
  let projectIndexes = [];
  try {
    projectIndexes = await projects.listIndexes().toArray();
  } catch (error) {
    if (error.code !== 26) throw error;
  }
  const obsoleteProjectIndexes = projectIndexes.filter((index) =>
    index.name === 'repo_1' || (index.name === 'title_1' && !index.partialFilterExpression),
  );
  for (const index of obsoleteProjectIndexes) {
    try {
      await projects.dropIndex(index.name);
    } catch (error) {
      if (error.code !== 27) throw error;
    }
  }

  await Promise.all(Object.entries(indexes).flatMap(([collectionName, definitions]) =>
    definitions.map(([keys, options]) => db.collection(collectionName).createIndex(keys, options)),
  ));
}

export async function connectToDatabase() {
  if (database) return database;
  if (connectionPromise) return connectionPromise;
  if (!uri) {
    throw new Error('MONGODB_URI is not set. Configure your MongoDB Atlas connection string.');
  }

  connectionPromise = (async () => {
    client = new MongoClient(uri, { serverSelectionTimeoutMS: 10000 });
    await client.connect();
    const databaseName = process.env.MONGODB_DB_NAME || 'portfolio';
    database = client.db(databaseName);
    await initializeIndexes(database);
    return database;
  })();

  try {
    return await connectionPromise;
  } catch (error) {
    const failedClient = client;
    client = undefined;
    database = undefined;
    connectionPromise = undefined;
    try {
      await failedClient?.close();
    } catch (closeError) {
      console.error('Failed to close MongoDB client after a connection error:', closeError.message);
    }
    throw error;
  }
}

export async function getCollection(name) {
  const db = await connectToDatabase();
  return db.collection(name);
}

export async function closeDatabase() {
  if (client) await client.close();
  client = undefined;
  database = undefined;
  connectionPromise = undefined;
}

export default connectToDatabase;
