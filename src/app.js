import {
  catalogFromCsv,
  normalizeCatalogProduct,
  parseList,
  unitOptions
} from "./catalog.js?v=7";
import { downloadExcel, printPdf } from "./exporters.js?v=7";
import { parseRequisitionText } from "./parser.js?v=7";
import {
  STATUS,
  addChange,
  clone,
  combineDuplicateItems,
  createId,
  createRequisition,
  findDuplicateGroups,
  formatDateParts,
  markConfirmed,
  markExported,
  markVoided,
  normalizeItem,
  validateRequisition,
  validateRequisitionItem
} from "./requisitions.js?v=7";
import {
  clearCurrentRequisition,
  loadAppState,
  queueSyncChange,
  rememberName,
  saveCatalog,
  saveCurrentRequisition,
  saveRequisitions,
  saveSettings,
  saveSyncQueue,
  upsertRequisition
} from "./storage.js?v=7";
import {
  classifySupabaseError,
  isSupabaseReady,
  normalizeSupabaseUrl,
  syncAllToSupabase,
  testSupabase,
  validatePublishableKey
} from "./supabase.js?v=7";

const state = loadAppState();
const undoStack = [];
let recognition = null;
let isListening = false;
let replaceIndex = null;
let speechSessionBaseText = "";
let speechSessionFinalText = "";
let autoSaveTimer = null;
let autoSyncTimer = null;
let supabaseConnectionState = "checking";

const els = {
  screenTitle: document.querySelector("#screenTitle"),
  connectionBadge: document.querySelector("#connectionBadge"),
  screens: document.querySelectorAll(".screen"),
  navButtons: document.querySelectorAll(".bottom-nav button"),
  requestedBy: document.querySelector("#requestedBy"),
  responsibleError: document.querySelector("#responsibleError"),
  recentNames: document.querySelector("#recentNames"),
  voiceButton: document.querySelector("#voiceButton"),
  voicePrimary: document.querySelector("#voicePrimary"),
  voiceSecondary: document.querySelector("#voiceSecondary"),
  transcriptInput: document.querySelector("#transcriptInput"),
  speechStatus: document.querySelector("#speechStatus"),
  processTranscriptButton: document.querySelector("#processTranscriptButton"),
  lastTranscript: document.querySelector("#lastTranscript"),
  autosaveState: document.querySelector("#autosaveState"),
  itemCount: document.querySelector("#itemCount"),
  requisitionNumber: document.querySelector("#requisitionNumber"),
  statusBadge: document.querySelector("#statusBadge"),
  addRowButton: document.querySelector("#addRowButton"),
  undoButton: document.querySelector("#undoButton"),
  combineDuplicatesButton: document.querySelector("#combineDuplicatesButton"),
  duplicateBanner: document.querySelector("#duplicateBanner"),
  duplicateText: document.querySelector("#duplicateText"),
  confirmCombineButton: document.querySelector("#confirmCombineButton"),
  keepDuplicatesButton: document.querySelector("#keepDuplicatesButton"),
  itemsList: document.querySelector("#itemsList"),
  itemsEmpty: document.querySelector("#itemsEmpty"),
  validationList: document.querySelector("#validationList"),
  confirmButton: document.querySelector("#confirmButton"),
  exportPdfButton: document.querySelector("#exportPdfButton"),
  exportCsvButton: document.querySelector("#exportCsvButton"),
  newOrderButton: document.querySelector("#newOrderButton"),
  historySearch: document.querySelector("#historySearch"),
  historyStatus: document.querySelector("#historyStatus"),
  historyDate: document.querySelector("#historyDate"),
  historyList: document.querySelector("#historyList"),
  historyEmpty: document.querySelector("#historyEmpty"),
  catalogImport: document.querySelector("#catalogImport"),
  catalogSearch: document.querySelector("#catalogSearch"),
  catalogStatus: document.querySelector("#catalogStatus"),
  catalogForm: document.querySelector("#catalogForm"),
  catalogId: document.querySelector("#catalogId"),
  catalogCode: document.querySelector("#catalogCode"),
  catalogName: document.querySelector("#catalogName"),
  catalogCategoryInput: document.querySelector("#catalogCategoryInput"),
  catalogDefaultUnit: document.querySelector("#catalogDefaultUnit"),
  catalogAllowedUnits: document.querySelector("#catalogAllowedUnits"),
  catalogSynonyms: document.querySelector("#catalogSynonyms"),
  catalogActive: document.querySelector("#catalogActive"),
  resetCatalogForm: document.querySelector("#resetCatalogForm"),
  catalogList: document.querySelector("#catalogList"),
  hourFormat: document.querySelector("#hourFormat"),
  textSize: document.querySelector("#textSize"),
  supabaseUrl: document.querySelector("#supabaseUrl"),
  supabaseKey: document.querySelector("#supabaseKey"),
  supabaseWorkspace: document.querySelector("#supabaseWorkspace"),
  supabaseEnabled: document.querySelector("#supabaseEnabled"),
  saveSupabaseButton: document.querySelector("#saveSupabaseButton"),
  syncNowButton: document.querySelector("#syncNowButton"),
  supabaseMessage: document.querySelector("#supabaseMessage"),
  supabaseTechnical: document.querySelector("#supabaseTechnical"),
  networkState: document.querySelector("#networkState"),
  localCount: document.querySelector("#localCount"),
  pendingCount: document.querySelector("#pendingCount"),
  lastSync: document.querySelector("#lastSync"),
  syncQueueList: document.querySelector("#syncQueueList"),
  toast: document.querySelector("#toast")
};

