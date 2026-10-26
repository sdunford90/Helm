import * as Sentry from "@sentry/node";
import type { RequestHandler } from "express";

export function initSentry(): void {
  if (!process.env.SENTRY_DSN) return;

  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV || "development",
    release: process.env.npm_package_version,
    tracesSampleRate: 0.1,
    integrations: [
      // Express integration
      Sentry.expressIntegration(),
      // Prisma integration
      Sentry.prismaIntegration(),
    ],
    beforeSend(event) {
      // Strip sensitive data
      if (event.request?.headers) {
        delete event.request.headers["authorization"];
        delete event.request.headers["cookie"];
      }
      return event;
    },
  });
}

/**
 * Sentry v8 instruments Express automatically via expressIntegration() in
 * Sentry.init(); there is no request handler middleware any more
 * (Sentry.expressRequestHandler was removed in v8). Kept as a no-op so
 * existing call sites keep working.
 */
export function sentryRequestHandler(): RequestHandler {
  return (_req, _res, next) => next();
}

export function sentryErrorHandler() {
  return Sentry.expressErrorHandler();
}

export function captureException(error: Error, context?: Record<string, any>): void {
  Sentry.captureException(error, { extra: context });
}

export function setUser(userId: string, tenantId: string, role: string): void {
  Sentry.setUser({ id: userId, tenantId, role } as any);
}
