import { closeDatabase, connectToDatabase, getCollection } from '../db/client.js';

async function migrate() {
  if (!process.env.MONGODB_URI) {
    throw new Error('MONGODB_URI is required. Copy backend/.env.example to backend/.env and configure MongoDB Atlas.');
  }

  try {
    const database = await connectToDatabase();
    const highestProject = await (await getCollection('projects'))
      .find({}, { projection: { id: 1 } })
      .sort({ id: -1 })
      .limit(1)
      .next();
    await (await getCollection('counters')).updateOne(
      { _id: 'projects' },
      { $max: { sequence: highestProject?.id || 0 } },
      { upsert: true },
    );
    console.log(`MongoDB collections and indexes are ready in "${database.databaseName}"`);
  } finally {
    await closeDatabase();
  }
}

migrate().catch((error) => {
  console.error('MongoDB setup failed:', error.message);
  process.exitCode = 1;
});
