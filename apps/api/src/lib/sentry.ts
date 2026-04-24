import * as Sentry from "@sentry/node";
import type { Application } from "express";

/**
 * Initialize Sentry. Must run BEFORE express() is imported/used when
 * possible so the Express integration can instrument handlers via OTEL.
 * No-op when SENTRY_DSN is unset.
 */
export function initSentry(): void {
  if (!process.env.SENTRY_DSN) return;

  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV || "development",
    release: process.env.npm_package_version,
    tracesSampleRate: 0.1,
    integrations: [
      Sentry.expressIntegration(),
      Sentry.prismaIntegration(),
    ],
    beforeSend(event) {
      if (event.request?.headers) {
        delete event.request.headers["authorization"];
        delete event.request.headers["cookie"];
      }
      return event;
    },
  });
}

/**
 * Register Sentry's Express error handler. Call AFTER all routes but BEFORE
 * the application's own error handler. Safe to call when Sentry isn't
 * initialized (it becomes a no-op).
 */
export function setupSentryErrorHandler(app: Application): void {
  if (!process.env.SENTRY_DSN) return;
  Sentry.setupExpressErrorHandler(app);
}

export function captureException(
  error: Error,
  context?: Record<string, unknown>,
): void {
  Sentry.captureException(error, { extra: context });
}

export function setUser(userId: string, tenantId: string, role: string): void {
  Sentry.setUser({ id: userId, tenantId, role });
}
