import { AppError } from "./errors";

export function assertValidCents(
  cents: number,
  options: { allowZero?: boolean } = { allowZero: true }
): void {
  if (typeof cents !== "number" || !Number.isFinite(cents) || !Number.isInteger(cents)) {
    throw new AppError(
      "VALIDATION",
      `Amount in cents must be an integer (received ${String(cents)}).`,
      400
    );
  }
  const min = options.allowZero === false ? 1 : 0;
  if (cents < min) {
    throw new AppError(
      "VALIDATION",
      `Amount in cents must be ${min === 1 ? "positive" : "non-negative"} (received ${cents}).`,
      400
    );
  }
}

/**
 * Converts integer cents to a PayPal two-decimal USD string (e.g., 2800 -> "28.00").
 */
export function toPayPalAmount(cents: number): string {
  assertValidCents(cents, { allowZero: true });
  const whole = Math.floor(cents / 100);
  const remainder = cents % 100;
  return `${whole}.${String(remainder).padStart(2, "0")}`;
}

/**
 * Parses a PayPal decimal amount string (e.g., "28.00", "5.5", "12") into integer cents.
 * Rejects negatives, non-numeric strings, and strings with >2 decimal places.
 */
export function fromPayPalAmount(amountStr: string): number {
  if (typeof amountStr !== "string") {
    throw new AppError("VALIDATION", "PayPal amount must be a string.", 400);
  }
  const trimmed = amountStr.trim();
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) {
    throw new AppError(
      "VALIDATION",
      `Invalid PayPal amount string: "${amountStr}". Expected non-negative decimal with at most 2 fractional digits.`,
      400
    );
  }
  const [wholePart, fracPart = ""] = trimmed.split(".");
  const wholeCents = Number.parseInt(wholePart, 10) * 100;
  const fracCents = Number.parseInt(fracPart.padEnd(2, "0"), 10);
  const total = wholeCents + fracCents;
  assertValidCents(total, { allowZero: true });
  return total;
}

/**
 * Converts a dollar number (e.g. from user input) to integer cents, rounding half-away-from-zero
 * and rejecting negatives or values with more than 2 decimal places of precision drift.
 */
export function dollarsToCents(dollars: number): number {
  if (typeof dollars !== "number" || !Number.isFinite(dollars)) {
    throw new AppError("VALIDATION", "Dollar amount must be a finite number.", 400);
  }
  if (dollars < 0) {
    throw new AppError("VALIDATION", "Dollar amount cannot be negative.", 400);
  }
  const scaled = dollars * 100;
  const rounded = Math.round(scaled);
  if (Math.abs(scaled - rounded) > 1e-6) {
    throw new AppError(
      "VALIDATION",
      "Dollar amount cannot have more than 2 decimal places.",
      400
    );
  }
  return rounded;
}

/**
 * Formats integer cents for UI display (e.g., 2800 -> "$28.00").
 */
export function formatUsd(
  cents: number,
  options: { trimZeroCents?: boolean } = {}
): string {
  assertValidCents(cents, { allowZero: true });
  if (options.trimZeroCents && cents % 100 === 0) {
    return `$${Math.floor(cents / 100)}`;
  }
  return `$${toPayPalAmount(cents)}`;
}
