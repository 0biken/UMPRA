export async function register() {
  // Validate environment on server boot (skip during static build phase where runtime secrets may not be injected)
  if (process.env.NEXT_PHASE !== "phase-production-build") {
    await import("@/server/env");
  }
}
