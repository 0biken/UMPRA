import { testOverrides } from "@/server/test-overrides";
import { buildVisionUserMessage, VISION_EXTRACTION_SYSTEM_PROMPT } from "@/server/agent/prompts";
import { generateGeminiText } from "../gemini";
import type { VisionExtractInput, VisionProvider } from "./provider";

export class GeminiVisionProvider implements VisionProvider {
  public async extractRaw(input: VisionExtractInput): Promise<string> {
    return generateGeminiText({
      system: VISION_EXTRACTION_SYSTEM_PROMPT,
      text: buildVisionUserMessage(input.expectedGamertags),
      image: { bytes: input.imageBytes, mimeType: input.mimeType },
      json: true,
    });
  }
}

let activeVisionProvider: VisionProvider | null = null;

export function getVisionProvider(): VisionProvider {
  const override = testOverrides()?.vision;
  if (override) return override;
  activeVisionProvider ??= new GeminiVisionProvider();
  return activeVisionProvider;
}

export function setVisionProvider(provider: VisionProvider | null): void {
  activeVisionProvider = provider;
}
