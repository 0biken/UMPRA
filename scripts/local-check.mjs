import { spawn } from "node:child_process";
import { localEnv } from "./local-env.mjs";
const mode = process.argv[2];
if (!["build", "dev"].includes(mode)) throw new Error("Usage: node scripts/local-check.mjs build|dev");
const args = ["node_modules/next/dist/bin/next", mode, ...(mode === "dev" ? ["--turbopack", "--port", "3317"] : [])];
const child = spawn(process.execPath, args, { stdio:"inherit", env:{ ...process.env, ...localEnv, ...(mode === "dev" ? {UMPRA_E2E:"1"} : {UMPRA_E2E:"0"}), NEXT_TELEMETRY_DISABLED:"1" } });
child.on("exit", code => process.exit(code ?? 1));
