import * as Sentry from "@sentry/node";

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

export function sentryRequestHandler() {
  return Sentry.expressRequestHandler();
}

export function sentryErrorHandler() {
  return Sentry.expressErrorHandler();
}

export function captureException(
  error: Error,
  context?: Record<string, any>,
): void {
  Sentry.captureException(error, { extra: context });
}

export function setUser(
  userId: string,
  tenantId: string,
  role: string,
): void {
  Sentry.setUser({ id: userId, tenantId, role } as any);
}
