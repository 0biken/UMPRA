import { eq } from "drizzle-orm";
import { AppError } from "@/lib/errors";
import { isUuid } from "@/lib/ids";
import { db, submissions, matches, tournaments } from "@/server/db";
import { getStorageProvider, type StorageProvider } from "@/server/storage";

export async function getSubmissionReadUrl(id: string, viewerId: string, storage: StorageProvider = getStorageProvider()): Promise<string> {
  if (!isUuid(id)) throw new AppError("NOT_FOUND", "Screenshot not found.", 404);
  const [row] = await db.select({ path: submissions.screenshotPath, hostId: tournaments.hostId, a: matches.playerAId, b: matches.playerBId }).from(submissions)
    .innerJoin(matches, eq(submissions.matchId, matches.id))
    .innerJoin(tournaments, eq(matches.tournamentId, tournaments.id)).where(eq(submissions.id, id));
  if (!row) throw new AppError("NOT_FOUND", "Screenshot not found.", 404);
  if (![row.hostId, row.a, row.b].includes(viewerId)) throw new AppError("FORBIDDEN", "Only match participants and the tournament host can view this screenshot.", 403);
  return storage.getSignedReadUrl(row.path, 60);
}
