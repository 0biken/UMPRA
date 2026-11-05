import crypto from "crypto";

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function newId(): string {
  return crypto.randomUUID();
}

export function isUuid(value: string): boolean {
  return UUID_REGEX.test(value);
}

export function orderRequestId(entryId: string): string {
  return `entry-${entryId}`;
}

export function captureRequestId(entryId: string): string {
  return `capture-${entryId}`;
}

export function refundRequestId(paymentId: string): string {
  return `refund-${paymentId}`;
}

export function payoutBatchId(tournamentId: string, retryCount?: number): string {
  if (retryCount !== undefined && retryCount > 0) {
    return `payout-${tournamentId}-retry-${retryCount}`;
  }
  return `payout-${tournamentId}`;
}

export function payoutItemId(tournamentId: string, place: number): string {
  return `${tournamentId}-${place}`;
}
