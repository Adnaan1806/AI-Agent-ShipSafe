import jwt from 'jsonwebtoken';
import { prisma } from '../db/prisma.js';

export function generateToken(userId) {
  return jwt.sign({ sub: userId }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
  });
}

export async function requireAuth(req, res, next) {
  const header = req.headers.authorization;

  // EventSource (SSE) cannot set headers — accept token as query param fallback
  if (!header && req.query.token) {
    try {
      const payload = jwt.verify(req.query.token, process.env.JWT_SECRET);
      const user = await prisma.user.findUnique({ where: { id: payload.sub } });
      if (!user) return res.status(401).json({ error: 'User not found' });
      req.user = user;
      return next();
    } catch {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }
  }

  if (!header) return res.status(401).json({ error: 'Authorization header required' });

  if (header.startsWith('Bearer ')) {
    const token = header.slice(7);
    try {
      const payload = jwt.verify(token, process.env.JWT_SECRET);
      const user = await prisma.user.findUnique({ where: { id: payload.sub } });
      if (!user) return res.status(401).json({ error: 'User not found' });
      req.user = user;
      return next();
    } catch {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }
  }

  if (header.startsWith('ApiKey ')) {
    const apiKey = header.slice(7);
    const user = await prisma.user.findUnique({ where: { apiKey } });
    if (!user) return res.status(401).json({ error: 'Invalid API key' });
    req.user = user;
    return next();
  }

  return res.status(401).json({ error: 'Invalid authorization format' });
}