boot();

function boot() {
  populateUnitSelects();
  setupSpeechRecognition();
  bindEvents();
  applySettingsToForm();
  render();
  registerServiceWorker();
  verifySupabaseConnection();
}

function bindEvents() {
  els.navButtons.forEach((button) => {
    button.addEventListener("click", () => navigate(button.dataset.target));
  });

  els.requestedBy.addEventListener("input", () => {
    state.current.requestedBy = els.requestedBy.value;
    saveCurrentRequisition(state.current);
    renderResponsibleState();
    scheduleAutoSave();
  });

  els.voiceButton.addEventListener("click", toggleSpeech);
  els.processTranscriptButton.addEventListener("click", processTranscript);
  els.addRowButton.addEventListener("click", addManualRow);
  els.undoButton.addEventListener("click", undoLast);
  els.combineDuplicatesButton.addEventListener("click", showDuplicateSuggestion);
  els.confirmCombineButton.addEventListener("click", combineDuplicates);
  els.keepDuplicatesButton.addEventListener("click", () => {
    els.duplicateBanner.hidden = true;
    toast("Se conservaron los registros separados.");
  });
  els.confirmButton.addEventListener("click", confirmOrder);
  els.exportPdfButton.addEventListener("click", exportPdf);
  els.exportCsvButton.addEventListener("click", exportCsv);
  els.newOrderButton.addEventListener("click", startNewOrder);

  ["input", "change"].forEach((eventName) => {
    els.itemsList.addEventListener(eventName, handleItemEdit);
  });
  els.itemsList.addEventListener("click", handleItemAction);

  [els.historySearch, els.historyStatus, els.historyDate].forEach((input) => {
    input.addEventListener("input", renderHistory);
    input.addEventListener("change", renderHistory);
  });
  els.historyList.addEventListener("click", handleHistoryAction);

  els.catalogForm.addEventListener("submit", saveCatalogProduct);
  els.resetCatalogForm.addEventListener("click", resetCatalogForm);
  els.catalogImport.addEventListener("change", importCatalog);
  [els.catalogSearch, els.catalogStatus].forEach((input) => {
    input.addEventListener("input", renderCatalog);
    input.addEventListener("change", renderCatalog);
  });
  els.catalogList.addEventListener("click", handleCatalogAction);

  els.hourFormat.addEventListener("change", saveUiSettings);
  els.textSize.addEventListener("change", saveUiSettings);
  els.saveSupabaseButton.addEventListener("click", saveSupabaseSettingsFromForm);
  els.syncNowButton.addEventListener("click", syncNow);

  window.addEventListener("online", () => {
    supabaseConnectionState = "checking";
    renderConnection();
    verifySupabaseConnection();
  });
  window.addEventListener("offline", () => {
    supabaseConnectionState = "offline";
    renderConnection();
  });
}

function navigate(target) {
  els.screens.forEach((screen) => screen.classList.toggle("active", screen.dataset.screen === target));
  els.navButtons.forEach((button) => button.classList.toggle("active", button.dataset.target === target));
  const titles = {
    new: "Nuevo pedido",
    history: "Historial",
    catalog: "Catálogo",
    config: "Configuración",
    sync: "Estado"
  };
  els.screenTitle.textContent = titles[target] || "Pedidos por Voz";
  if (target === "history") renderHistory();
  if (target === "catalog") renderCatalog();
  if (target === "sync") renderSync();
}

function processTranscript(textOverride = null) {
  const hasTextOverride = typeof textOverride === "string";
  const text = (hasTextOverride ? textOverride : els.transcriptInput.value).trim();
  if (!text) {
    toast("No hay texto para procesar.");
    return;
  }
  const parsed = parseRequisitionText(text, state.catalog);
  state.current.originalTranscript = [state.current.originalTranscript, parsed.originalText]
    .filter(Boolean)
    .join("\n");

  if (parsed.command && ["remove", "change", "remove-last"].includes(parsed.command.type)) {
    toast("Orden avanzada detectada. Revise y aplique el cambio manualmente.");
    if (parsed.command.type === "remove-last") return;
  }

  if (!parsed.items.length) {
    toast("No pude identificar productos. Revise la transcripción.");
    return;
  }

  pushUndo();
  if (replaceIndex !== null && parsed.items.length === 1) {
    state.current.items[replaceIndex] = normalizeItem(parsed.items[0]);
    replaceIndex = null;
  } else {
    state.current.items.push(...parsed.items.map(normalizeItem));
  }
  addChange(state.current, "dictado", null, parsed.items);
  els.lastTranscript.textContent = `Último dictado: ${parsed.originalText}`;
  els.lastTranscript.hidden = false;
  els.transcriptInput.value = "";
  autoSaveOrder();
  renderSummary();
  renderItems();
  showDuplicateSuggestion(true);
  toast(`${parsed.items.length} ${parsed.items.length === 1 ? "producto agregado" : "productos agregados"}.`);
}

