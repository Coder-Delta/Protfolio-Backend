import crypto from 'crypto';
import express from 'express';
import rateLimit from 'express-rate-limit';
import { body, validationResult } from 'express-validator';
import { getCollection } from '../db/client.js';
import { createAdminToken, requireAdmin } from '../middleware/admin-auth.js';
import { createSession, endSession, getAnalyticsSummary, hasActiveConsent, isPath, isSessionActive, isUuid, recordConsent, recordEvent, recordPageView, recordProjectView, withdrawConsent } from '../services/analytics.js';

const router = express.Router();
const analyticsLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 90, standardHeaders: 'draft-7', legacyHeaders: false, message: { success: false, message: 'Too many analytics requests.' } });
const adminLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 8, standardHeaders: 'draft-7', legacyHeaders: false, message: { success: false, message: 'Too many login attempts.' } });
const EVENT_NAMES = new Set(['privacy_notice_dismissed']);
const CONSENT_VERSION = process.env.ANALYTICS_CONSENT_VERSION || '1';
export const sessionReferrerValidator = body('referrer').optional({ nullable: true }).isString().isLength({ max: 2048 });

const analyticsError = (res, error) => {
  console.error('Analytics error:', error.message);
  return res.status(503).json({ success: false, message: 'Analytics is temporarily unavailable.' });
};
const validationErrors = (req, res) => {
  const errors = validationResult(req);
  if (errors.isEmpty()) return false;
  res.status(400).json({
    success: false,
    message: 'Invalid analytics payload. Please correct the listed fields.',
    errors: errors.array().map(({ path, msg }) => ({ field: path, message: msg })),
  });
  return true;
};
const validSession = async (sessionId) => isUuid(sessionId) && isSessionActive(sessionId);

router.post('/consent', analyticsLimiter, [body('visitorId').custom(isUuid)], async (req, res) => {
  if (validationErrors(req, res)) return;
  try {
    await recordConsent(req.body.visitorId, CONSENT_VERSION);
    res.status(202).json({ success: true, data: { consentVersion: CONSENT_VERSION } });
  } catch (error) { analyticsError(res, error); }
});

router.post('/consent/withdraw', analyticsLimiter, [body('visitorId').custom(isUuid)], async (req, res) => {
  if (validationErrors(req, res)) return;
  try {
    await withdrawConsent(req.body.visitorId, CONSENT_VERSION);
    res.status(202).json({ success: true });
  } catch (error) { analyticsError(res, error); }
});

router.post('/session', analyticsLimiter, [
  body('visitorId').custom(isUuid),
  body('path').custom(isPath),
  sessionReferrerValidator,
  body('utm').optional().isObject(),
  body('screen').optional().isObject(),
], async (req, res) => {
  if (validationErrors(req, res)) return;
  try {
    if (!await hasActiveConsent(req.body.visitorId, CONSENT_VERSION)) return res.status(403).json({ success: false, message: 'Analytics consent is required.' });
    const data = await createSession(req.body, { ...req.headers, ip: req.ip });
    res.status(201).json({ success: true, data });
  } catch (error) { analyticsError(res, error); }
});

router.post('/page-view', analyticsLimiter, [
  body('sessionId').custom(isUuid), body('path').custom(isPath), body('durationSeconds').optional().isInt({ min: 0, max: 86400 }),
], async (req, res) => {
  if (validationErrors(req, res)) return;
  try {
    if (!await validSession(req.body.sessionId)) return res.status(202).json({ success: true });
    await recordPageView(req.body);
    res.status(202).json({ success: true });
  } catch (error) { analyticsError(res, error); }
});

router.post('/project-view', analyticsLimiter, [
  body('sessionId').custom(isUuid), body('projectId').isInt({ min: 1 }),
], async (req, res) => {
  if (validationErrors(req, res)) return;
  try {
    if (!await validSession(req.body.sessionId)) return res.status(202).json({ success: true });
    const project = await (await getCollection('projects')).findOne(
      { id: req.body.projectId },
      { projection: { id: 1, title: 1 } },
    );
    if (!project) return res.status(202).json({ success: true });
    await recordProjectView({ sessionId: req.body.sessionId, projectId: project.id, projectName: project.title });
    res.status(202).json({ success: true });
  } catch (error) { analyticsError(res, error); }
});

router.post('/event', analyticsLimiter, [
  body('sessionId').custom(isUuid), body('eventName').isString().isLength({ min: 1, max: 50 }), body('pagePath').optional().custom(isPath), body('metadata').optional().isObject(),
], async (req, res) => {
  if (validationErrors(req, res)) return;
  if (!EVENT_NAMES.has(req.body.eventName)) return res.status(400).json({ success: false, message: 'Invalid analytics event.' });
  try {
    if (!await validSession(req.body.sessionId)) return res.status(202).json({ success: true });
    await recordEvent({ ...req.body, metadata: {} });
    res.status(202).json({ success: true });
  } catch (error) { analyticsError(res, error); }
});

router.post('/session-end', analyticsLimiter, [body('sessionId').custom(isUuid), body('exitPage').custom(isPath)], async (req, res) => {
  if (validationErrors(req, res)) return;
  try { await endSession(req.body); res.status(202).json({ success: true }); } catch (error) { analyticsError(res, error); }
});

router.post('/admin/login', adminLimiter, [body('password').isString().isLength({ min: 1, max: 1024 })], (req, res) => {
  if (validationErrors(req, res) || !process.env.ANALYTICS_ADMIN_PASSWORD) return res.status(401).json({ success: false, message: 'Invalid credentials.' });
  const supplied = Buffer.from(req.body.password);
  const expected = Buffer.from(process.env.ANALYTICS_ADMIN_PASSWORD);
  if (supplied.length !== expected.length || !crypto.timingSafeEqual(supplied, expected)) return res.status(401).json({ success: false, message: 'Invalid credentials.' });
  res.json({ success: true, data: { token: createAdminToken(), expiresInSeconds: 28800 } });
});

export const rangeFilter = (req, now = new Date()) => {
  const start = typeof req.query.start === 'string' ? req.query.start : '';
  const end = typeof req.query.end === 'string' ? req.query.end : '';
  if (start || end) {
    const startDate = new Date(`${start}T00:00:00.000Z`);
    const endDate = new Date(`${end}T00:00:00.000Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)
      || Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())
      || startDate.toISOString().slice(0, 10) !== start
      || endDate.toISOString().slice(0, 10) !== end
      || start > end) return { invalid: true };
    return {
      days: null,
      start: startDate,
      end: new Date(endDate.getTime() + 24 * 60 * 60 * 1000),
    };
  }
  const days = Number(req.query.days || 30);
  const validDays = Number.isInteger(days) && [1, 7, 30, 90].includes(days) ? days : 30;
  const endDate = new Date(now);
  return {
    days: validDays,
    start: new Date(endDate.getTime() - validDays * 24 * 60 * 60 * 1000),
    end: endDate,
  };
};
router.get('/admin/summary', requireAdmin, async (req, res) => {
  const range = rangeFilter(req);
  if (range.invalid) return res.status(400).json({ success: false, message: 'A valid custom start and end date are required.' });
  try {
    const data = await getAnalyticsSummary(range);
    res.json({ success: true, data });
  } catch (error) { analyticsError(res, error); }
});

export default router;
