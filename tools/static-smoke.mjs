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
  "src/auth/client.js",
  "src/auth/context.js",
  "src/auth/permissions.js",
  "src/auth/session.js",
  "src/version.js",
  "src/config.js",
  "src/parser.js",
  "src/catalog.js",
  "src/catalog-data.js",
  "src/requisitions.js",
  "src/workflow.js",
  "src/voice-engine.js",
  "src/db/indexeddb.js",
  "src/db/migrate-v10.js",
  "src/storage.js",
  "src/exporters.js",
  "src/supabase.js",
  "vendor/supabase.js",
  "supabase/migrations/202608030001_requisitions.sql",
  "supabase/migrations/202608040003_seed_master_catalog.sql",
  "data/catalogo-productos-maestro.csv",
  "data/catalogo-productos-maestro-resumen.json",
  "data/catalogo-productos-ejemplo.csv",
  "data/plantilla-catalogo.csv",
  "README.md",
  "V2_IMPLEMENTATION_PLAN.md",
  ".env.example"
];

for (const file of required) {
  assert.equal(statSync(join(root, file)).isFile(), true, `${file} no existe`);
}

const index = readFileSync(join(root, "index.html"), "utf8");
const app = readFileSync(join(root, "src/app.js"), "utf8");
const exporters = readFileSync(join(root, "src/exporters.js"), "utf8");
const sw = readFileSync(join(root, "service-worker.js"), "utf8");
const manifest = readFileSync(join(root, "manifest.webmanifest"), "utf8");
const versionSource = readFileSync(join(root, "src/version.js"), "utf8");
const packageJson = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const sql = readFileSync(join(root, "supabase/migrations/202608030001_requisitions.sql"), "utf8");
const allText = collectText(root);

assert.ok(index.includes("Dicte los productos"));
assert.ok(index.includes("Agregar texto"));
assert.equal(index.includes("Revisar pedido"), false);
assert.ok(index.includes("Responsable del pedido"));
assert.ok(index.includes("Iniciar sesión"));
assert.ok(index.includes("Mi perfil"));
assert.ok(index.includes("Organización y accesos"));
assert.ok(app.includes("SpeechRecognition") && app.includes("es-CR"));
assert.ok(app.includes("describeSpeechError"));
assert.ok(app.includes("recognition.continuous = true"));
assert.ok(app.includes("dictationDeadline = Date.now() + 45000"));
assert.ok(app.includes("appendFinalSpeechSegment"));
assert.equal(app.includes("finalText || interimText"), false);
assert.ok(app.includes("validateRequisition"));
assert.ok(app.includes("downloadExcel"));
assert.ok(app.includes("autoSaveOrder"));
assert.ok(app.includes("verifySupabaseConnection"));
assert.ok(app.includes("fetchRequisitionsFromSupabase"));
assert.ok(index.includes("data-new-order"));
assert.ok(index.includes("Sincronizar automáticamente"));
assert.ok(index.includes("Subir local"));
assert.ok(index.includes("Descargar nube"));
assert.ok(index.includes("Hay una nueva versión disponible."));
assert.ok(index.includes("Instalar aplicación"));
assert.ok(index.includes('aria-live="polite"'));
assert.ok(app.includes("performSupabaseDownload"));
assert.ok(app.includes("state.settings.supabase.autoSync"));
assert.ok(app.includes("accept-review"));
assert.ok(app.includes("Número ajustado automáticamente"));
assert.ok(readFileSync(join(root, "src/supabase.js"), "utf8").includes("makeConflictSafeRequisitionNumber"));
assert.ok(app.includes("Aceptar línea"));
assert.ok(exporters.includes("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"));
assert.ok(exporters.includes("autoFilter"));
assert.ok(exporters.includes('"Unidad de compra"'));
assert.equal(exporters.includes("noopener"), false);
assert.ok(sw.includes("requestUrl.origin !== self.location.origin"));
assert.ok(sw.includes('searchParams.get("v")'));
assert.ok(sw.includes("SKIP_WAITING"));
const installBlock = sw.match(/self\.addEventListener\("install"[\s\S]+?\n}\);/)?.[0] || "";
assert.equal(installBlock.includes("skipWaiting"), false);
assert.ok(app.includes(`from "./version.js?v=${packageJson.version}"`));
assert.ok(app.includes("beforeinstallprompt"));
assert.ok(app.includes("registration.waiting"));
assert.ok(sw.includes("catalog-data.js"));
assert.ok(sw.includes("db/indexeddb.js"));
assert.ok(sw.includes("db/migrate-v10.js"));
assert.ok(sw.includes("vendor/supabase.js"));
assert.ok(app.includes("restoreSession"));
assert.ok(app.includes("setStorageContext"));
assert.ok(index.includes("Almacenamiento local"));
assert.ok(app.includes("Error al guardar"));
assert.ok(sql.includes("enable row level security"));
assert.ok(sql.includes("requisitions"));
assert.equal(/sb_secret_[A-Za-z0-9_-]+|service_role\s*[:=]\s*[A-Za-z0-9_-]+/.test(allText), false);

const versionMatch = versionSource.match(/APP_VERSION = "([^"]+)"/);
assert.ok(versionMatch, "No se encontro APP_VERSION");
assert.equal(versionMatch[1], packageJson.version);
assert.ok(index.includes(`?v=${packageJson.version}`));
assert.ok(manifest.includes(`?v=${packageJson.version}`));

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
