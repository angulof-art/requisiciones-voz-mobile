import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright-core";

const appUrl = process.env.APP_URL || "http://127.0.0.1:4177/";
const requesterEmail = process.env.QA_REQUESTER_EMAIL;
const receiverEmail = process.env.QA_RECEIVER_EMAIL;
const password = process.env.QA_PASSWORD;
const chromePath = process.env.CHROME_PATH || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";

if (!requesterEmail || !receiverEmail || !password) {
  throw new Error("Faltan QA_REQUESTER_EMAIL, QA_RECEIVER_EMAIL o QA_PASSWORD.");
}

const profileDir = await mkdtemp(join(tmpdir(), "pedidos-voz-final-audit-"));
let context;

async function login(page, email) {
  const networkFailures = [];
  const consoleErrors = [];
  const responseIssues = [];
  const supabaseResponses = [];
  page.on("requestfailed", (request) => networkFailures.push(`${request.method()} ${request.url()} ${request.failure()?.errorText || ""}`));
  page.on("response", (response) => {
    if (response.url().includes("supabase.co")) supabaseResponses.push(`${response.status()} ${response.request().method()} ${response.url()}`);
    if (response.status() >= 400) responseIssues.push(`${response.status()} ${response.request().method()} ${response.url()}`);
  });
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await page.waitForFunction(() => {
      const status = document.querySelector("#authStatus")?.textContent || "";
      return /Ingrese|Sin conexión/.test(status) && !document.querySelector("#loginButton")?.disabled;
    }, { timeout: 20_000 });
    await page.locator("#loginEmail").fill(email);
    await page.locator("#loginPassword").fill(password);
    await page.locator("#loginForm").evaluate((form) => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    try {
      await page.locator("#appShell").waitFor({ state: "visible", timeout: 20_000 });
      return;
    } catch (error) {
      const loginError = (await page.locator("#loginError").textContent())?.trim();
      if (attempt < 2 && (!loginError || loginError.startsWith("No se pudo cargar"))) {
        await page.reload({ waitUntil: "domcontentloaded" });
        continue;
      }
      const authStatus = (await page.locator("#authStatus").textContent())?.trim();
      const buttonState = await page.locator("#loginButton").isDisabled() ? "loginButton=disabled" : "loginButton=enabled";
      const diagnostics = [loginError || authStatus || error.message, buttonState, ...networkFailures, ...responseIssues, ...supabaseResponses, ...consoleErrors]
        .filter(Boolean)
        .join(" | ");
      throw new Error(`No se pudo iniciar sesión: ${diagnostics}`);
    }
  }
}

async function logout(page) {
  await page.locator('[data-target="profile"]').click();
  await page.locator("#logoutButton").click();
  await page.locator("#authGate").waitFor({ state: "visible", timeout: 15_000 });
}

async function getOrderSnapshot(page) {
  return {
    number: (await page.locator("#requisitionNumber").textContent())?.trim(),
    itemCount: Number(await page.locator("#itemCount").textContent()),
    products: await page.locator('#itemsList [data-field="productName"]').evaluateAll((nodes) => nodes.map((node) => node.value)),
    quantities: await page.locator('#itemsList [data-field="quantity"]').evaluateAll((nodes) => nodes.map((node) => node.value)),
    units: await page.locator('#itemsList [data-field="unit"]').evaluateAll((nodes) => nodes.map((node) => node.value)),
    pending: (await page.locator("#autosaveState").textContent())?.trim()
  };
}

