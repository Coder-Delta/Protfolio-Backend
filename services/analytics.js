import crypto from 'crypto';
import { getCollection } from '../db/client.js';

const INACTIVITY_MS = 30 * 60 * 1000;
const MAX_DURATION_SECONDS = 24 * 60 * 60;

const trimValue = (value, maxLength) => typeof value === 'string' ? value.trim().slice(0, maxLength) : null;

export const isUuid = (value) => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
export const isPath = (value) => typeof value === 'string' && /^\/[a-zA-Z0-9/_-]{0,199}$/.test(value);

export const classifyReferrer = (referrer) => {
  if (!referrer) return { source: 'Direct', host: null };
  try {
    const host = new URL(referrer).hostname.toLowerCase().slice(0, 255);
    if (/(^|\.)google\./.test(host)) return { source: 'Google', host };
    if (/(^|\.)linkedin\.com$/.test(host)) return { source: 'LinkedIn', host };
    if (/(^|\.)github\.com$/.test(host)) return { source: 'GitHub', host };
    return { source: 'Other', host };
  } catch {
    return { source: 'Direct', host: null };
  }
};

export const classifyDevice = (userAgent = '') => {
  const ua = userAgent.toLowerCase();
  const deviceType = /ipad|tablet/.test(ua) ? 'Tablet' : /mobi|iphone|android/.test(ua) ? 'Mobile' : /windows|macintosh|linux|cros/.test(ua) ? 'Desktop' : 'Other';
  const browser = /edg\//.test(ua) ? 'Edge' : /firefox\//.test(ua) ? 'Firefox' : /chrome\//.test(ua) && !/edg\//.test(ua) ? 'Chrome' : /safari\//.test(ua) && !/chrome\//.test(ua) ? 'Safari' : 'Other';
  const operatingSystem = /windows/.test(ua) ? 'Windows' : /iphone|ipad|ipod/.test(ua) ? 'iOS' : /android/.test(ua) ? 'Android' : /mac os/.test(ua) ? 'macOS' : /linux/.test(ua) ? 'Linux' : 'Other';
  return { deviceType, browser, operatingSystem };
};

export const locationFromHeaders = (headers) => ({
  country: trimValue(headers['x-vercel-ip-country'] || headers['cf-ipcountry'], 100),
  region: trimValue(headers['x-vercel-ip-country-region'], 100),
  city: trimValue(headers['x-vercel-ip-city'], 100),
});

export const screenBucket = (width, height) => {
  const w = Number(width);
  const h = Number(height);
  if (!Number.isInteger(w) || !Number.isInteger(h) || w < 1 || h < 1 || w > 10000 || h > 10000) return 'Unknown';
  const longest = Math.max(w, h);
  if (longest < 768) return 'Small';
  if (longest < 1200) return 'Medium';
  if (longest < 1920) return 'Large';
  return 'XLarge';
};

export const createSession = async ({ visitorId, path, referrer, utm = {}, screen }, headers) => {
  const now = new Date();
  const visitors = await getCollection('analytics_visitors');
  const visitor = await visitors.findOneAndUpdate(
    { id: visitorId },
    {
      $set: { last_seen_at: now },
      $setOnInsert: { first_seen_at: now },
      $inc: { visit_count: 1 },
    },
    { upsert: true, returnDocument: 'after' },
  );
  const sessionId = crypto.randomUUID();
  const source = classifyReferrer(referrer);
  const device = classifyDevice(headers['user-agent']);
  const location = locationFromHeaders(headers);

  await (await getCollection('analytics_sessions')).insertOne({
    id: sessionId,
    visitor_id: visitorId,
    started_at: now,
    last_activity_at: now,
    ended_at: null,
    entry_page: path,
    exit_page: null,
    referrer_source: source.source,
    referrer_host: source.host,
    utm_source: trimValue(utm.source, 100),
    utm_medium: trimValue(utm.medium, 100),
    utm_campaign: trimValue(utm.campaign, 100),
    country: location.country,
    region: location.region,
    city: location.city,
    ip_address: headers.ip || null,
    device_type: device.deviceType,
    browser: device.browser,
    operating_system: device.operatingSystem,
    screen_size: screenBucket(screen?.width, screen?.height),
  });
  return { sessionId, isNewVisitor: visitor.visit_count === 1 };
};

export const recordConsent = async (visitorId, consentVersion) => {
  const visitors = await getCollection('analytics_visitors');
  const now = new Date();
  await visitors.updateOne(
    { id: visitorId },
    { $setOnInsert: { id: visitorId, first_seen_at: now, last_seen_at: now, visit_count: 0 } },
    { upsert: true },
  );
  const consents = await getCollection('analytics_consents');
  const latest = await consents.findOne(
    { visitor_id: visitorId, consent_version: consentVersion },
    { sort: { created_at: -1 }, projection: { status: 1 } },
  );
  if (latest?.status !== 'allowed') {
    await consents.insertOne({
      visitor_id: visitorId,
      status: 'allowed',
      consent_version: consentVersion,
      granted_at: now,
      created_at: now,
    });
  }
};

