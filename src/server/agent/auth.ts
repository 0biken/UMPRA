import { AppError } from "@/lib/errors";
import { env } from "@/server/env";

export function assertSweepSecret(req: Request): void {
  const provided =
    req.headers.get("x-sweep-secret") ??
    req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");

  if (!provided || provided !== env.AGENT_SWEEP_SECRET) {
    throw new AppError(
      "UNAUTHENTICATED",
      "Missing or invalid agent sweep secret.",
      401
    );
  }
}