function addManualRow() {
  pushUndo();
  state.current.items.push(
    normalizeItem({
      id: createId("item"),
      productName: "",
      quantity: 1,
      unit: "und",
      notes: "",
      needsReview: true,
      confidence: 0
    })
  );
  addChange(state.current, "agregar_manual", null, state.current.items.at(-1));
  autoSaveOrder();
  render();
}

function handleItemEdit(event) {
  const input = event.target.closest("[data-field]");
  if (!input) return;
  const card = input.closest("[data-id]");
  const item = state.current.items.find((entry) => entry.id === card.dataset.id);
  if (!item) return;
  const field = input.dataset.field;
  if (field === "quantity") item.quantity = Number(input.value);
  else if (field === "needsReview" || field === "unitOverride") item[field] = input.checked;
  else item[field] = input.value;
  if (field === "productName") item.needsReview = true;
  if (field === "unit") item.unitAllowed = true;
  item.confidence = item.needsReview ? Math.min(item.confidence || 0, 69) : Math.max(item.confidence || 85, 85);
  state.current.updatedAt = new Date().toISOString();
  persistCurrent();
  renderSummary();
  renderValidation({ ok: true, errors: [], fieldErrors: {} });
  renderResponsibleState();
  scheduleAutoSave();
  if (field === "productName" && event.type === "change") renderItems();
}

function handleItemAction(event) {
  const button = event.target.closest("button[data-action]");
  if (!button) return;
  const card = button.closest("[data-id]");
  const index = state.current.items.findIndex((entry) => entry.id === card.dataset.id);
  if (index < 0) return;

  const item = state.current.items[index];
  if (button.dataset.action === "accept-review") {
    const errors = validateRequisitionItem(item, index);
    if (errors.length) {
      renderValidation({ ok: false, errors, fieldErrors: {} });
      renderResponsibleState();
      toast(errors[0]);
      return;
    }
    pushUndo();
    const previous = clone(item);
    item.productName = item.productName.trim();
    item.needsReview = false;
    item.unitOverride = item.unitAllowed === false ? true : item.unitOverride;
    item.confidence = Math.max(Number(item.confidence || 0), 85);
    addChange(state.current, "aceptar_linea", previous, item);
    autoSaveOrder();
    render();
    toast(`Línea ${index + 1} aceptada.`);
    return;
  }

  pushUndo();
  if (button.dataset.action === "delete") {
    state.current.items.splice(index, 1);
    addChange(state.current, "eliminar_linea", item, null);
  }
  if (button.dataset.action === "duplicate") {
    const copy = { ...clone(item), id: createId("item") };
    state.current.items.splice(index + 1, 0, copy);
    addChange(state.current, "duplicar_linea", item, copy);
  }
  if (button.dataset.action === "up" && index > 0) {
    [state.current.items[index - 1], state.current.items[index]] = [
      state.current.items[index],
      state.current.items[index - 1]
    ];
    addChange(state.current, "reordenar", null, state.current.items);
  }
  if (button.dataset.action === "down" && index < state.current.items.length - 1) {
    [state.current.items[index + 1], state.current.items[index]] = [
      state.current.items[index],
      state.current.items[index + 1]
    ];
    addChange(state.current, "reordenar", null, state.current.items);
  }
  if (button.dataset.action === "replace-voice") {
    replaceIndex = index;
    navigate("new");
    els.transcriptInput.value = "";
    toast(`Dicte de nuevo la línea ${index + 1}.`);
  }
  if (button.dataset.action === "suggestion") {
    item.productName = button.dataset.name;
    item.productCode = button.dataset.code;
    item.needsReview = false;
    item.confidence = 88;
    addChange(state.current, "seleccionar_sugerencia", null, item);
  }
  autoSaveOrder();
  render();
}

function confirmOrder() {
  state.current.requestedBy = els.requestedBy.value.trim();
  const validation = validateRequisition(state.current, state.catalog, "confirm");
  renderValidation(validation);
  if (!validation.ok) {
    toast(validation.errors[0]);
    return;
  }
  markConfirmed(state.current);
  saveOrderAndQueue();
  toast("Pedido confirmado correctamente.");
  render();
}

function exportPdf() {
  if (!validateBeforeExport()) return;
  try {
    printPdf(state.current, state.settings.hourFormat);
    markExported(state.current);
    saveOrderAndQueue();
    toast("PDF listo para imprimir o guardar.");
    render();
  } catch (error) {
    toast(error.message);
  }
}

function exportCsv() {
  if (!validateBeforeExport()) return;
  downloadExcel(state.current, state.catalog, state.settings.hourFormat);
  markExported(state.current);
  saveOrderAndQueue();
  toast("Archivo Excel generado.");
  render();
}

function validateBeforeExport() {
  state.current.requestedBy = els.requestedBy.value.trim();
  const validation = validateRequisition(state.current, state.catalog, "confirm");
  renderValidation(validation);
  if (!validation.ok) {
    toast(validation.errors[0]);
    return false;
  }
  return true;
}

