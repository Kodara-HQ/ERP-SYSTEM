import { Router } from 'express';
import { requireAuth } from '../../middleware/authenticate';
import { validate } from '../../middleware/validate';
import { requestMeta } from '../../services/auditService';
import { HttpError } from '../../utils/httpError';
import { REFRESH_COOKIE, changePassword, clearAuthCookies, login, logout, publicProfile, refresh, setAuthCookies } from './auth.service';
import { changePasswordSchema, loginSchema } from './auth.schema';

export const authRouter = Router();

authRouter.post('/login', validate({ body: loginSchema }), async (req, res, next) => {
  try {
    const meta = requestMeta(req);
    const tokens = await login({
      username: req.body.username,
      password: req.body.password,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });
    setAuthCookies(res, tokens.accessToken, tokens.refreshToken);
    res.json({ data: { accessToken: tokens.accessToken, expiresIn: 15 * 60 } });
  } catch (error) {
    next(error);
  }
});

authRouter.post('/refresh', async (req, res, next) => {
  try {
    const refreshToken = req.cookies?.[REFRESH_COOKIE];
    if (typeof refreshToken !== 'string' || refreshToken.length < 20) {
      throw new HttpError(401, 'Your session has expired. Sign in again.', 'SESSION_EXPIRED');
    }
    const meta = requestMeta(req);
    const tokens = await refresh({ refreshToken, ipAddress: meta.ipAddress, userAgent: meta.userAgent });
    setAuthCookies(res, tokens.accessToken, tokens.refreshToken);
    res.json({ data: { accessToken: tokens.accessToken } });
  } catch (error) {
    next(error);
  }
});

authRouter.post('/logout', requireAuth, async (req, res, next) => {
  try {
    await logout(req.auth!, requestMeta(req));
    clearAuthCookies(res);
    res.json({ data: { signedOut: true } });
  } catch (error) {
    next(error);
  }
});

authRouter.get('/me', requireAuth, async (req, res, next) => {
  try {
    res.json({ data: await publicProfile(req.auth!) });
  } catch (error) {
    next(error);
  }
});

authRouter.post('/change-password', requireAuth, validate({ body: changePasswordSchema }), async (req, res, next) => {
  try {
    const tokens = await changePassword(req.auth!, req.body, requestMeta(req));
    setAuthCookies(res, tokens.accessToken, tokens.refreshToken);
    res.json({ data: { changed: true, accessToken: tokens.accessToken } });
  } catch (error) {
    next(error);
  }
});
