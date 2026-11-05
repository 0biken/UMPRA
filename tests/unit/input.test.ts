import { describe, expect, it } from "vitest";
import { readJson, readScreenshotForm } from "@/server/input";
describe("bounded untrusted API input", () => {
  it("rejects oversized JSON without trusting Content-Length", async () => {
    await expect(readJson(new Request("http://localhost", { method:"POST", body:JSON.stringify({ value:"x".repeat(17000) }) }))).rejects.toMatchObject({ status:413 });
  });
  it("returns a safe error for malformed JSON and parses valid input", async () => {
    await expect(readJson(new Request("http://localhost", { method:"POST", body:'{"password":"sensitive' }))).rejects.toMatchObject({ code:"VALIDATION", message:"Invalid JSON. Check the request and try again." });
    expect(await readJson(new Request("http://localhost", { method:"POST", body:'{"role":"host"}' }))).toEqual({ role:"host" });
  });
  it("preserves an uploaded screenshot in bounded multipart data", async () => {
    const form=new FormData(); form.append("file",new Blob([new Uint8Array([1,2,3])],{type:"image/png"}),"score.png");
    const parsed=await readScreenshotForm(new Request("http://localhost",{method:"POST",body:form}));
    expect((parsed.get("file") as File).size).toBe(3);
  });
});
