import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const checkOnly = process.argv.includes("--check");
const packageJson = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const version = packageJson.version;
function listJavaScriptFiles(directory, relativeDirectory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const relativePath = join(relativeDirectory, entry.name).replaceAll("\\", "/");
    if (entry.isDirectory()) {
      return listJavaScriptFiles(join(directory, entry.name), relativePath);
    }
    return entry.isFile() && entry.name.endsWith(".js") ? [relativePath] : [];
  });
}

const files = [
  "index.html",
  "manifest.webmanifest",
  ...listJavaScriptFiles(join(root, "src"), "src"),
  "tools/generate-master-catalog.mjs"
];

const changes = [];
for (const file of files) {
  const path = join(root, file);
  const current = readFileSync(path, "utf8");
  let next = current.replace(/\?v=[0-9A-Za-z.-]+/g, `?v=${version}`);
  if (file === "index.html") {
    next = next.replace(/(<strong id="appVersion">)[^<]+/, `$1${version}`);
  }
  if (file === "src/auth/client.js") {
    next = next.replace(
      /requisiciones-voz-mobile\/[0-9A-Za-z.-]+/g,
      `requisiciones-voz-mobile/${version}`
    );
  }
  if (next !== current) {
    changes.push(file);
    if (!checkOnly) writeFileSync(path, next);
  }
}

const readmePath = join(root, "README.md");
const currentReadme = readFileSync(readmePath, "utf8");
const nextReadme = currentReadme.replace(
  /Version actual: \*\*[^*]+\*\*/,
  `Version actual: **${version}**`
);
if (nextReadme !== currentReadme) {
  changes.push("README.md");
  if (!checkOnly) writeFileSync(readmePath, nextReadme);
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