function showDuplicateSuggestion(silent = false) {
  const [group] = findDuplicateGroups(state.current.items);
  if (!group) {
    els.duplicateBanner.hidden = true;
    if (!silent) toast("No hay productos repetidos para combinar.");
    return;
  }
  const total = group.reduce((sum, item) => sum + Number(item.quantity || 0), 0);
  els.duplicateText.textContent = `Se encontraron productos repetidos. ¿Desea combinarlos en ${total} ${group[0].unit}?`;
  els.duplicateBanner.hidden = false;
}

function combineDuplicates() {
  pushUndo();
  combineDuplicateItems(state.current);
  autoSaveOrder();
  els.duplicateBanner.hidden = true;
  render();
  toast("Productos repetidos combinados.");
}

function undoLast() {
  const previous = undoStack.pop();
  if (!previous) {
    toast("No hay acciones para deshacer.");
    return;
  }
  state.current = previous;
  autoSaveOrder();
  render();
  toast("Última acción deshecha.");
}

function pushUndo() {
  undoStack.push(clone(state.current));
  if (undoStack.length > 30) undoStack.shift();
}

function saveOrderAndQueue() {
  state.current.requestedBy = els.requestedBy.value.trim();
  state.recentNames = rememberName(state.current.requestedBy);
  state.requisitions = upsertRequisition(state.current);
  state.syncQueue = queueSyncChange("requisition", { id: state.current.id });
  persistCurrent();
  render();
  scheduleAutoSync();
}

function autoSaveOrder() {
  state.current.requestedBy = els.requestedBy.value.trim();
  state.current.updatedAt = new Date().toISOString();
  if (!["confirmed", "exported", "voided"].includes(state.current.status)) {
    state.current.status = state.current.items.some((item) => item.needsReview) ? "review" : "draft";
  }
  state.requisitions = upsertRequisition(state.current);
  state.syncQueue = queueSyncChange("requisition", { id: state.current.id });
  persistCurrent();
  els.autosaveState.textContent = navigator.onLine ? "Guardando..." : "Guardado local";
  els.autosaveState.classList.remove("synced");
  scheduleAutoSync();
}

function scheduleAutoSave() {
  window.clearTimeout(autoSaveTimer);
  autoSaveTimer = window.setTimeout(() => {
    if (state.current.items.length) autoSaveOrder();
    else persistCurrent();
  }, 450);
}

function scheduleAutoSync() {
  if (!navigator.onLine || !isSupabaseReady(state.settings.supabase)) return;
  window.clearTimeout(autoSyncTimer);
  autoSyncTimer = window.setTimeout(() => performSupabaseSync(true), 900);
}

function startNewOrder() {
  if (state.current.items.length && !window.confirm("¿Descartar el pedido actual y crear uno nuevo?")) {
    return;
  }
  clearCurrentRequisition();
  state.current = createRequisition(state.requisitions);
  els.transcriptInput.value = "";
  els.lastTranscript.hidden = true;
  persistCurrent();
  render();
  navigate("new");
}

function importCatalog(event) {
  const [file] = event.target.files || [];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    const imported = catalogFromCsv(String(reader.result || ""));
    if (!imported.length) {
      toast("No se encontraron productos en el catálogo.");
      return;
    }
    const byCode = new Map(state.catalog.map((product) => [product.code || product.id, product]));
    for (const product of imported) byCode.set(product.code || product.id, product);
    state.catalog = [...byCode.values()];
    saveCatalog(state.catalog);
    state.syncQueue = queueSyncChange("catalog", { count: imported.length });
    renderCatalog();
    toast(`${imported.length} productos importados.`);
    event.target.value = "";
  };
  reader.readAsText(file, "utf-8");
}

function saveCatalogProduct(event) {
  event.preventDefault();
  const product = normalizeCatalogProduct({
    id: els.catalogId.value || "",
    code: els.catalogCode.value,
    officialName: els.catalogName.value,
    category: els.catalogCategoryInput.value,
    defaultUnit: els.catalogDefaultUnit.value,
    allowedUnits: els.catalogAllowedUnits.value,
    synonyms: els.catalogSynonyms.value,
    active: els.catalogActive.checked
  });
  const index = state.catalog.findIndex((entry) => entry.id === product.id || entry.code === product.code);
  if (index >= 0) state.catalog[index] = product;
  else state.catalog.push(product);
  saveCatalog(state.catalog);
  state.syncQueue = queueSyncChange("catalog", { id: product.id });
  resetCatalogForm();
  renderCatalog();
  toast("Producto guardado en catálogo.");
}

function resetCatalogForm() {
  els.catalogForm.reset();
  els.catalogId.value = "";
  els.catalogDefaultUnit.value = "und";
  els.catalogActive.checked = true;
}

