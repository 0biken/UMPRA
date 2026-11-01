import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";

describe("design tokens (T-004)", () => {
  const cssPath = path.resolve(__dirname, "../../src/app/globals.css");
  const css = fs.readFileSync(cssPath, "utf8");

  it("defines every required colour, font, radius, elevation, and motion token from 07-DESIGN-SYSTEM.md", () => {
    const expectedTokens = [
      "--color-chalk: #F2F5F1;",
      "--color-paper: #FFFFFF;",
      "--color-ink: #0F231E;",
      "--color-ink-2: #2B433B;",
      "--color-muted: #5B6F67;",
      "--color-line: #D9E1DB;",
      "--color-line-strong: #B7C4BB;",
      "--color-pitch: #17734A;",
      "--color-pitch-dark: #0F5636;",
      "--color-pitch-tint: #E1F0E7;",
      "--color-card-yellow: #F0BE1F;",
      "--color-yellow-tint: #FCF3CF;",
      "--color-yellow-ink: #6B4E00;",
      "--color-card-red: #CC3B33;",
      "--color-red-tint: #FBE5E3;",
      "--color-red-ink: #8E2620;",
      "--radius-field: 4px;",
      "--radius-control: 8px;",
      "--radius-panel: 14px;",
      "--shadow-float: 0 8px 28px rgba(15, 35, 30, 0.16);",
      "--ease-out: cubic-bezier(0.2, 0.7, 0.2, 1);",
      "--dur-fast: 120ms;",
      "--dur-base: 200ms;",
      "--dur-draw: 450ms;",
    ];

    for (const token of expectedTokens) {
      expect(css).toContain(token);
    }
  });

  it("includes prefers-reduced-motion rule and focus-visible outline", () => {
    expect(css).toContain("prefers-reduced-motion: reduce");
    expect(css).toContain(":focus-visible");
  });
});
