import { parseCookie, stringifySetCookie } from "cookie";
import { Router, type Request } from "express";

import {
  InvalidCredentialsError,
  LoginAttemptRateLimitError,
  LoginVerificationCapacityError,
  type AuthService,
} from "../application/auth.js";
import { loginSchema } from "../domain/auth.js";

const sessionCookieName = "application_tracker_session";

export interface AuthCookieOptions {
  maxAgeSeconds: number;
  secure: boolean;
}

export function requestSessionToken(request: Request): string | undefined {
  const value = parseCookie(request.headers.cookie ?? "")[sessionCookieName];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

export function requestClientAddress(request: Request): string {
  return request.ip ?? request.socket.remoteAddress ?? "unknown";
}

export function createSessionCookie(
  token: string,
  options: AuthCookieOptions,
): string {
  return stringifySetCookie({
    httpOnly: true,
    maxAge: options.maxAgeSeconds,
    name: sessionCookieName,
    path: "/",
    priority: "high",
    sameSite: "strict",
    secure: options.secure,
    value: token,
  });
}

function expiredSessionCookie(options: AuthCookieOptions): string {
  return stringifySetCookie({
    expires: new Date(0),
    httpOnly: true,
    maxAge: 0,
    name: sessionCookieName,
    path: "/",
    priority: "high",
    sameSite: "strict",
    secure: options.secure,
    value: "",
  });
}

export function createAuthRouter(
  authService: AuthService,
  cookieOptions: AuthCookieOptions,
): Router {
  const router = Router();

  router.use((_request, response, next) => {
    response.set("Cache-Control", "no-store");
    next();
  });

  router.post("/login", async (request, response, next) => {
    const parsed = loginSchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({ error: { code: "validation_error" } });
      return;
    }

    try {
      const result = await authService.login(
        parsed.data,
        requestSessionToken(request),
        requestClientAddress(request),
      );
      response.setHeader(
        "Set-Cookie",
        createSessionCookie(result.token, cookieOptions),
      );
      response.json(result.session);
    } catch (error) {
      if (error instanceof LoginAttemptRateLimitError) {
        response.set("Retry-After", String(error.retryAfterSeconds));
        response.status(429).json({ error: { code: "login_rate_limited" } });
        return;
      }
      if (error instanceof LoginVerificationCapacityError) {
        response.set("Retry-After", "1");
        response
          .status(429)
          .json({ error: { code: "login_capacity_reached" } });
        return;
      }
      if (error instanceof InvalidCredentialsError) {
        response.status(401).json({ error: { code: "invalid_credentials" } });
        return;
      }
      next(error);
    }
  });

  router.get("/session", (request, response) => {
    const session = authService.getSession(requestSessionToken(request));
    response.json(session ?? { authenticated: false });
  });

  router.post("/logout", (request, response) => {
    authService.logout(requestSessionToken(request));
    response.setHeader("Set-Cookie", expiredSessionCookie(cookieOptions));
    response.status(204).send();
  });

  return router;
}