try {
  context = await chromium.launchPersistentContext(profileDir, {
    executablePath: chromePath,
    headless: true,
    viewport: { width: 390, height: 844 }
  });
  let page = context.pages()[0] || await context.newPage();
  await page.goto(appUrl, { waitUntil: "domcontentloaded" });
  await login(page, requesterEmail);
  await page.evaluate(() => navigator.serviceWorker?.ready);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.locator("#appShell").waitFor({ state: "visible" });

  await page.locator("#destinationDepartment").selectOption({ label: "Bodega" });
  await page.waitForTimeout(600);
  await context.setOffline(true);
  await page.locator("#transcriptInput").fill("2 kg de tomate, 3 unidades de lechuga");
  await page.locator("#processTranscriptButton").click();
  await page.locator("#itemCount").waitFor({ state: "visible" });
  await page.waitForFunction(() => document.querySelector("#itemCount")?.textContent === "2");
  await page.locator('#itemsList [data-field="quantity"]').first().fill("4");
  await page.locator('#itemsList [data-field="quantity"]').first().blur();
  await page.waitForTimeout(1_200);
  await page.locator('[data-target="favorites"]').click();
  await page.locator("#saveTemplateButton").click();
  await page.locator('[data-target="new"]').click();
  const offlineBeforeClose = await getOrderSnapshot(page);
  await page.close();

  page = await context.newPage();
  const reconnectIssues = [];
  page.on("requestfailed", (request) => reconnectIssues.push(`${request.method()} ${request.url()} ${request.failure()?.errorText || ""}`));
  page.on("response", (response) => {
    if (response.status() >= 400) reconnectIssues.push(`${response.status()} ${response.request().method()} ${response.url()}`);
  });
  page.on("console", (message) => {
    if (message.type() === "error") reconnectIssues.push(message.text());
  });
  await page.goto(appUrl, { waitUntil: "domcontentloaded" });
  try {
    await page.locator("#appShell").waitFor({ state: "visible", timeout: 15_000 });
  } catch {
    const loginError = (await page.locator("#loginError").textContent())?.trim();
    const authStatus = (await page.locator("#authStatus").textContent())?.trim();
    throw new Error(`La sesión offline no se restauró: ${loginError || authStatus || "sin diagnóstico"}`);
  }
  const offlineAfterReopen = await getOrderSnapshot(page);
  if (JSON.stringify(offlineBeforeClose) !== JSON.stringify(offlineAfterReopen)) {
    throw new Error("El borrador offline cambió después de cerrar y reabrir.");
  }

  await context.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await page.locator('#itemsList [data-field="quantity"]').nth(1).fill("5");
  await page.locator('#itemsList [data-field="quantity"]').nth(1).blur();
  try {
    await page.waitForFunction(
      () => document.querySelector("#connectionBadge")?.textContent?.trim() === "Supabase" &&
        document.querySelector("#autosaveState")?.textContent?.trim() === "Sincronizado",
      null,
      { timeout: 45_000 }
    );
  } catch {
    throw new Error(
      `La reconexión no sincronizó: conexión=${(await page.locator("#connectionBadge").textContent())?.trim()}, ` +
      `guardado=${(await page.locator("#autosaveState").textContent())?.trim()} | ${reconnectIssues.join(" | ")}`
    );
  }
  const syncedRequester = await getOrderSnapshot(page);

  await logout(page);
  await login(page, receiverEmail);
  const receiverView = await getOrderSnapshot(page);
  const receiverFavoritesVisible = await page.locator('[data-target="favorites"]').isVisible();
  if (receiverView.number === syncedRequester.number || receiverView.itemCount !== 0 || receiverFavoritesVisible) {
    throw new Error(`El usuario receptor heredó datos privados del solicitante: ${JSON.stringify({ receiverView, syncedRequester, receiverFavoritesVisible })}`);
  }

  await logout(page);
  await login(page, requesterEmail);
  const restoredRequester = await getOrderSnapshot(page);
  await page.locator('[data-target="favorites"]').click();
  const requesterFavoriteText = (await page.locator("#favoritesList").textContent()) || "";
  if (restoredRequester.number !== syncedRequester.number || restoredRequester.quantities.join(",") !== "4,5") {
    throw new Error("El solicitante no recuperó su borrador aislado.");
  }
  if (!/Tomate/i.test(requesterFavoriteText) || !/Lechuga/i.test(requesterFavoriteText)) {
    throw new Error("El solicitante no recuperó sus favoritos aislados.");
  }

  const viewportChecks = [];
  for (const width of [320, 360, 390, 768, 1280]) {
    await page.setViewportSize({ width, height: width < 768 ? 844 : 900 });
    for (const target of ["new", "history", "favorites", "profile"]) {
      await page.locator(`[data-target="${target}"]`).click();
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      if (overflow > 1) throw new Error(`Overflow horizontal de ${overflow}px en ${target} a ${width}px.`);
    }
    viewportChecks.push(width);
  }

  await page.locator('[data-target="new"]').click();
  const pdfPromise = page.waitForEvent("download");
  await page.locator("#exportPdfButton").click();
  const pdfDownload = await pdfPromise;
  const pdfBytes = await readFile(await pdfDownload.path());
  if (!pdfDownload.suggestedFilename().endsWith(".pdf") || pdfBytes.subarray(0, 4).toString() !== "%PDF") {
    throw new Error("La exportación PDF no produjo un archivo PDF válido.");
  }

  const excelPromise = page.waitForEvent("download");
  await page.locator("#exportCsvButton").click();
  const excelDownload = await excelPromise;
  const excelBytes = await readFile(await excelDownload.path());
  if (!excelDownload.suggestedFilename().endsWith(".xlsx") || excelBytes.subarray(0, 2).toString() !== "PK") {
    throw new Error("La exportación Excel no produjo un archivo XLSX válido.");
  }

  await page.evaluate(() => {
    Object.defineProperty(navigator, "share", {
      configurable: true,
      value: async (payload) => { window.__finalAuditShare = payload; }
    });
  });
  await page.locator("#shareButton").click();
  await page.waitForFunction(() => Boolean(window.__finalAuditShare?.text));
  const sharedText = await page.evaluate(() => window.__finalAuditShare.text);
  if (!sharedText.includes(restoredRequester.number)) throw new Error("Compartir no incluyó el número del pedido.");

  console.log(JSON.stringify({
    result: "PASS",
    offlineReopen: true,
    synchronized: true,
    crossUserIsolation: true,
    requisitionNumber: restoredRequester.number,
    products: restoredRequester.products,
    quantities: restoredRequester.quantities,
    units: restoredRequester.units,
    viewportChecks,
    exports: [pdfDownload.suggestedFilename(), excelDownload.suggestedFilename(), "share"]
  }, null, 2));
} finally {
  await context?.close();
  await rm(profileDir, { recursive: true, force: true });
}
