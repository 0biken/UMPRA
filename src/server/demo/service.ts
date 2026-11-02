import { and, asc, eq } from "drizzle-orm";
import { AppError } from "@/lib/errors";
import { env } from "@/server/env";
import { audit } from "@/server/audit";
import { hashPassword } from "@/server/auth/password";
import { db, entries, matches, tournaments, users, type DbOrTx } from "@/server/db";
import { getLivePrizePoolCents } from "@/server/paypal/orders";
import { tick, type TickOptions } from "@/server/agent/tick";
import { submitMatchScreenshot } from "@/server/tournament/submissions";
import { renderScoreboardPng } from "./scoreboard";

const NAMES = ["Kemi", "Sola", "Tunde", "Dami", "Chidi", "Amaka", "Femi", "Zainab"];
export function assertDemoModeEnabled(): void {
  if (!env.DEMO_MODE) throw new AppError("NOT_FOUND", "Demo mode is disabled.", 404);
}
export function demoRecipientEmails(): string[] {
  const emails = env.DEMO_PAYPAL_RECIPIENTS;
  if (emails.length !== 8) throw new AppError("VALIDATION", "Configure eight sandbox recipient emails in DEMO_PAYPAL_RECIPIENTS before using demo players.", 400);
  return emails;
}
export async function ensureDemoBotUsers(txOrDb: DbOrTx = db) {
  const recipients = demoRecipientEmails();
  const passwordHash = await hashPassword("umpra-demo-bot-password");
  const result: Array<typeof users.$inferSelect> = [];
  for (let i = 0; i < 8; i++) {
    const [bot] = await txOrDb.insert(users).values({ email: `demo-player-${i + 1}@umpra.test`, passwordHash, displayName: NAMES[i], role: "player", isDemo: true, paypalEmail: recipients[i] }).onConflictDoUpdate({ target: users.email, set: { paypalEmail: recipients[i], isDemo: true } }).returning();
    result.push(bot);
  }
  return result;
}
async function ownedTournament(id: string, hostId: string, tx: DbOrTx = db) {
  const [t] = await tx.select().from(tournaments).where(eq(tournaments.id, id)).limit(1).for("update");
  if (!t) throw new AppError("NOT_FOUND", "Tournament not found.", 404);
  if (t.hostId !== hostId) throw new AppError("FORBIDDEN", "Only this tournament's host can use demo controls.", 403);
  return t;
}
export async function fillTournamentWithDemoPlayers(tournamentId: string, hostId: string, options?: TickOptions) {
  assertDemoModeEnabled();
  // Authorization precedes creation or changes to any demo account.
  await db.transaction(tx => ownedTournament(tournamentId, hostId, tx));
  const bots = await ensureDemoBotUsers();
  const addedCount = await db.transaction(async tx => {
    const t = await ownedTournament(tournamentId, hostId, tx);
    if (t.state !== "open") {
      const existingBots = await tx.select().from(entries).where(and(eq(entries.tournamentId, t.id), eq(entries.simulated, true)));
      if (existingBots.length && ["locked", "in_progress", "results_pending", "confirmed", "paid"].includes(t.state)) return 0;
      throw new AppError("INVALID_TRANSITION", "Registration must be open to add demo players.", 409);
    }
    if (await getLivePrizePoolCents(t.id, tx) <= 0) throw new AppError("VALIDATION", "Complete at least one PayPal sandbox checkout before filling demo slots. Demo players contribute no funds.", 400);
    const current = await tx.select().from(entries).where(eq(entries.tournamentId, t.id));
    const active = current.filter(e => e.status === "paid" || e.status === "pending");
    let remaining = t.slots - active.length;
    let added = 0;
    for (const bot of bots) {
      if (remaining <= 0) break;
      if (current.some(e => e.playerId === bot.id)) continue;
      const gamertag = current.some(e => e.gamertag.toLowerCase() === bot.displayName.toLowerCase()) ? `${bot.displayName}Demo` : bot.displayName;
      const [entry] = await tx.insert(entries).values({ tournamentId: t.id, playerId: bot.id, gamertag, status: "paid", simulated: true }).returning();
      await audit(tx, { tournamentId: t.id, actorType: "user", actorId: hostId, action: "entry.simulated", payload: { entryId: entry.id, gamertag, simulated: true, amountCents: 0 }, dedupeKey: `demo-entry:${entry.id}` });
      added++; remaining--;
    }
    return added;
  });
  await tick(tournamentId, options);
  return { addedCount, tournamentId };
}
export type DemoSubmissionScenario = "agree" | "mismatch" | "unreadable" | "wrong_players";
export async function submitDemoMatchScreenshots(params: { matchId: string; scenario: DemoSubmissionScenario }, hostId: string, options?: TickOptions) {
  assertDemoModeEnabled();
  const [m] = await db.select().from(matches).where(eq(matches.id, params.matchId)).limit(1);
  if (!m) throw new AppError("NOT_FOUND", "Match not found.", 404);
  await db.transaction(tx => ownedTournament(m.tournamentId, hostId, tx));
  if (m.status === "confirmed" || m.status === "disputed") return { matchId: m.id, tournamentId: m.tournamentId, scenario: params.scenario };
  if (m.status !== "awaiting_results" || !m.playerAId || !m.playerBId) throw new AppError("INVALID_TRANSITION", "This match is not awaiting results.", 409);
  const es = await db.select().from(entries).where(eq(entries.tournamentId, m.tournamentId)).orderBy(asc(entries.createdAt));
  const tagA = es.find(e => e.playerId === m.playerAId)!.gamertag;
  const tagB = es.find(e => e.playerId === m.playerBId)!.gamertag;
  for (const [index, playerId] of [m.playerAId, m.playerBId].entries()) {
    const mismatch = params.scenario === "mismatch" && index === 1;
    const wrong = params.scenario === "wrong_players" && index === 0;
    const blurry = params.scenario === "unreadable" && index === 0;
    const bytes = renderScoreboardPng({ homeName: wrong ? "Stranger1" : tagA, awayName: wrong ? "Stranger2" : tagB, homeScore: mismatch ? 1 : 3, awayScore: mismatch ? 3 : 1, variant: blurry ? "blurry" : wrong ? "wrong_players" : mismatch ? "mismatch_b" : "matching" });
    await submitMatchScreenshot({ matchId: m.id, playerId, bytes, mimeType: "image/png" }, { storage: options?.storage, replaceExisting: false });
  }
  await tick(m.tournamentId, options);
  return { matchId: m.id, tournamentId: m.tournamentId, scenario: params.scenario };
}
