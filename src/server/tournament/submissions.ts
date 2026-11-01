import { and, eq } from "drizzle-orm";
import { AppError } from "@/lib/errors";
import { audit } from "@/server/audit";
import {
  db,
  disputes,
  entries,
  matches,
  submissions,
} from "@/server/db";
import {
  getStorageProvider,
  validateScreenshotUpload,
  type StorageProvider,
} from "@/server/storage";

export interface SubmitMatchScreenshotInput {
  matchId: string;
  playerId: string;
  bytes: Uint8Array;
  mimeType: string;
}

/**
 * Validates and saves a player's match result screenshot (T-041):
 * - Only the two players of an `awaiting_results` match may submit (`EC-R13` -> 403).
 * - One submission per player; replacement is allowed until the match is evaluated (`EC-R13` -> 409).
 */
export async function submitMatchScreenshot(
  input: SubmitMatchScreenshotInput,
  options?: {
    storage?: StorageProvider;
    now?: Date;
  }
): Promise<typeof submissions.$inferSelect> {
  validateScreenshotUpload({
    byteLength: input.bytes.byteLength,
    mimeType: input.mimeType,
  });

  const storage = options?.storage ?? getStorageProvider();
  const now = options?.now ?? new Date();

  const [match] = await db
    .select()
    .from(matches)
    .where(eq(matches.id, input.matchId))
    .limit(1);

  if (!match) {
    throw new AppError("NOT_FOUND", "Match not found.", 404);
  }

  const isParticipant =
    input.playerId === match.playerAId || input.playerId === match.playerBId;
  if (!isParticipant) {
    throw new AppError(
      "FORBIDDEN",
      "Only the two players assigned to this match can upload a result screenshot.",
      403
    );
  }

  // Once match is evaluated (confirmed or disputed), replacement is refused
  const [existingDispute] = await db
    .select({ id: disputes.id })
    .from(disputes)
    .where(eq(disputes.matchId, match.id))
    .limit(1);

  if (match.status !== "awaiting_results" || existingDispute) {
    throw new AppError(
      "INVALID_TRANSITION",
      "This match has already been evaluated. Screenshot replacement is no longer allowed.",
      409
    );
  }

  const uploaded = await storage.uploadScreenshot({
    matchId: match.id,
    playerId: input.playerId,
    bytes: input.bytes,
    mimeType: input.mimeType,
  });

  const [playerEntry] = await db
    .select()
    .from(entries)
    .where(
      and(
        eq(entries.tournamentId, match.tournamentId),
        eq(entries.playerId, input.playerId)
      )
    )
    .limit(1);

  const gamertag = playerEntry?.gamertag ?? "Player";

  const saved = await db.transaction(async (tx) => {
    // Re-check match status inside transaction
    const [freshMatch] = await tx
      .select()
      .from(matches)
      .where(eq(matches.id, match.id))
      .limit(1);

    if (!freshMatch || freshMatch.status !== "awaiting_results") {
      throw new AppError(
        "INVALID_TRANSITION",
        "This match has already been evaluated. Screenshot replacement is no longer allowed.",
        409
      );
    }

    const [existingSub] = await tx
      .select()
      .from(submissions)
      .where(
        and(
          eq(submissions.matchId, match.id),
          eq(submissions.playerId, input.playerId)
        )
      )
      .limit(1);

    let subRow: typeof submissions.$inferSelect;
    if (existingSub) {
      [subRow] = await tx
        .update(submissions)
        .set({
          screenshotPath: uploaded.path,
          extractionStatus: "pending",
          extractedJson: null,
          confidence: null,
          attempts: 0,
          createdAt: now,
        })
        .where(eq(submissions.id, existingSub.id))
        .returning();
    } else {
      [subRow] = await tx
        .insert(submissions)
        .values({
          matchId: match.id,
          playerId: input.playerId,
          screenshotPath: uploaded.path,
          extractionStatus: "pending",
          extractedJson: null,
          confidence: null,
          attempts: 0,
          createdAt: now,
        })
        .returning();
    }

    await audit(tx, {
      tournamentId: match.tournamentId,
      actorType: "user",
      actorId: input.playerId,
      action: "submission.received",
      payload: {
        matchId: match.id,
        submissionId: subRow.id,
        gamertag,
      },
      dedupeKey: `sub:${subRow.id}:${uploaded.path}`,
    });

    return subRow;
  });

  return saved;
}
