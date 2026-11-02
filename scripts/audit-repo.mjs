import { execFileSync } from "node:child_process";
import fs from "node:fs";
const git = args => execFileSync("git",args,{ encoding:"utf8",maxBuffer:32*1024*1024 });
const signatures = [/sk-ant-api\d{2}-[A-Za-z0-9_-]{30,}/, /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/, /AKIA[A-Z0-9]{16}/];
const findings = new Set();
const files = git(["ls-files","--cached","--others","--exclude-standard","-z"]).split("\0").filter(Boolean);
for (const file of files) {
  if (/^\.env(?:\.|$)/.test(file) && file !== ".env.example") findings.add(`unignored env file: ${file}`);
  if (!fs.existsSync(file) || fs.statSync(file).size > 2*1024*1024) continue;
  const text = fs.readFileSync(file,"utf8");
  if (signatures.some(pattern=>pattern.test(text))) findings.add(`signature in working tree: ${file}`);
}
const commits = git(["rev-list","--all"]).trim().split("\n").filter(Boolean);
for (const commit of commits) {
  try {
    const hits = git(["grep", "-I", "-l", "-E", "sk-ant-api[0-9]{2}-[A-Za-z0-9_-]{30,}|-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----|AKIA[A-Z0-9]{16}", commit]);
    for (const hit of hits.trim().split("\n").filter(Boolean)) findings.add(`signature in history: ${hit}`);
  } catch (err) { if (err.status !== 1) throw err; }
  const names = git(["ls-tree","-r","--name-only",commit]).trim().split("\n").filter(Boolean);
  for (const file of names) {
    if (/^\.env(?:\.|$)/.test(file) && file !== ".env.example") findings.add(`env file in history: ${commit.slice(0,8)}:${file}`);

  }
}
if(findings.size){ console.error([...findings].join("\n"));process.exitCode=1; }
else console.log(`No matching secret signatures or unignored env files in ${files.length} files and ${commits.length} commits. Manual credential review remains required.`);
