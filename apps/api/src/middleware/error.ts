import type { Request, Response, NextFunction } from "express";
import { ZodError } from "zod";

interface ErrorResponse {
  error: string;
  code: string;
  details?: unknown;
}

/**
 * Global error-handling middleware.
 *
 * Must be registered **last** in the middleware chain (Express identifies
 * error handlers by the 4-argument signature).
 */
export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  // --- Zod validation errors ---
  if (err instanceof ZodError) {
    const response: ErrorResponse = {
      error: "Validation error",
      code: "VALIDATION_ERROR",
      details: err.errors.map((e) => ({
        path: e.path.join("."),
        message: e.message,
      })),
    };
    res.status(400).json(response);
    return;
  }

  // --- Known application errors with a statusCode property ---
  if (isAppError(err)) {
    const response: ErrorResponse = {
      error: err.message,
      code: err.code ?? "APP_ERROR",
    };
    res.status(err.statusCode).json(response);
    return;
  }

  // --- Generic / unexpected errors ---
  // Log for observability (swap for Sentry later)
  console.error("[unhandled error]", err);

  const message =
    process.env.NODE_ENV === "production"
      ? "Internal server error"
      : err instanceof Error
        ? err.message
        : String(err);

  const response: ErrorResponse = {
    error: message,
    code: "INTERNAL_ERROR",
  };
  res.status(500).json(response);
}

// --------------------------------------------------------------------------
// Utility: typed application error
// --------------------------------------------------------------------------

interface AppError extends Error {
  statusCode: number;
  code?: string;
}

function isAppError(err: unknown): err is AppError {
  return err instanceof Error && typeof (err as AppError).statusCode === "number";
}
