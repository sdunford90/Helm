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

  // --- Prisma known errors — surface sensible status codes instead of 500 ---
  if (err && typeof err === "object" && "code" in err && typeof (err as { code: unknown }).code === "string") {
    const code = (err as { code: string }).code;
    if (code === "P2002") {
      // Unique constraint failed
      res.status(409).json({ error: "Duplicate value", code: "DUPLICATE" });
      return;
    }
    if (code === "P2025") {
      // Record not found on update/delete
      res.status(404).json({ error: "Record not found", code: "NOT_FOUND" });
      return;
    }
    if (code === "P2003") {
      // Foreign key constraint failed
      res.status(400).json({ error: "Invalid reference", code: "INVALID_REFERENCE" });
      return;
    }
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
//
// All route handlers should either:
//   1. throw appError(msg, status, code) — most idiomatic
//   2. throw a ZodError (thrown naturally by schema.parse)
//   3. call next(err) with a generic Error — surfaces as 500
// Error responses always take the shape:
//   { error: string, code: string, details?: unknown }
// --------------------------------------------------------------------------

export interface AppError extends Error {
  statusCode: number;
  code?: string;
}

export function appError(
  message: string,
  statusCode: number,
  code: string,
): AppError {
  const err = new Error(message) as AppError;
  err.statusCode = statusCode;
  err.code = code;
  return err;
}

function isAppError(err: unknown): err is AppError {
  return err instanceof Error && typeof (err as AppError).statusCode === "number";
}
