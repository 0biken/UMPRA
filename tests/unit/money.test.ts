import { describe, expect, it } from "vitest";
import {
  assertValidCents,
  dollarsToCents,
  formatUsd,
  fromPayPalAmount,
  toPayPalAmount,
} from "@/lib/money";
import { AppError } from "@/lib/errors";
import {
  captureRequestId,
  isUuid,
  newId,
  orderRequestId,
  payoutBatchId,
  payoutItemId,
  refundRequestId,
} from "@/lib/ids";

describe("money helpers (T-006)", () => {
  it("converts integer cents to PayPal decimal strings", () => {
    expect(toPayPalAmount(2800)).toBe("28.00");
    expect(toPayPalAmount(1200)).toBe("12.00");
    expect(toPayPalAmount(500)).toBe("5.00");
    expect(toPayPalAmount(5)).toBe("0.05");
    expect(toPayPalAmount(99)).toBe("0.99");
    expect(toPayPalAmount(0)).toBe("0.00");
  });

  it("converts PayPal decimal strings back to integer cents", () => {
    expect(fromPayPalAmount("28.00")).toBe(2800);
    expect(fromPayPalAmount("12.00")).toBe(1200);
    expect(fromPayPalAmount("5.00")).toBe(500);
    expect(fromPayPalAmount("5.5")).toBe(550);
    expect(fromPayPalAmount("5")).toBe(500);
    expect(fromPayPalAmount("0.05")).toBe(5);
    expect(fromPayPalAmount("0.00")).toBe(0);
  });

  it("round-trips cents to PayPal string and back cleanly", () => {
    for (const cents of [0, 1, 10, 99, 100, 500, 1234, 2800, 4000, 19999]) {
      expect(fromPayPalAmount(toPayPalAmount(cents))).toBe(cents);
    }
  });

  it("rejects floats, NaN, and negative values in toPayPalAmount and assertValidCents", () => {
    expect(() => toPayPalAmount(-1)).toThrow(AppError);
    expect(() => toPayPalAmount(-2800)).toThrow(AppError);
    expect(() => toPayPalAmount(28.5)).toThrow(AppError);
    expect(() => toPayPalAmount(Number.NaN)).toThrow(AppError);
    expect(() => toPayPalAmount(Number.POSITIVE_INFINITY)).toThrow(AppError);
    expect(() => assertValidCents(0, { allowZero: false })).toThrow(AppError);
  });

  it("rejects negative, malformed, or >2 decimal strings in fromPayPalAmount", () => {
    expect(() => fromPayPalAmount("-28.00")).toThrow(AppError);
    expect(() => fromPayPalAmount("28.005")).toThrow(AppError);
    expect(() => fromPayPalAmount("$28.00")).toThrow(AppError);
    expect(() => fromPayPalAmount("")).toThrow(AppError);
    expect(() => fromPayPalAmount("abc")).toThrow(AppError);
  });

  it("handles rounding and rejects invalid inputs in dollarsToCents", () => {
    expect(dollarsToCents(28)).toBe(2800);
    expect(dollarsToCents(19.99)).toBe(1999);
    expect(dollarsToCents(0.1 + 0.2)).toBe(30); // IEEE-754 float drift rounded cleanly
    expect(() => dollarsToCents(-5)).toThrow(AppError);
    expect(() => dollarsToCents(5.125)).toThrow(AppError);
  });

  it("formats USD strings at the UI edge", () => {
    expect(formatUsd(2800)).toBe("$28.00");
    expect(formatUsd(500, { trimZeroCents: true })).toBe("$5");
    expect(formatUsd(525, { trimZeroCents: true })).toBe("$5.25");
  });
});

describe("id helpers (T-006)", () => {
  it("generates valid UUIDs and deterministic idempotency keys", () => {
    const id = newId();
    expect(isUuid(id)).toBe(true);
    expect(isUuid("not-a-uuid")).toBe(false);
    expect(orderRequestId("e1")).toBe("entry-e1");
    expect(captureRequestId("e1")).toBe("capture-e1");
    expect(refundRequestId("p1")).toBe("refund-p1");
    expect(payoutBatchId("t1")).toBe("payout-t1");
    expect(payoutBatchId("t1", 2)).toBe("payout-t1-retry-2");
    expect(payoutItemId("t1", 1)).toBe("t1-1");
  });
});
