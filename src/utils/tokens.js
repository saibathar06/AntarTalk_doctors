import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';

export function signAccessToken(user) {
  return jwt.sign(
    { role: user.role, tokenVersion: user.tokenVersion },
    env.JWT_ACCESS_SECRET,
    { subject: user.id, expiresIn: Number.parseInt(env.ACCESS_TOKEN_TTL, 10) * 60, algorithm: 'HS256', issuer: 'antartalk-api', audience: 'antartalk-apps' }
  );
}

export function verifyAccessToken(token) {
  return jwt.verify(token, env.JWT_ACCESS_SECRET, { algorithms: ['HS256'], issuer: 'antartalk-api', audience: 'antartalk-apps' });
}
