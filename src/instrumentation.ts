export async function register() {
  // Validate environment on server boot (skip during static build phase where runtime secrets may not be injected)
  if (process.env.NEXT_PHASE !== "phase-production-build") {
    await import("@/server/env");
    if (process.env.NEXT_RUNTIME === "nodejs" && process.env.UMPRA_E2E === "1") {
      const { bootE2E } = await import("../tests/support/boot");
      await bootE2E();
    }
  }
}
