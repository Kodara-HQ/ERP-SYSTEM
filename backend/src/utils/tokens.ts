import { createHash, randomBytes } from 'crypto';
import jwt, { type SignOptions } from 'jsonwebtoken';
import { env } from '../config/env';

export interface AccessTokenClaims {
  sub: number;
  sid: number;
  tv: number;
}

export function signAccessToken(claims: AccessTokenClaims): string {
  const options: SignOptions = {
    expiresIn: env.jwt.accessTtlSeconds,
    issuer: 'bajogo-erp',
    audience: 'bajogo-erp-api',
  };
  return jwt.sign({ sub: claims.sub, sid: claims.sid, tv: claims.tv }, env.jwt.accessSecret, options);
}

export function verifyAccessToken(token: string): AccessTokenClaims {
  const payload = jwt.verify(token, env.jwt.accessSecret, {
    issuer: 'bajogo-erp',
    audience: 'bajogo-erp-api',
  });
  if (typeof payload === 'string' || payload.sub === undefined || payload.sid === undefined) {
    throw new Error('Invalid access token.');
  }
  return {
    sub: Number(payload.sub),
    sid: Number(payload.sid),
    tv: Number(payload.tv),
  };
}

export function newRefreshToken(): { token: string; hash: string } {
  const token = randomBytes(48).toString('base64url');
  const hash = createHash('sha256').update(token).digest('hex');
  return { token, hash };
}

export function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
