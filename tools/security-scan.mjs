import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const files = execFileSync("git", ["ls-files"], { encoding: "utf8" }).split(/\r?\n/).filter(Boolean);
const findings = [];
const rules = [
  ["private-key", /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
  ["supabase-secret", /sb_secret_[A-Za-z0-9_-]{16,}/],
  ["service-role-value", /service[_-]?role\s*[:=]\s*["'][A-Za-z0-9._-]{20,}["']/i],
  ["hardcoded-password", /(?:password|passwd)\s*[:=]\s*["'](?!password|example|qa-|<)[^"']{12,}["']/i]
];

for (const file of files) {
  if (/\.(png|jpg|jpeg|gif|ico|woff2?|xlsx|pdf)$/i.test(file)) continue;
  const text = readFileSync(file, "utf8");
  for (const [name, pattern] of rules) {
    if (pattern.test(text)) findings.push(`${name}: ${file}`);
  }
}

assert.deepEqual(findings, [], `Posibles secretos encontrados:\n${findings.join("\n")}`);
console.log(`Security scan OK: ${files.length} archivos rastreados`);
