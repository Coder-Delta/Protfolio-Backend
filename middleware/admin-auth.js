import crypto from 'crypto';

const tokenSecret = () => process.env.ANALYTICS_ADMIN_TOKEN_SECRET || process.env.ANALYTICS_ADMIN_PASSWORD;
const sign = (value) => crypto.createHmac('sha256', tokenSecret()).update(value).digest('base64url');

export const createAdminToken = (now = Date.now()) => {
  const secret = tokenSecret();
  if (!secret) throw new Error('Admin token secret is not configured.');
  const payload = Buffer.from(JSON.stringify({
    role: 'analytics-admin',
    exp: now + 8 * 60 * 60 * 1000,
  })).toString('base64url');
  return `${payload}.${sign(payload)}`;
};

export const verifyAdminToken = (token, now = Date.now()) => {
  const secret = tokenSecret();
  if (!token || !secret) return false;
  const parts = token.split('.');
  if (parts.length !== 2) return false;
  const [payload, signature] = parts;
  const actual = Buffer.from(signature);
  const expected = Buffer.from(sign(payload));
  if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) return false;

  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return data.role === 'analytics-admin' && Number.isFinite(data.exp) && data.exp > now;
  } catch {
    return false;
  }
};

export const requireAdmin = (req, res, next) => {
  const token = req.get('authorization')?.replace(/^Bearer\s+/i, '');
  if (!verifyAdminToken(token)) {
    return res.status(401).json({ success: false, message: 'Authentication required.' });
  }
  return next();
};