export const withdrawConsent = async (visitorId, consentVersion) => {
  const visitors = await getCollection('analytics_visitors');
  if (!await visitors.findOne({ id: visitorId }, { projection: { _id: 1 } })) return;
  await (await getCollection('analytics_consents')).insertOne({
    visitor_id: visitorId,
    status: 'withdrawn',
    consent_version: consentVersion,
    withdrawn_at: new Date(),
    created_at: new Date(),
  });
};

export const hasActiveConsent = async (visitorId, consentVersion) => {
  const consent = await (await getCollection('analytics_consents')).findOne(
    { visitor_id: visitorId, consent_version: consentVersion },
    { sort: { created_at: -1 }, projection: { status: 1 } },
  );
  return consent?.status === 'allowed';
};

export const cleanupAnalytics = async () => {
  const ipDays = Math.max(Number.parseInt(process.env.ANALYTICS_IP_RETENTION_DAYS || '30', 10) || 30, 1);
  const analyticsDays = Math.max(Number.parseInt(process.env.ANALYTICS_RETENTION_DAYS || '365', 10) || 365, 1);
  const sessions = await getCollection('analytics_sessions');
  const ipCutoff = new Date(Date.now() - ipDays * 24 * 60 * 60 * 1000);
  const retentionCutoff = new Date(Date.now() - analyticsDays * 24 * 60 * 60 * 1000);
  const anonymized = await sessions.updateMany(
    { ip_address: { $ne: null }, started_at: { $lt: ipCutoff } },
    { $set: { ip_address: null } },
  );

  const pageViews = await getCollection('analytics_page_views');
  const projectViews = await getCollection('analytics_project_views');
  const events = await getCollection('analytics_events');
  let deleted = 0;
  const cursor = sessions.find(
    { started_at: { $lt: retentionCutoff } },
    { projection: { id: 1 }, batchSize: 500 },
  );
  let batch = [];
  for await (const session of cursor) {
    batch.push(session.id);
    if (batch.length === 500) {
      deleted += await deleteSessions(batch, sessions, pageViews, projectViews, events);
      batch = [];
    }
  }
  if (batch.length) deleted += await deleteSessions(batch, sessions, pageViews, projectViews, events);
  return { anonymized: anonymized.modifiedCount, deleted };
};

async function deleteSessions(ids, sessions, pageViews, projectViews, events) {
  await Promise.all([
    pageViews.deleteMany({ session_id: { $in: ids } }),
    projectViews.deleteMany({ session_id: { $in: ids } }),
    events.deleteMany({ session_id: { $in: ids } }),
  ]);
  return (await sessions.deleteMany({ id: { $in: ids } })).deletedCount;
}

export const recordPageView = async ({ sessionId, path, durationSeconds = 0 }) => {
  const now = new Date();
  const duration = Math.min(Math.max(Number(durationSeconds) || 0, 0), MAX_DURATION_SECONDS);
  await (await getCollection('analytics_page_views')).insertOne({
    session_id: sessionId,
    path,
    started_at: now,
    ended_at: now,
    duration_seconds: duration,
  });
  await (await getCollection('analytics_sessions')).updateOne(
    { id: sessionId },
    { $set: { last_activity_at: now, exit_page: path } },
  );
};

export const recordProjectView = async ({ sessionId, projectId, projectName }) => {
  const now = new Date();
  await (await getCollection('analytics_project_views')).insertOne({
    session_id: sessionId,
    project_id: projectId || null,
    project_name: projectName,
    viewed_at: now,
  });
  await (await getCollection('analytics_sessions')).updateOne(
    { id: sessionId },
    { $set: { last_activity_at: now } },
  );
};

export const recordEvent = async ({ sessionId, eventName, pagePath, metadata = {} }) => {
  await (await getCollection('analytics_events')).insertOne({
    session_id: sessionId,
    event_name: eventName,
    page_path: pagePath || null,
    occurred_at: new Date(),
    metadata,
  });
};

export const endSession = async ({ sessionId, exitPage }) => {
  const now = new Date();
  await (await getCollection('analytics_sessions')).updateOne(
    { id: sessionId, $or: [{ ended_at: null }, { ended_at: { $gt: new Date(now.getTime() - 24 * 60 * 60 * 1000) } }] },
    { $set: { ended_at: now, last_activity_at: now, exit_page: exitPage } },
  );
};

export const isSessionActive = async (sessionId) => {
  const consentVersion = process.env.ANALYTICS_CONSENT_VERSION || '1';
  const cutoff = new Date(Date.now() - INACTIVITY_MS);
  const session = await (await getCollection('analytics_sessions')).findOne(
    { id: sessionId, last_activity_at: { $gt: cutoff }, $or: [{ ended_at: null }, { ended_at: { $gt: new Date(Date.now() - 5 * 60 * 1000) } }] },
    { projection: { visitor_id: 1 } },
  );
  return session ? hasActiveConsent(session.visitor_id, consentVersion) : false;
};

