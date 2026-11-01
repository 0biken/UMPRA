import { NextResponse } from "next/server";

export type ErrorCode =
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "VALIDATION"
  | "NOT_FOUND"
  | "INVALID_TRANSITION"
  | "TOURNAMENT_FULL"
  | "PAYMENT_FAILED"
  | "PAYPAL_ERROR"
  | "ALREADY_DONE"
  | "UPLOAD_REJECTED"
  | "INVALID_CREDENTIALS"
  | "EMAIL_TAKEN"
  | "RATE_LIMITED"
  | "INTERNAL_ERROR";

const DEFAULT_STATUS_BY_CODE: Record<ErrorCode, number> = {
  UNAUTHENTICATED: 401,
  INVALID_CREDENTIALS: 401,
  FORBIDDEN: 403,
  VALIDATION: 400,
  PAYMENT_FAILED: 400,
  UPLOAD_REJECTED: 400,
  NOT_FOUND: 404,
  INVALID_TRANSITION: 409,
  TOURNAMENT_FULL: 409,
  ALREADY_DONE: 409,
  EMAIL_TAKEN: 409,
  RATE_LIMITED: 429,
  PAYPAL_ERROR: 502,
  INTERNAL_ERROR: 500,
};

export class AppError extends Error {
  public readonly code: ErrorCode;
  public readonly status: number;
  public readonly details?: unknown;

  constructor(
    code: ErrorCode,
    message: string,
    status?: number,
    details?: unknown
  ) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.status = status ?? DEFAULT_STATUS_BY_CODE[code] ?? 400;
    this.details = details;
  }
}

export function isAppError(err: unknown): err is AppError {
  return err instanceof AppError;
}

export function toErrorResponse(err: unknown): NextResponse {
  if (isAppError(err)) {
    return NextResponse.json(
      {
        error: {
          code: err.code,
          message: err.message,
          ...(err.details !== undefined ? { details: err.details } : {}),
        },
      },
      { status: err.status }
    );
  }

  console.error(
    JSON.stringify({
      level: "error",
      msg: "Unhandled API error",
      error: err instanceof Error ? err.message : String(err),
    })
  );

  return NextResponse.json(
    {
      error: {
        code: "INTERNAL_ERROR",
        message: "Something went wrong on our end. Refresh the page and try again.",
      },
    },
    { status: 500 }
  );
}