function handleCatalogAction(event) {
  const button = event.target.closest("button[data-action]");
  if (!button) return;
  const product = state.catalog.find((entry) => entry.id === button.dataset.id);
  if (!product) return;
  if (button.dataset.action === "edit") {
    els.catalogId.value = product.id;
    els.catalogCode.value = product.code;
    els.catalogName.value = product.officialName;
    els.catalogCategoryInput.value = product.category;
    els.catalogDefaultUnit.value = product.defaultUnit;
    els.catalogAllowedUnits.value = product.allowedUnits.join(",");
    els.catalogSynonyms.value = product.synonyms.join(", ");
    els.catalogActive.checked = product.active !== false;
  }
  if (button.dataset.action === "toggle") {
    product.active = !product.active;
    product.updatedAt = new Date().toISOString();
    saveCatalog(state.catalog);
    renderCatalog();
  }
}

function handleHistoryAction(event) {
  const button = event.target.closest("button[data-action]");
  if (!button) return;
  const requisition = state.requisitions.find((entry) => entry.id === button.dataset.id);
  if (!requisition) return;
  if (button.dataset.action === "open") {
    state.current = clone(requisition);
    els.transcriptInput.value = state.current.originalTranscript || "";
    persistCurrent();
    render();
    navigate("new");
  }
  if (button.dataset.action === "duplicate") {
    const copy = createRequisition(state.requisitions);
    copy.requestedBy = requisition.requestedBy;
    copy.items = requisition.items.map((item) => ({ ...clone(item), id: createId("item") }));
    copy.originalTranscript = requisition.originalTranscript;
    addChange(copy, "duplicar_pedido", requisition, copy);
    state.current = copy;
    persistCurrent();
    render();
    navigate("new");
    toast("Pedido duplicado como borrador.");
  }
  if (button.dataset.action === "void") {
    if (!window.confirm("¿Anular este pedido sin eliminarlo definitivamente?")) return;
    markVoided(requisition);
    state.requisitions = upsertRequisition(requisition);
    renderHistory();
    toast("Pedido anulado.");
  }
}

function saveUiSettings() {
  state.settings.hourFormat = els.hourFormat.value;
  state.settings.textSize = els.textSize.value;
  saveSettings(state.settings);
  document.body.classList.toggle("text-large", state.settings.textSize === "large");
  render();
}

function applySettingsToForm() {
  els.hourFormat.value = state.settings.hourFormat || "24";
  els.textSize.value = state.settings.textSize || "normal";
  document.body.classList.toggle("text-large", state.settings.textSize === "large");
  els.supabaseUrl.value = state.settings.supabase.url || "";
  els.supabaseWorkspace.value = state.settings.supabase.workspaceId || "main";
  els.supabaseEnabled.checked = Boolean(state.settings.supabase.enabled);
}

function saveSupabaseSettingsFromForm() {
  const url = normalizeSupabaseUrl(els.supabaseUrl.value);
  const publishableKey = els.supabaseKey.value.trim() || state.settings.supabase.publishableKey || "";
  const validation = validatePublishableKey(publishableKey);
  if (els.supabaseEnabled.checked && (!url || !validation.ok)) {
    renderSupabaseMessage(validation.message || "Falta la URL de Supabase.", validation.technical);
    toast(validation.message || "Revise la conexión Supabase.");
    return;
  }
  state.settings.supabase = {
    url,
    publishableKey: validation.ok ? publishableKey : "",
    workspaceId: els.supabaseWorkspace.value.trim() || "main",
    enabled: els.supabaseEnabled.checked && validation.ok && Boolean(url),
    lastSyncAt: state.settings.supabase.lastSyncAt || ""
  };
  saveSettings(state.settings);
  renderSupabaseMessage(state.settings.supabase.enabled ? "Conexión guardada." : "Supabase desactivado.");
  renderConnection();
}

async function syncNow() {
  saveSupabaseSettingsFromForm();
  if (!isSupabaseReady(state.settings.supabase)) return;
  await performSupabaseSync(false);
}

async function verifySupabaseConnection() {
  if (!navigator.onLine) {
    supabaseConnectionState = "offline";
    renderConnection();
    return;
  }
  if (!isSupabaseReady(state.settings.supabase)) {
    supabaseConnectionState = "error";
    renderSupabaseMessage("Supabase no está configurado.");
    renderConnection();
    return;
  }
  try {
    supabaseConnectionState = "checking";
    renderConnection();
    await testSupabase(state.settings.supabase);
    supabaseConnectionState = "connected";
    renderSupabaseMessage("Conectado con Supabase.");
    renderConnection();
    if (state.syncQueue.length) scheduleAutoSync();
  } catch (error) {
    supabaseConnectionState = "error";
    const classified = classifySupabaseError(error);
    renderSupabaseMessage(`${classified.label}: ${classified.message}`, classified.technical);
    renderConnection();
  }
}

