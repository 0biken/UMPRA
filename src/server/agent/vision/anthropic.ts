import { testOverrides } from "@/server/test-overrides";
import Anthropic from "@anthropic-ai/sdk";
import { env } from "@/server/env";
import {
  buildVisionUserMessage,
  VISION_EXTRACTION_SYSTEM_PROMPT,
} from "@/server/agent/prompts";
import type { VisionExtractInput, VisionProvider } from "./provider";

export class AnthropicVisionProvider implements VisionProvider {
  private client: Anthropic | null = null;

  private getClient(): Anthropic {
    if (!this.client) {
      this.client = new Anthropic({
        apiKey: env.ANTHROPIC_API_KEY,
      });
    }
    return this.client;
  }

  public async extractRaw(input: VisionExtractInput): Promise<string> {
    const client = this.getClient();
    const base64Image = Buffer.from(input.imageBytes).toString("base64");

    const response = await client.messages.create({
      model: env.VISION_MODEL,
      max_tokens: 400,
      temperature: 0,
      system: VISION_EXTRACTION_SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: {
                type: "base64",
                media_type: input.mimeType,
                data: base64Image,
              },
            },
            {
              type: "text",
              text: buildVisionUserMessage(input.expectedGamertags),
            },
          ],
        },
      ],
    });

    const textBlock = response.content.find((b) => b.type === "text");
    return textBlock && textBlock.type === "text" ? textBlock.text : "";
  }
}

let activeVisionProvider: VisionProvider | null = null;

export function getVisionProvider(): VisionProvider {
  const override = testOverrides()?.vision;
  if (override) return override;
  if (!activeVisionProvider) {
    activeVisionProvider = new AnthropicVisionProvider();
  }
  return activeVisionProvider;
}

export function setVisionProvider(provider: VisionProvider | null): void {
  activeVisionProvider = provider;
}
