import { AppError } from "@/lib/errors";
import { assertValidCents } from "@/lib/money";
import type { PayoutSplitBps } from "@/server/db/schema";

export interface ComputedPayoutItem {
  place: number;
  bps: number;
  amountCents: number;
}

/**
 * Deterministic payout calculation per 02 §Money rules:
 * - For each place except the last: floor(poolCents * bps / 10000)
 * - The last place gets poolCents - sum(others) so the sum equals poolCents exactly.
 */
export function computePayouts(
  poolCents: number,
  splitBps: PayoutSplitBps
): ComputedPayoutItem[] {
  assertValidCents(poolCents, { allowZero: false });

  if (!splitBps || typeof splitBps !== "object") {
    throw new AppError(
      "VALIDATION",
      "Payout split must be a non-empty object of place to basis points.",
      400
    );
  }

  const entries = Object.entries(splitBps);
  if (entries.length === 0) {
    throw new AppError(
      "VALIDATION",
      "Payout split must specify at least one place.",
      400
    );
  }

  const parsedPlaces: Array<{ place: number; bps: number }> = [];
  let totalBps = 0;

  for (const [placeKey, bps] of entries) {
    if (!/^[1-9]\d*$/.test(placeKey)) {
      throw new AppError(
        "VALIDATION",
        `Invalid payout place key "${placeKey}". Places must be positive integers.`,
        400
      );
    }
    const place = Number.parseInt(placeKey, 10);
    if (
      typeof bps !== "number" ||
      !Number.isFinite(bps) ||
      !Number.isInteger(bps) ||
      bps <= 0
    ) {
      throw new AppError(
        "VALIDATION",
        `Basis points for place ${place} must be a positive integer.`,
        400
      );
    }
    totalBps += bps;
    parsedPlaces.push({ place, bps });
  }

  if (totalBps !== 10000) {
    throw new AppError(
      "VALIDATION",
      `Payout split basis points must sum to 10000 (100%), received ${totalBps}.`,
      400
    );
  }

  parsedPlaces.sort((a, b) => a.place - b.place);

  const results: ComputedPayoutItem[] = [];
  let allocatedSoFar = 0;

  for (let i = 0; i < parsedPlaces.length; i++) {
    const { place, bps } = parsedPlaces[i];
    const isLast = i === parsedPlaces.length - 1;
    const amountCents = isLast
      ? poolCents - allocatedSoFar
      : Math.floor((poolCents * bps) / 10000);

    if (amountCents <= 0) {
      throw new AppError(
        "VALIDATION",
        `Computed payout for place ${place} is ${amountCents} cents; pool is too small for this split.`,
        400
      );
    }

    allocatedSoFar += amountCents;
    results.push({ place, bps, amountCents });
  }

  return results;
}