async function performSupabaseSync(silent = false) {
  if (!navigator.onLine || !isSupabaseReady(state.settings.supabase)) return;
  try {
    if (!silent) renderSupabaseMessage("Sincronizando...");
    await testSupabase(state.settings.supabase);
    const syncResult = await syncAllToSupabase(
      state.settings.supabase,
      state.requisitions,
      state.catalog
    );
    if (syncResult.renames.length) {
      const currentRename = syncResult.renames.find((rename) => rename.id === state.current.id);
      if (currentRename) state.current.requisitionNumber = currentRename.requisitionNumber;
      saveRequisitions(state.requisitions);
      persistCurrent();
    }
    state.settings.supabase.lastSyncAt = new Date().toISOString();
    state.syncQueue = [];
    saveSyncQueue([]);
    saveSettings(state.settings);
    supabaseConnectionState = "connected";
    els.autosaveState.textContent = "Sincronizado";
    els.autosaveState.classList.add("synced");
    const adjustedNumber = syncResult.renames.at(-1)?.requisitionNumber;
    renderSupabaseMessage(
      adjustedNumber
        ? `Sincronizado. Número ajustado automáticamente: ${adjustedNumber}.`
        : "Sincronizado con Supabase."
    );
    render();
  } catch (error) {
    supabaseConnectionState = "error";
    const classified = classifySupabaseError(error);
    renderSupabaseMessage(`${classified.label}: ${classified.message}`, classified.technical);
    if (!silent) toast(classified.message);
    renderConnection();
  }
}

function setupSpeechRecognition() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    els.voiceButton.disabled = true;
    els.voicePrimary.textContent = "Voz no disponible";
    els.voiceSecondary.textContent = "Escriba el pedido manualmente";
    els.speechStatus.textContent = "Este navegador no admite reconocimiento de voz.";
    return;
  }
  recognition = new SpeechRecognition();
  recognition.lang = "es-CR";
  recognition.continuous = false;
  recognition.interimResults = true;
  recognition.onstart = () => {
    isListening = true;
    speechSessionBaseText = "";
    speechSessionFinalText = "";
    els.voiceButton.classList.add("listening");
    els.voiceButton.setAttribute("aria-pressed", "true");
    els.voicePrimary.textContent = "Escuchando";
    els.voiceSecondary.textContent = "Toque para detener";
    els.speechStatus.textContent = "Escuchando...";
  };
  recognition.onerror = (event) => {
    els.speechStatus.textContent = `Error de micrófono: ${event.error || "desconocido"}.`;
    stopSpeechUi();
  };
  recognition.onend = () => {
    stopSpeechUi();
  };
  recognition.onresult = (event) => {
    let finalText = "";
    let interimText = "";
    for (let index = event.resultIndex; index < event.results.length; index += 1) {
      const transcript = event.results[index][0].transcript;
      if (event.results[index].isFinal) finalText = [finalText, transcript].filter(Boolean).join(" ");
      else interimText = [interimText, transcript].filter(Boolean).join(" ");
    }
    if (finalText) {
      const newSegment = appendFinalSpeechSegment(finalText);
      els.speechStatus.textContent = newSegment ? "Procesando pedido..." : "Texto ya capturado.";
      if (newSegment) processTranscript(newSegment);
      return;
    }
    const preview = normalizeSpeechSegment(interimText);
    els.speechStatus.textContent = preview ? `Escuchando: ${preview.slice(0, 80)}` : "Escuchando...";
  };
}

function appendFinalSpeechSegment(segment) {
  const cleanSegment = normalizeSpeechSegment(segment);
  if (!cleanSegment) return "";
  const merged = mergeSpeechText(speechSessionFinalText, cleanSegment);
  speechSessionFinalText = merged.text;
  els.transcriptInput.value = [speechSessionBaseText, speechSessionFinalText].filter(Boolean).join(" ").trim();
  return stripLeadingConjunction(merged.addition);
}

function mergeSpeechText(existing, incoming) {
  const current = normalizeSpeechSegment(existing);
  const segment = normalizeSpeechSegment(incoming);
  if (!segment) return { text: current, addition: "" };
  if (!current) return { text: segment, addition: segment };

  const currentKey = speechKey(current);
  const segmentKey = speechKey(segment);
  if (currentKey.includes(segmentKey)) return { text: current, addition: "" };
  if (segmentKey.startsWith(currentKey)) {
    const addition = segment.slice(current.length).trim();
    return { text: segment, addition };
  }

  const currentTokens = current.split(/\s+/);
  const segmentTokens = segment.split(/\s+/);
  const currentTokenKeys = currentTokens.map(speechKey);
  const segmentTokenKeys = segmentTokens.map(speechKey);
  let overlap = 0;
  const limit = Math.min(currentTokens.length, segmentTokens.length);
  for (let size = 1; size <= limit; size += 1) {
    const left = currentTokenKeys.slice(currentTokenKeys.length - size).join(" ");
    const right = segmentTokenKeys.slice(0, size).join(" ");
    if (left === right) overlap = size;
  }

  const addition = segmentTokens.slice(overlap).join(" ").trim();
  return {
    text: [current, addition].filter(Boolean).join(" ").trim(),
    addition
  };
}