const resultList = async (collectionName, match, groupField, limit = 10) => (
  await getCollection(collectionName)
).aggregate([
  { $match: match },
  { $group: {
    _id: { $cond: [{ $in: [`$${groupField}`, [null, '']] }, 'Unknown', `$${groupField}`] },
    value: { $sum: 1 },
  } },
  { $sort: { value: -1, _id: 1 } },
  ...(limit ? [{ $limit: limit }] : []),
  { $project: { _id: 0, label: '$_id', value: 1 } },
]).toArray();

export const getAnalyticsSummary = async ({ start, end, days }) => {
  const match = { started_at: { $gte: start, $lt: end } };
  const sessions = await getCollection('analytics_sessions');
  const visitors = await getCollection('analytics_visitors');
  const pageViews = await getCollection('analytics_page_views');
  const projectViews = await getCollection('analytics_project_views');
  const [totalVisitors, pageViewCount, overviewRows, pages, projects, sources, countries, regions, cities, devices, browsers, operatingSystems, trends] = await Promise.all([
    visitors.countDocuments(),
    pageViews.countDocuments({ started_at: { $gte: start, $lt: end } }),
    sessions.aggregate([
      { $match: match },
      { $lookup: { from: 'analytics_visitors', localField: 'visitor_id', foreignField: 'id', as: 'visitor' } },
      { $unwind: '$visitor' },
      { $group: {
        _id: null,
        sessions: { $sum: 1 },
        uniqueVisitors: { $addToSet: '$visitor_id' },
        newVisitors: { $addToSet: { $cond: [{ $eq: ['$visitor.visit_count', 1] }, '$visitor_id', null] } },
        returningVisitors: { $addToSet: { $cond: [{ $gt: ['$visitor.visit_count', 1] }, '$visitor_id', null] } },
        averageSessionSeconds: { $avg: { $divide: [{ $subtract: [{ $ifNull: ['$ended_at', '$last_activity_at'] }, '$started_at'] }, 1000] } },
      } },
      { $project: {
        _id: 0,
        sessions: 1,
        unique_visitors: { $size: '$uniqueVisitors' },
        new_visitors: { $subtract: [{ $size: '$newVisitors' }, { $cond: [{ $in: [null, '$newVisitors'] }, 1, 0] }] },
        returning_visitors: { $subtract: [{ $size: '$returningVisitors' }, { $cond: [{ $in: [null, '$returningVisitors'] }, 1, 0] }] },
        average_session_seconds: { $round: ['$averageSessionSeconds', 0] },
      } },
    ]).toArray(),
    pageViews.aggregate([
      { $match: { started_at: { $gte: start, $lt: end } } },
      { $group: { _id: '$path', value: { $sum: 1 }, average_seconds: { $avg: '$duration_seconds' } } },
      { $sort: { value: -1, _id: 1 } },
      { $limit: 10 },
      { $project: { _id: 0, label: '$_id', value: 1, average_seconds: { $round: ['$average_seconds', 0] } } },
    ]).toArray(),
    projectViews.aggregate([
      { $match: { viewed_at: { $gte: start, $lt: end } } },
      { $group: { _id: '$project_name', value: { $sum: 1 } } },
      { $sort: { value: -1, _id: 1 } },
      { $limit: 10 },
      { $project: { _id: 0, label: '$_id', value: 1 } },
    ]).toArray(),
    resultList('analytics_sessions', match, 'referrer_source', 0),
    resultList('analytics_sessions', match, 'country'),
    resultList('analytics_sessions', match, 'region'),
    resultList('analytics_sessions', match, 'city'),
    resultList('analytics_sessions', match, 'device_type', 0),
    resultList('analytics_sessions', match, 'browser', 0),
    resultList('analytics_sessions', match, 'operating_system', 0),
    sessions.aggregate([
      { $match: match },
      { $group: {
        _id: { $dateToString: { format: '%Y-%m-%d', date: '$started_at', timezone: 'UTC' } },
        value: { $sum: 1 },
        visitors: { $addToSet: '$visitor_id' },
      } },
      { $sort: { _id: 1 } },
      { $project: { _id: 0, label: '$_id', value: 1, visitors: { $size: '$visitors' } } },
    ]).toArray(),
  ]);

  const aggregate = overviewRows[0] || {
    sessions: 0,
    unique_visitors: 0,
    new_visitors: 0,
    returning_visitors: 0,
    average_session_seconds: 0,
  };
  return {
    days,
    start: days ? undefined : start.toISOString().slice(0, 10),
    end: days ? undefined : new Date(end.getTime() - 1).toISOString().slice(0, 10),
    overview: { total_visitors: totalVisitors, page_views: pageViewCount, ...aggregate },
    pages,
    projects,
    sources,
    countries,
    regions,
    cities,
    devices,
    browsers,
    operatingSystems,
    trends,
  };
};
