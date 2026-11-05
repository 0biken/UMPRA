import { eq } from "drizzle-orm";
import { hashPassword } from "@/server/auth/password";
import { db, tournaments, users, type DbOrTx } from "@/server/db";
import { assertDemoModeEnabled, ensureDemoBotUsers } from "./service";
import { audit } from "@/server/audit";
import { assertTransition } from "@/server/tournament/state-machine";

export const SEED_TOURNAMENT_IDS = { openEmpty: "11111111-1111-4111-8111-111111111101" } as const;
/** Seeds identities and an empty tournament, never payment truth or invented balances. */
export async function seedDemoDatabase(txOrDb: DbOrTx = db) {
  assertDemoModeEnabled();
  const bots = await ensureDemoBotUsers(txOrDb);
  const passwordHash = await hashPassword("umpra-demo-password-2026");
  const [host] = await txOrDb.insert(users).values({ email: "demo-host@umpra.test", passwordHash, displayName: "Demo Host", role: "host", isDemo: true }).onConflictDoUpdate({ target: users.email, set: { isDemo: true } }).returning();
  await txOrDb.insert(tournaments).values({ id: SEED_TOURNAMENT_IDS.openEmpty, hostId: host.id, title: "Friday Night Knockout", game: "Spot Kick Club", entryFeeCents: 500, payoutSplit: { "1": 7000, "2": 3000 }, state: "draft" }).onConflictDoNothing();
  await txOrDb.transaction(async tx => {
    const [t] = await tx.select().from(tournaments).where(eq(tournaments.id, SEED_TOURNAMENT_IDS.openEmpty)).limit(1).for("update");
    if (t.state !== "draft") return;
    assertTransition(t.state, "open");
    await tx.update(tournaments).set({ state: "open" }).where(eq(tournaments.id, t.id));
    await audit(tx, { tournamentId: t.id, actorType: "user", actorId: host.id, action: "tournament.created", payload: { title: t.title }, dedupeKey: `create:${t.id}` });
    await audit(tx, { tournamentId: t.id, actorType: "user", actorId: host.id, action: "tournament.opened", payload: { entryFeeCents: t.entryFeeCents, payoutSplit: t.payoutSplit }, dedupeKey: `open:${t.id}` });
  });
  const rows = await txOrDb.select().from(tournaments).where(eq(tournaments.id, SEED_TOURNAMENT_IDS.openEmpty));
  return { hostEmail: host.email, playerEmail: bots[0].email, botCount: bots.length, seededTournaments: rows.map(t => t.id), readyPayoutRows: 0 };
}
