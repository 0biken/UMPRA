import { describe, expect, it } from "vitest";
import { parseTournamentPrompt } from "@/server/agent/parse-tournament";

describe("plain-language tournament parser (T-071, T-072, EC-S2)", () => {
  it('parses "8-player knockout, $5 entry, winner 70%, runner-up 30%" into a valid config (T-072 AC)', async () => {
    const res = await parseTournamentPrompt(
      "8-player knockout, $5 entry, winner 70%, runner-up 30%"
    );

    expect(res.valid).toBe(true);
    expect(res.problems).toEqual([]);
    expect(res.preview.slots).toBe(8);
    expect(res.preview.entryFeeUsd).toBe(5);
    expect(res.preview.entryFeeCents).toBe(500);
    expect(res.preview.winnerPercent).toBe(70);
    expect(res.preview.runnerUpPercent).toBe(30);
    expect(res.validatedConfig).not.toBeNull();
    expect(res.validatedConfig?.entryFeeCents).toBe(500);
    expect(res.validatedConfig?.payoutSplit).toEqual({
      "1": 7000,
      "2": 3000,
    });
  });

  it("parses slash-style split and winner-takes-all prompts accurately", async () => {
    const slash = await parseTournamentPrompt(
      '"Friday Night Cup" 8 players, $10 entry, 70/30 split'
    );
    expect(slash.valid).toBe(true);
    expect(slash.preview.title).toBe("Friday Night Cup");
    expect(slash.preview.entryFeeCents).toBe(1000);
    expect(slash.preview.payoutSplit).toEqual({ "1": 7000, "2": 3000 });

    const wta = await parseTournamentPrompt(
      "8-player tournament, $5 entry, winner takes all"
    );
    expect(wta.valid).toBe(true);
    expect(wta.preview.payoutSplit).toEqual({ "1": 10000 });
  });

  it("returns explicit problem explanations for 16 players or a $200 fee without silently altering values (EC-S2, T-071)", async () => {
    const sixteen = await parseTournamentPrompt(
      "16-player knockout, $5 entry, winner 70%, runner-up 30%"
    );
    expect(sixteen.valid).toBe(false);
    expect(sixteen.preview.slots).toBe(16);
    expect(sixteen.validatedConfig).toBeNull();
    expect(
      sixteen.problems.some((p) => p.includes("8-player") && p.includes("16"))
    ).toBe(true);

    const highFee = await parseTournamentPrompt(
      "8-player knockout, $200 entry, winner 70%, runner-up 30%"
    );
    expect(highFee.valid).toBe(false);
    expect(highFee.preview.entryFeeUsd).toBe(200);
    expect(highFee.validatedConfig).toBeNull();
    expect(
      highFee.problems.some((p) => p.includes("$20.00") && p.includes("200"))
    ).toBe(true);
  });

  it("flags splits not totaling 100% or with more than 2 places in problems", async () => {
    const badSum = await parseTournamentPrompt(
      "8-player knockout, $5 entry, winner 60%, runner-up 30%"
    );
    expect(badSum.valid).toBe(false);
    expect(badSum.problems.some((p) => p.includes("100%"))).toBe(true);

    const threePlaces = await parseTournamentPrompt(
      "8-player knockout, $5 entry, 60/25/15 split"
    );
    expect(threePlaces.valid).toBe(false);
    expect(threePlaces.problems.some((p) => p.includes("2 paid places"))).toBe(
      true
    );
  });
});
