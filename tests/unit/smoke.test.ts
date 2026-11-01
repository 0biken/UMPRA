import { describe, expect, it } from "vitest";
import { cn } from "@/lib/utils";

describe("scaffold smoke test", () => {
  it("merges class names cleanly", () => {
    expect(cn("p-2", "p-4")).toBe("p-4");
  });
});
