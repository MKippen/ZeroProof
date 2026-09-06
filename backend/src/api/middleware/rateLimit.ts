import rateLimit from 'express-rate-limit';

const message = {
  success: false,
  error: { code: 'RATE_LIMITED', message: 'Too many requests. Please try again in a minute.' },
};
const options = { windowMs: 60_000, standardHeaders: true, legacyHeaders: false, message };

// The UniFi router authenticates before applying these limits. Bound both
// accidental polling loops and expensive controller writes/syncs per admin.
export const unifiReadLimiter = rateLimit({
  ...options, limit: 120,
  keyGenerator: (req) => String(req.session.userId),
});
export const unifiMutationLimiter = rateLimit({
  ...options, limit: 20,
  keyGenerator: (req) => String(req.session.userId),
  skip: (req) => ['GET', 'HEAD', 'OPTIONS'].includes(req.method),
});

// Firmware download is public so freshly flashed devices can retrieve it.
// Bound repeated disk reads and binary buffers per source IP.
export const firmwareDownloadLimiter = rateLimit({ ...options, limit: 20 });
