import { eq } from "drizzle-orm";
import { AppError } from "@/lib/errors";
import { isUuid } from "@/lib/ids";
import { env } from "@/server/env";
import { db, tournaments, type UserRole } from "@/server/db";
import { getSession, type SessionUser } from "./session";

export async function requireUser(role?: UserRole): Promise<SessionUser> {
  const user = await getSession();
  if (!user) {
    throw new AppError(
      "UNAUTHENTICATED",
      "Sign in to continue.",
      401
    );
  }
  if (role && user.role !== role) {
    throw new AppError(
      "FORBIDDEN",
      `This action requires a ${role} account. Your account is registered as a ${user.role}.`,
      403
    );
  }
  return user;
}

export async function requireTournamentHost(tournamentId: string): Promise<{
  user: SessionUser;
  tournament: typeof tournaments.$inferSelect;
}> {
  const user = await requireUser("host");
  if (!isUuid(tournamentId)) {
    throw new AppError("NOT_FOUND", "Tournament not found.", 404);
  }
  const [tournament] = await db
    .select()
    .from(tournaments)
    .where(eq(tournaments.id, tournamentId))
    .limit(1);

  if (!tournament) {
    throw new AppError("NOT_FOUND", "Tournament not found.", 404);
  }
  if (tournament.hostId !== user.id) {
    throw new AppError(
      "FORBIDDEN",
      "Only the host who created this tournament can manage it.",
      403
    );
  }
  return { user, tournament };
}

export function assertSameOrigin(
  req: Request,
  options?: { allowMultipart?: boolean; allowEmptyBody?: boolean }
): void {
  const originHeader = req.headers.get("origin");
  const expectedHost = new URL(env.APP_URL).host;

  if (!originHeader) {
    throw new AppError(
      "FORBIDDEN",
      "Missing Origin header on mutating request.",
      403
    );
  }

  let originHost: string;
  try {
    originHost = new URL(originHeader).host;
  } catch {
    throw new AppError("FORBIDDEN", "Malformed Origin header.", 403);
  }

  // Also allow matching the request's own Host header when running locally or on preview URLs if it matches APP_URL
  const reqHost = req.headers.get("host");
  if (originHost !== expectedHost && (!reqHost || originHost !== reqHost)) {
    throw new AppError(
      "FORBIDDEN",
      "Cross-origin mutating requests are not allowed.",
      403
    );
  }

  if (!options?.allowEmptyBody) {
    const contentType = req.headers.get("content-type") ?? "";
    const isJson = contentType.toLowerCase().includes("application/json");
    const isMultipart =
      Boolean(options?.allowMultipart) &&
      contentType.toLowerCase().includes("multipart/form-data");
    if (!isJson && !isMultipart) {
      throw new AppError(
        "VALIDATION",
        options?.allowMultipart
          ? "Content-Type must be application/json or multipart/form-data."
          : "Content-Type must be application/json.",
        400
      );
    }
  }
}
