import type { AllowedScreenshotMime } from "@/server/storage";
import {
  parseVisionExtractionOutput,
  type Extraction,
} from "./schema";

export interface VisionExtractInput {
  imageBytes: Uint8Array;
  mimeType: AllowedScreenshotMime;
  expectedGamertags: [string, string];
  screenshotPath?: string;
}

export interface VisionProvider {
  /**
   * Calls the vision model and returns its raw text response.
   * May throw on network/transport errors.
   */
  extractRaw(input: VisionExtractInput): Promise<string>;
}

export interface VisionExtractionResult {
  extractionStatus: "ok" | "unreadable" | "pending";
  extractedJson: Extraction | null;
  confidence: number | null;
  attemptsUsed: number;
  error?: string;
}

/**
 * Runs vision extraction with up to 2 retries on malformed output (max 3 total attempts),
 * then returns `unreadable` per `05 §Vision schema` and `05 §Failure behavior`.
 * On transport errors, if priorAttempts + 1 < 2, keeps status `pending` so next tick retries;
 * after 2 failed transport attempts, marks `unreadable`.
 */
export async function runVisionExtractionWithRetries(
  provider: VisionProvider,
  input: VisionExtractInput,
  options?: {
    priorAttempts?: number;
    maxMalformedRetries?: number;
  }
): Promise<VisionExtractionResult> {
  const maxRetries = options?.maxMalformedRetries ?? 2;
  const maxAttempts = 1 + maxRetries;
  let attempts = options?.priorAttempts ?? 0;
  let lastError = "";

  for (let i = 0; i < maxAttempts; i++) {
    attempts += 1;
    let rawText: string;
    try {
      rawText = await provider.extractRaw(input);
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      // Transport error: if fewer than 2 total attempts have failed, stay `pending` for next tick
      if (attempts < 2) {
        return {
          extractionStatus: "pending",
          extractedJson: null,
          confidence: null,
          attemptsUsed: attempts,
          error: lastError,
        };
      }
      return {
        extractionStatus: "unreadable",
        extractedJson: null,
        confidence: null,
        attemptsUsed: attempts,
        error: lastError,
      };
    }

    const parsed = parseVisionExtractionOutput(rawText);
    if (parsed.status === "ok") {
      return {
        extractionStatus: "ok",
        extractedJson: parsed.data,
        confidence: parsed.data.confidence,
        attemptsUsed: attempts,
      };
    }

    lastError = parsed.error;
  }

  return {
    extractionStatus: "unreadable",
    extractedJson: null,
    confidence: null,
    attemptsUsed: attempts,
    error: lastError,
  };
}

/**
 * Scriptable test double for VisionProvider per `08 §Test doubles`.
 */
export class FakeVision implements VisionProvider {
  private byPath = new Map<string, Array<string | Error>>();
  private defaultQueue: Array<string | Error> = [];
  public calls: VisionExtractInput[] = [];

  public scriptForPath(
    screenshotPath: string,
    ...responses: Array<Extraction | string | Error>
  ): void {
    this.byPath.set(
      screenshotPath,
      responses.map((r) =>
        r instanceof Error || typeof r === "string" ? r : JSON.stringify(r)
      )
    );
  }

  public enqueue(...responses: Array<Extraction | string | Error>): void {
    for (const r of responses) {
      this.defaultQueue.push(
        r instanceof Error || typeof r === "string" ? r : JSON.stringify(r)
      );
    }
  }

  public async extractRaw(input: VisionExtractInput): Promise<string> {
    this.calls.push(input);
    const pathQueue = input.screenshotPath
      ? this.byPath.get(input.screenshotPath)
      : undefined;

    if (pathQueue && pathQueue.length > 0) {
      const next = pathQueue.length > 1 ? pathQueue.shift()! : pathQueue[0];
      if (next instanceof Error) throw next;
      return next;
    }

    if (this.defaultQueue.length > 0) {
      const next = this.defaultQueue.shift()!;
      if (next instanceof Error) throw next;
      return next;
    }

    // Default agreeing 2-1 result for expectedGamertags[0]
    const fallback: Extraction = {
      readable: true,
      game_over: true,
      home: { name: input.expectedGamertags[0], score: 2 },
      away: { name: input.expectedGamertags[1], score: 1 },
      confidence: 0.95,
      notes: "Clear scoreboard",
    };
    return JSON.stringify(fallback);
  }
}
