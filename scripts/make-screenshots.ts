import fs from "node:fs";
import path from "node:path";
import { renderScoreboardPng } from "../src/server/demo/scoreboard";

function main() {
  const outDir = path.resolve(process.cwd(), "public", "demo-screenshots");
  fs.mkdirSync(outDir, { recursive: true });

  const fixtures = [
    {
      filename: "matching-a.png",
      options: {
        homeName: "Kemi",
        awayName: "Sola",
        homeScore: 3,
        awayScore: 1,
        variant: "matching" as const,
        subtitle: "FINAL RESULT - SUBMITTED BY KEMI",
      },
    },
    {
      filename: "matching-b.png",
      options: {
        homeName: "Kemi",
        awayName: "Sola",
        homeScore: 3,
        awayScore: 1,
        variant: "matching" as const,
        subtitle: "FINAL RESULT - SUBMITTED BY SOLA",
      },
    },
    {
      filename: "mismatch-a.png",
      options: {
        homeName: "Tunde",
        awayName: "Dami",
        homeScore: 2,
        awayScore: 1,
        variant: "mismatch_a" as const,
        subtitle: "CLAIMED BY TUNDE (2-1)",
      },
    },
    {
      filename: "mismatch-b.png",
      options: {
        homeName: "Tunde",
        awayName: "Dami",
        homeScore: 1,
        awayScore: 2,
        variant: "mismatch_b" as const,
        subtitle: "CLAIMED BY DAMI (1-2)",
      },
    },
    {
      filename: "blurry.png",
      options: {
        homeName: "Kemi",
        awayName: "Sola",
        homeScore: 0,
        awayScore: 0,
        variant: "blurry" as const,
      },
    },
    {
      filename: "wrong-players.png",
      options: {
        homeName: "Stranger1",
        awayName: "Stranger2",
        homeScore: 4,
        awayScore: 0,
        variant: "wrong_players" as const,
        subtitle: "UNREGISTERED GAMERTAGS",
      },
    },
  ];

  for (const item of fixtures) {
    const bytes = renderScoreboardPng(item.options);
    const fullPath = path.join(outDir, item.filename);
    fs.writeFileSync(fullPath, bytes);
    console.log(
      JSON.stringify({
        level: "info",
        msg: "Generated generic scoreboard PNG",
        file: `public/demo-screenshots/${item.filename}`,
        bytes: bytes.byteLength,
      })
    );
  }
}

main();