function normalizeSpeechSegment(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function speechKey(value) {
  return normalizeSpeechSegment(value).toLowerCase().replace(/[.,;:]+/g, "");
}

function stripLeadingConjunction(value) {
  return normalizeSpeechSegment(value).replace(/^(y|e)\s+/i, "");
}

function toggleSpeech() {
  if (!recognition) return;
  if (isListening) {
    recognition.stop();
  } else {
    try {
      els.transcriptInput.value = replaceIndex === null ? els.transcriptInput.value : "";
      recognition.start();
    } catch (error) {
      els.speechStatus.textContent = error.message;
    }
  }
}

function stopSpeechUi() {
  isListening = false;
  els.voiceButton.classList.remove("listening");
  els.voiceButton.setAttribute("aria-pressed", "false");
  els.voicePrimary.textContent = "Dictar";
  els.voiceSecondary.textContent = "Toque para hablar";
}

function render() {
  els.requestedBy.value = state.current.requestedBy || "";
  const previousTranscripts = String(state.current.originalTranscript || "")
    .split("\n")
    .filter(Boolean);
  els.lastTranscript.hidden = previousTranscripts.length === 0;
  els.lastTranscript.textContent = previousTranscripts.length
    ? `Último dictado: ${previousTranscripts.at(-1)}`
    : "";
  renderResponsibleState();
  renderSummary();
  renderItems();
  renderHistory();
  renderCatalog();
  renderConnection();
  renderRecentNames();
}

function renderSummary() {
  els.requisitionNumber.textContent = state.current.requisitionNumber;
  els.statusBadge.textContent = STATUS[state.current.status] || state.current.status;
  els.statusBadge.className = `state-badge ${state.current.status}`;
}

function renderResponsibleState() {
  const missing = !String(els.requestedBy.value || "").trim();
  els.responsibleError.textContent = missing
    ? "Ingrese el nombre de la persona responsable del pedido para continuar."
    : "";
}

function renderItems() {
  els.itemsList.innerHTML = "";
  els.itemCount.textContent = String(state.current.items.length);
  const units = unitOptions();
  state.current.items.forEach((item, index) => {
    const card = document.createElement("article");
    card.className = `item-card ${item.needsReview ? "review" : ""}`;
    card.dataset.id = item.id;
    const options = units
      .concat(units.includes(item.unit) || !item.unit ? [] : [item.unit])
      .map((unit) => `<option value="${escapeHtml(unit)}" ${unit === item.unit ? "selected" : ""}>${escapeHtml(unit)}</option>`)
      .join("");
    const suggestions = (item.suggestions || [])
      .map(
        (suggestion) =>
          `<button class="secondary" type="button" data-action="suggestion" data-code="${escapeHtml(suggestion.code)}" data-name="${escapeHtml(suggestion.name)}">${escapeHtml(suggestion.name)}</button>`
      )
      .join("");
    card.innerHTML = `
      <div class="item-header">
        <div class="item-title">Línea ${index + 1}</div>
        ${item.needsReview ? '<span class="state-badge">Revisar</span>' : ""}
      </div>
      <div class="item-grid">
        <label class="product-field">Producto <input data-field="productName" value="${escapeHtml(item.productName)}" /></label>
        <label>Cantidad <input data-field="quantity" type="number" min="0.001" step="0.001" value="${item.quantity ?? ""}" /></label>
        <label>Unidad de compra <select data-field="unit">${options}</select></label>
        ${item.notes ? `<label class="notes-field">Observaciones <input data-field="notes" value="${escapeHtml(item.notes)}" /></label>` : ""}
      </div>
      ${item.needsReview ? `<div class="review-callout">
        <p class="review-note">Revise esta línea antes de confirmar.</p>
        <button type="button" data-action="accept-review">Aceptar línea</button>
      </div>` : ""}
      ${item.unitAllowed === false ? `<label class="check-row">
        <input data-field="unitOverride" type="checkbox" ${item.unitOverride ? "checked" : ""} />
        <span>Autorizar unidad no habitual</span>
      </label>` : ""}
      ${suggestions ? `<div class="toolbar">${suggestions}</div>` : ""}
      <div class="card-actions">
        <button class="secondary" type="button" data-action="duplicate">Duplicar</button>
        <button class="secondary" type="button" data-action="replace-voice">Redictar</button>
        <button class="danger" type="button" data-action="delete">Eliminar</button>
      </div>
    `;
    els.itemsList.append(card);
  });
  els.itemsEmpty.classList.toggle("visible", state.current.items.length === 0);
}

function renderValidation(validation) {
  els.validationList.innerHTML = "";
  els.validationList.classList.toggle("visible", Boolean(validation.errors?.length));
  (validation.errors || []).forEach((error) => {
    const p = document.createElement("p");
    p.textContent = error;
    els.validationList.append(p);
  });
  els.responsibleError.textContent = validation.fieldErrors?.requestedBy || "";
}

function renderHistory() {
  const query = (els.historySearch.value || "").toLowerCase();
  const status = els.historyStatus.value;
  const date = els.historyDate.value;
  const rows = state.requisitions.filter((req) => {
    const created = formatDateParts(req.createdAt, state.settings.hourFormat);
    const isoDate = new Date(req.createdAt).toISOString().slice(0, 10);
    const matchesText = `${req.requisitionNumber} ${req.requestedBy}`.toLowerCase().includes(query);
    const matchesStatus = status === "all" || req.status === status;
    const matchesDate = !date || isoDate === date || created.date.split("/").reverse().join("-") === date;
    return matchesText && matchesStatus && matchesDate;
  });
  els.historyList.innerHTML = "";
  rows.forEach((req) => {
    const created = formatDateParts(req.createdAt, state.settings.hourFormat);
    const card = document.createElement("article");
    card.className = "history-card";
    card.innerHTML = `
      <div class="history-header">
        <div>
          <div class="history-title">${escapeHtml(req.requisitionNumber)}</div>
          <div class="meta-line">
            <span>${escapeHtml(req.requestedBy)}</span>
            <span>${created.date} ${created.time}</span>
            <span>${STATUS[req.status] || req.status}</span>
          </div>
        </div>
      </div>
      <div class="card-actions">
        <button type="button" data-action="open" data-id="${escapeHtml(req.id)}">Abrir</button>
        <button class="secondary" type="button" data-action="duplicate" data-id="${escapeHtml(req.id)}">Duplicar</button>
        <button class="danger" type="button" data-action="void" data-id="${escapeHtml(req.id)}">Anular</button>
      </div>
    `;
    els.historyList.append(card);
  });
  els.historyEmpty.classList.toggle("visible", rows.length === 0);
}

function renderCatalog() {
  const query = (els.catalogSearch.value || "").toLowerCase();
  const status = els.catalogStatus.value;
  els.catalogList.innerHTML = "";
  state.catalog
    .filter((product) => {
      const statusMatches =
        status === "all" ||
        (status === "active" && product.active !== false) ||
        (status === "inactive" && product.active === false);
      const text = `${product.code} ${product.officialName} ${product.category} ${(product.synonyms || []).join(" ")}`.toLowerCase();
      return statusMatches && (!query || text.includes(query));
    })
    .forEach((product) => {
      const card = document.createElement("article");
      card.className = "catalog-card";
      card.innerHTML = `
        <div class="catalog-header">
          <div>
            <div class="catalog-title">${escapeHtml(product.officialName)}</div>
            <div class="meta-line">
              <span>${escapeHtml(product.code)}</span>
              <span>${escapeHtml(product.defaultUnit)}</span>
              <span>${product.active === false ? "Inactivo" : "Activo"}</span>
            </div>
          </div>
        </div>
        <p class="hint">${escapeHtml((product.synonyms || []).join(", "))}</p>
        <div class="card-actions">
          <button class="secondary" type="button" data-action="edit" data-id="${escapeHtml(product.id)}">Editar</button>
          <button class="secondary" type="button" data-action="toggle" data-id="${escapeHtml(product.id)}">${product.active === false ? "Activar" : "Inactivar"}</button>
        </div>
      `;
      els.catalogList.append(card);
    });
}

function renderConnection() {
  const online = navigator.onLine;
  const labels = {
    connected: "Supabase",
    checking: "Conectando",
    error: "Sin sincronizar",
    offline: "Sin conexión"
  };
  const currentState = online ? supabaseConnectionState : "offline";
  els.connectionBadge.textContent = labels[currentState] || labels.error;
  els.connectionBadge.classList.toggle("online", currentState === "connected");
  els.connectionBadge.classList.toggle("error", currentState === "error");
  els.networkState.textContent = labels[currentState] || labels.error;
  els.localCount.textContent = String(state.requisitions.length);
  els.pendingCount.textContent = String(state.syncQueue.length);
  els.lastSync.textContent = state.settings.supabase.lastSyncAt
    ? `${formatDateParts(state.settings.supabase.lastSyncAt, state.settings.hourFormat).date} ${formatDateParts(state.settings.supabase.lastSyncAt, state.settings.hourFormat).time}`
    : "Nunca";
  renderSync();
}

function renderSync() {
  els.syncQueueList.innerHTML = "";
  state.syncQueue.slice(0, 20).forEach((entry) => {
    const card = document.createElement("article");
    card.className = "history-card";
    card.innerHTML = `
      <div class="history-title">${escapeHtml(entry.type)}</div>
      <div class="meta-line">
        <span>${escapeHtml(entry.status)}</span>
        <span>${formatDateParts(entry.createdAt, state.settings.hourFormat).date}</span>
      </div>
    `;
    els.syncQueueList.append(card);
  });
}

function renderRecentNames() {
  els.recentNames.innerHTML = state.recentNames
    .map((name) => `<option value="${escapeHtml(name)}"></option>`)
    .join("");
}

function renderSupabaseMessage(message, technical = "") {
  els.supabaseMessage.textContent = message;
  els.supabaseTechnical.hidden = !technical;
  els.supabaseTechnical.textContent = technical || "";
}

function populateUnitSelects() {
  const options = unitOptions().map((unit) => `<option value="${unit}">${unit}</option>`).join("");
  els.catalogDefaultUnit.innerHTML = options;
  els.catalogDefaultUnit.value = "und";
}

function persistCurrent() {
  saveCurrentRequisition(state.current);
}

function toast(message) {
  els.toast.textContent = message;
  els.toast.classList.add("visible");
  window.clearTimeout(toast.timer);
  toast.timer = window.setTimeout(() => els.toast.classList.remove("visible"), 3200);
}

function registerServiceWorker() {
  if ("serviceWorker" in navigator && location.protocol !== "file:") {
    navigator.serviceWorker.register("./service-worker.js?v=7").catch(() => {});
  }
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
