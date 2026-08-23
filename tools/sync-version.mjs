import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const checkOnly = process.argv.includes("--check");
const packageJson = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const version = packageJson.version;
const files = [
  "index.html",
  "manifest.webmanifest",
  "src/app.js",
  "src/catalog.js",
  "src/exporters.js",
  "src/parser.js",
  "src/requisitions.js",
  "src/storage.js",
  "src/supabase.js",
  "tools/generate-master-catalog.mjs"
];

const changes = [];
for (const file of files) {
  const path = join(root, file);
  const current = readFileSync(path, "utf8");
  const next = current.replace(/\?v=[0-9A-Za-z.-]+/g, `?v=${version}`);
  if (next !== current) {
    changes.push(file);
    if (!checkOnly) writeFileSync(path, next);
  }
}

const versionPath = join(root, "src/version.js");
const currentVersionSource = readFileSync(versionPath, "utf8");
const nextVersionSource = currentVersionSource.replace(
  /APP_VERSION = "[^"]+"/,
  `APP_VERSION = "${version}"`
);
if (nextVersionSource !== currentVersionSource) {
  changes.push("src/version.js");
  if (!checkOnly) writeFileSync(versionPath, nextVersionSource);
}

if (checkOnly && changes.length) {
  console.error(`Version inconsistente (${version}): ${changes.join(", ")}`);
  process.exit(1);
}

console.log(
  checkOnly
    ? `Version ${version} consistente`
    : changes.length
      ? `Version ${version} aplicada a ${changes.length} archivos`
      : `Version ${version} ya estaba sincronizada`
);

