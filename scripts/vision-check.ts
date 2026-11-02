import { AnthropicVisionProvider } from "../src/server/agent/vision/anthropic";
import { runVisionExtractionWithRetries } from "../src/server/agent/vision/provider";
import { renderScoreboardPng } from "../src/server/demo/scoreboard";
async function main() {
  const result = await runVisionExtractionWithRetries(new AnthropicVisionProvider(), { imageBytes: renderScoreboardPng({ homeName:"Kemi", awayName:"Sola", homeScore:3, awayScore:1 }), mimeType:"image/png", expectedGamertags:["Kemi","Sola"] });
  const e = result.extractedJson;
  if (result.extractionStatus !== "ok" || !e?.readable || e.confidence < 0.8 || e.home.name?.toLowerCase() !== "kemi" || e.away.name?.toLowerCase() !== "sola" || e.home.score !== 3 || e.away.score !== 1) throw new Error(`Vision check failed: ${result.extractionStatus}. Verify the configured model and credentials.`);
  console.log("Live vision check passed: Kemi 3–1 Sola.");
}
main().catch(err=>{ console.error(err instanceof Error ? err.message : "Vision check failed"); process.exitCode=1; });
