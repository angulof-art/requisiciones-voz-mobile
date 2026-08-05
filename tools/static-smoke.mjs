import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const required = [
  "index.html",
  "styles.css",
  "service-worker.js",
  "manifest.webmanifest",
  "src/app.js",
  "src/config.js",
  "src/parser.js",
  "src/catalog.js",
  "src/requisitions.js",
  "src/storage.js",
  "src/exporters.js",
  "src/supabase.js",
  "supabase/migrations/202608030001_requisitions.sql",
  "data/catalogo-productos-ejemplo.csv",
  "data/plantilla-catalogo.csv",
  "README.md",
  ".env.example"
];

for (const file of required) {
  assert.equal(statSync(join(root, file)).isFile(), true, `${file} no existe`);
}

const index = readFileSync(join(root, "index.html"), "utf8");
const app = readFileSync(join(root, "src/app.js"), "utf8");
const exporters = readFileSync(join(root, "src/exporters.js"), "utf8");
const sw = readFileSync(join(root, "service-worker.js"), "utf8");
const sql = readFileSync(join(root, "supabase/migrations/202608030001_requisitions.sql"), "utf8");
const allText = collectText(root);

assert.ok(index.includes("Dicte los productos"));
assert.ok(index.includes("Agregar texto"));
assert.equal(index.includes("Revisar pedido"), false);
assert.ok(index.includes("Responsable del pedido"));
assert.ok(app.includes("SpeechRecognition") && app.includes("es-CR"));
assert.ok(app.includes("appendFinalSpeechSegment"));
assert.equal(app.includes("finalText || interimText"), false);
assert.ok(app.includes("validateRequisition"));
assert.ok(app.includes("downloadExcel"));
assert.ok(app.includes("autoSaveOrder"));
assert.ok(app.includes("verifySupabaseConnection"));
assert.ok(app.includes("accept-review"));
assert.ok(app.includes("Número ajustado automáticamente"));
assert.ok(readFileSync(join(root, "src/supabase.js"), "utf8").includes("makeConflictSafeRequisitionNumber"));
assert.ok(app.includes("Aceptar línea"));
assert.ok(exporters.includes("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"));
assert.ok(exporters.includes("autoFilter"));
assert.ok(exporters.includes('"Unidad de compra"'));
assert.equal(exporters.includes("noopener"), false);
assert.ok(sw.includes("requestUrl.origin !== self.location.origin"));
assert.ok(sw.includes('APP_VERSION = "v6"'));
assert.ok(sql.includes("enable row level security"));
assert.ok(sql.includes("requisitions"));
assert.equal(/sb_secret_[A-Za-z0-9_-]+|service_role\s*[:=]\s*[A-Za-z0-9_-]+/.test(allText), false);

console.log("Static smoke OK");

function collectText(dir) {
  return readdirSync(dir)
    .flatMap((name) => {
      const path = join(dir, name);
      const stat = statSync(path);
      if (stat.isDirectory() && !["node_modules", ".git"].includes(name)) return collectText(path);
      if (stat.isFile()) return readFileSync(path, "utf8");
      return "";
    })
    .join("\n");
}
