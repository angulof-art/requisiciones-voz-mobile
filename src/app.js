import {
  catalogFromCsv,
  normalizeText,
  normalizeCatalogProduct,
  parseList,
  unitOptions
} from "./catalog.js?v=2.0.0-rc.2";
import { downloadExcel, downloadPdf, shareRequisition } from "./exporters.js?v=2.0.0-rc.2";
import {
  STATUS,
  addChange,
  clone,
  combineDuplicateItems,
  createId,
  createRequisition,
  findDuplicateGroups,
  formatDateParts,
  isMeaningfulRequisition,
  markConfirmed,
  markExported,
  markVoided,
  mergeRequisitionHistories,
  normalizeItem,
  validateRequisition,
  validateRequisitionItem
} from "./requisitions.js?v=2.0.0-rc.2";
import {
  clearCurrentRequisition,
  getStorageDiagnostics,
  hasDueSyncEntries,
  loadAppState,
  markSyncQueueFailed,
  markSyncQueueSyncing,
  queueSyncChange,
  rememberName,
  saveCatalog,
  saveCurrentRequisition,
  saveRequisitions,
  saveSettings,
  saveSyncQueue,
  upsertRequisition
} from "./storage.js?v=2.0.0-rc.2";
import {
  claimLegacyLocalData,
  initializeStorage,
  loadCachedAuthContext,
  saveCachedAuthContext,
  setStorageContext
} from "./storage.js?v=2.0.0-rc.2";
import {
  classifySupabaseError,
  fetchProductAliases,
  fetchRequisitionFromSupabase,
  fetchRequisitionsFromSupabase,
  isSupabaseReady,
  normalizeSupabaseUrl,
  reserveRequisitionNumber,
  saveProductAliasLearning,
  setSupabaseSessionContext,
  syncAllToSupabase,
  testSupabase,
  validatePublishableKey
} from "./supabase.js?v=2.0.0-rc.2";
import { getSupabaseClient } from "./auth/client.js?v=2.0.0-rc.2";
import { loadUserContextWithRetry, selectActiveContext } from "./auth/context.js?v=2.0.0-rc.2";
import { PERMISSIONS, hasPermission, hasRole } from "./auth/permissions.js?v=2.0.0-rc.2";
import {
  onAuthStateChange,
  restoreSession,
  signInWithPassword,
  signOut
} from "./auth/session.js?v=2.0.0-rc.2";
import { enrichCatalogWithAliases, processVoiceRequest } from "./voice-engine.js?v=2.0.0-rc.2";
import { buildOperationalReport } from "./reports.js?v=2.0.0-rc.2";
import { createEmailDistributionController } from "./email/ui.js?v=2.0.0-rc.2";
import {
  FULFILLMENT_STATUS,
  deriveRequisitionFulfillmentStatus,
  resolveRequiredAt,
  transitionRequisition,
  updateItemFulfillment
} from "./workflow.js?v=2.0.0-rc.2";
import { APP_VERSION } from "./version.js?v=2.0.0-rc.2";

let state = null;
let appSession = null;
let userContext = null;
let eventsBound = false;
let authSubscription = null;
const undoStack = [];
let recognition = null;
let isListening = false;
let replaceIndex = null;
let speechSessionBaseText = "";
let speechSessionFinalText = "";
let dictationSessionActive = false;
let dictationDeadline = 0;
let dictationStopTimer = null;
let recognitionRestartTimer = null;
let dictationStartingItemCount = 0;
let dictationEndingNormally = false;
let autoSaveTimer = null;
let autoSyncTimer = null;
let supabaseConnectionState = "checking";
let isCloudSyncing = false;
let deferredInstallPrompt = null;
let waitingServiceWorker = null;
let serviceWorkerReloading = false;
let localSaveChain = Promise.resolve();
let historyVisibleLimit = 30;
let emailController = null;

const els = {
  authGate: document.querySelector("#authGate"),
  appShell: document.querySelector("#appShell"),
  loginForm: document.querySelector("#loginForm"),
  loginEmail: document.querySelector("#loginEmail"),
  loginPassword: document.querySelector("#loginPassword"),
  loginButton: document.querySelector("#loginButton"),
  loginError: document.querySelector("#loginError"),
  authStatus: document.querySelector("#authStatus"),
  screenTitle: document.querySelector("#screenTitle"),
  connectionBadge: document.querySelector("#connectionBadge"),
  updateBanner: document.querySelector("#updateBanner"),
  updateAppButton: document.querySelector("#updateAppButton"),
  screens: document.querySelectorAll(".screen"),
  navButtons: document.querySelectorAll(".bottom-nav button"),
  profileButton: document.querySelector("#profileButton"),
  identityName: document.querySelector("#identityName"),
  identityContext: document.querySelector("#identityContext"),
  requestedBy: document.querySelector("#requestedBy"),
  originDepartment: document.querySelector("#originDepartment"),
  destinationDepartment: document.querySelector("#destinationDepartment"),
  priority: document.querySelector("#priority"),
  requiredPreset: document.querySelector("#requiredPreset"),
  customRequiredLabel: document.querySelector("#customRequiredLabel"),
  customRequiredAt: document.querySelector("#customRequiredAt"),
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
  retryLocalSaveButton: document.querySelector("#retryLocalSaveButton"),
  itemCount: document.querySelector("#itemCount"),
  reviewSummary: document.querySelector("#reviewSummary"),
  frequentList: document.querySelector("#frequentList"),
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
  shareButton: document.querySelector("#shareButton"),
  newOrderButtons: document.querySelectorAll("[data-new-order]"),
  historySearch: document.querySelector("#historySearch"),
  historyStatus: document.querySelector("#historyStatus"),
  historyDate: document.querySelector("#historyDate"),
  historyList: document.querySelector("#historyList"),
  historyEmpty: document.querySelector("#historyEmpty"),
  historyLoadMore: document.querySelector("#historyLoadMore"),
  favoritesList: document.querySelector("#favoritesList"),
  favoritesEmpty: document.querySelector("#favoritesEmpty"),
  saveTemplateButton: document.querySelector("#saveTemplateButton"),
  inboxStatus: document.querySelector("#inboxStatus"),
  inboxCount: document.querySelector("#inboxCount"),
  inboxList: document.querySelector("#inboxList"),
  inboxEmpty: document.querySelector("#inboxEmpty"),
  reportDateFrom: document.querySelector("#reportDateFrom"),
  reportDateTo: document.querySelector("#reportDateTo"),
  reportLocation: document.querySelector("#reportLocation"),
  reportDepartment: document.querySelector("#reportDepartment"),
  reportStatus: document.querySelector("#reportStatus"),
  reportKpis: document.querySelector("#reportKpis"),
  reportTopRequested: document.querySelector("#reportTopRequested"),
  reportUnavailable: document.querySelector("#reportUnavailable"),
  reportSubstitutions: document.querySelector("#reportSubstitutions"),
  reportDepartments: document.querySelector("#reportDepartments"),
  reportsEmpty: document.querySelector("#reportsEmpty"),
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
  appVersion: document.querySelector("#appVersion"),
  localStorageStatus: document.querySelector("#localStorageStatus"),
  installAppButton: document.querySelector("#installAppButton"),
  supabaseUrl: document.querySelector("#supabaseUrl"),
  supabaseKey: document.querySelector("#supabaseKey"),
  supabaseWorkspace: document.querySelector("#supabaseWorkspace"),
  supabaseEnabled: document.querySelector("#supabaseEnabled"),
  supabaseAutoSync: document.querySelector("#supabaseAutoSync"),
  supabaseStatus: document.querySelector("#supabaseStatus"),
  saveSupabaseButton: document.querySelector("#saveSupabaseButton"),
  testSupabaseButton: document.querySelector("#testSupabaseButton"),
  uploadSupabaseButton: document.querySelector("#uploadSupabaseButton"),
  downloadSupabaseButton: document.querySelector("#downloadSupabaseButton"),
  supabaseMessage: document.querySelector("#supabaseMessage"),
  supabaseTechnical: document.querySelector("#supabaseTechnical"),
  networkState: document.querySelector("#networkState"),
  localCount: document.querySelector("#localCount"),
  pendingCount: document.querySelector("#pendingCount"),
  lastSync: document.querySelector("#lastSync"),
  syncQueueList: document.querySelector("#syncQueueList"),
  logoutButton: document.querySelector("#logoutButton"),
  profileName: document.querySelector("#profileName"),
  profileEmail: document.querySelector("#profileEmail"),
  profileOrganization: document.querySelector("#profileOrganization"),
  profileLocation: document.querySelector("#profileLocation"),
  profileDepartment: document.querySelector("#profileDepartment"),
  profileRoles: document.querySelector("#profileRoles"),
  saveContextButton: document.querySelector("#saveContextButton"),
  adminLocationName: document.querySelector("#adminLocationName"),
  adminLocationCode: document.querySelector("#adminLocationCode"),
  addLocationButton: document.querySelector("#addLocationButton"),
  adminDepartmentName: document.querySelector("#adminDepartmentName"),
  adminDepartmentCode: document.querySelector("#adminDepartmentCode"),
  addDepartmentButton: document.querySelector("#addDepartmentButton"),
  adminMembers: document.querySelector("#adminMembers"),
  toast: document.querySelector("#toast")
};

boot();

async function boot() {
  els.appVersion.textContent = APP_VERSION;
  setupInstallPrompt();
  populateUnitSelects();
  setupSpeechRecognition();
  try {
    await initializeStorage();
    appSession = await restoreSession();
  } catch (error) {
    showLogin(error.message);
    return;
  }
  bindAuthEvents();
  registerServiceWorker();
  if (appSession) await activateSession(appSession);
  else showLogin();
}

function bindAuthEvents() {
  els.loginForm.addEventListener("submit", handleLogin);
  authSubscription = onAuthStateChange((event, session) => {
    if (event === "TOKEN_REFRESHED" && session && userContext) {
      appSession = session;
      setSupabaseSessionContext(session, userContext);
    }
    if (event === "SIGNED_OUT") showLogin();
  });
}

async function handleLogin(event) {
  event.preventDefault();
  els.loginError.textContent = "";
  els.loginButton.disabled = true;
  els.authStatus.textContent = "Validando cuenta…";
  try {
    const session = await signInWithPassword(els.loginEmail.value, els.loginPassword.value);
    await activateSession(session);
    els.loginPassword.value = "";
  } catch (error) {
    showLogin(error.message);
  } finally {
    els.loginButton.disabled = false;
  }
}

async function activateSession(session) {
  try {
    const cachedContext = await loadCachedAuthContext(session.user.id);
    const context = await loadUserContextWithRetry(session, cachedContext);
    appSession = session;
    userContext = context;
    await saveCachedAuthContext(context);
    setStorageContext(context);
    setSupabaseSessionContext(session, context);
    await claimLegacyLocalData(context);
    state = await loadAppState();
    state.current.requestedBy = state.current.requestedBy || context.displayName;
    state.current.requestedByUserId = state.current.requestedByUserId || context.userId;
    if (!emailController) {
      emailController = createEmailDistributionController({
        getContext: () => userContext,
        getCurrentRequisition: () => state?.current,
        getRequisition: (id) => [state?.current, ...(state?.requisitions || [])].find((entry) => entry?.id === id),
        getCatalog: () => state?.catalog || [],
        getDepartments: () => userContext?.directoryDepartments || userContext?.departments || [],
        formatDate: (value) => formatDateParts(value, state?.settings?.hourFormat || "24"),
        refreshRequisition: refreshRequisitionForEmail,
        isPendingSync: (id) => state?.syncQueue?.some((entry) =>
          entry.type === "requisition" && entry.payload?.id === id && entry.status !== "synced"
        ),
        submitRequisition: confirmOrder,
        reviewRequisition: () => navigate("review"),
        toast
      });
    }
    if (!eventsBound) {
      bindEvents();
      eventsBound = true;
    }
    applySettingsToForm();
    applyAccessControls();
    render();
    renderUserContext();
    setLocalSaveState("saved");
    renderStorageStatus();
    els.authGate.hidden = true;
    els.appShell.hidden = false;
    verifySupabaseConnection();
  } catch (error) {
    showLogin(error.message);
  }
}

function showLogin(message = "") {
  appSession = null;
  userContext = null;
  state = null;
  setStorageContext(null);
  setSupabaseSessionContext(null, null);
  els.appShell.hidden = true;
  els.authGate.hidden = false;
  els.loginError.textContent = message;
  els.authStatus.textContent = navigator.onLine
    ? "Ingrese con su cuenta asignada."
    : "Sin conexión. Solo puede entrar con una sesión válida guardada.";
}

function bindEvents() {
  els.navButtons.forEach((button) => {
    button.addEventListener("click", () => navigate(button.dataset.target));
  });

  els.requestedBy.addEventListener("input", () => {
    state.current.requestedBy = els.requestedBy.value;
    renderResponsibleState();
    scheduleAutoSave();
  });

  els.destinationDepartment.addEventListener("change", () => {
    state.current.destinationDepartmentId = els.destinationDepartment.value;
    scheduleAutoSave();
  });
  els.priority.addEventListener("change", () => {
    state.current.priority = els.priority.value;
    scheduleAutoSave();
  });
  els.requiredPreset.addEventListener("change", handleRequiredPresetChange);
  els.customRequiredAt.addEventListener("change", () => {
    state.current.requiredAt = resolveRequiredAt("custom", new Date(), els.customRequiredAt.value);
    scheduleAutoSave();
  });

  els.voiceButton.addEventListener("pointerdown", startPressToTalk);
  els.voiceButton.addEventListener("pointerup", stopPressToTalk);
  els.voiceButton.addEventListener("pointercancel", stopPressToTalk);
  els.voiceButton.addEventListener("keydown", handleVoiceKeyboard);
  els.processTranscriptButton.addEventListener("click", processTranscript);
  els.retryLocalSaveButton.addEventListener("click", autoSaveOrder);
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
  els.shareButton.addEventListener("click", shareOrder);
  els.newOrderButtons.forEach((button) => button.addEventListener("click", startNewOrder));

  ["input", "change"].forEach((eventName) => {
    els.itemsList.addEventListener(eventName, handleItemEdit);
  });
  els.itemsList.addEventListener("click", handleItemAction);

  [els.historySearch, els.historyStatus, els.historyDate].forEach((input) => {
    input.addEventListener("input", resetAndRenderHistory);
    input.addEventListener("change", resetAndRenderHistory);
  });
  els.historyList.addEventListener("click", handleHistoryAction);
  els.historyLoadMore.addEventListener("click", () => {
    historyVisibleLimit += 30;
    renderHistory();
  });
  els.frequentList.addEventListener("click", addQuickProduct);
  els.favoritesList.addEventListener("click", applyFavoriteTemplate);
  els.saveTemplateButton.addEventListener("click", saveCurrentAsTemplate);
  els.inboxStatus.addEventListener("change", renderInbox);
  els.inboxList.addEventListener("click", handleInboxAction);
  [els.reportDateFrom, els.reportDateTo, els.reportLocation, els.reportDepartment, els.reportStatus]
    .forEach((input) => {
      input.addEventListener("input", renderReports);
      input.addEventListener("change", renderReports);
    });

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
  els.testSupabaseButton.addEventListener("click", testSupabaseConnection);
  els.uploadSupabaseButton.addEventListener("click", uploadLocalToSupabase);
  els.downloadSupabaseButton.addEventListener("click", downloadCloudToLocal);
  els.updateAppButton.addEventListener("click", applyAppUpdate);
  els.installAppButton.addEventListener("click", installApp);
  els.profileButton.addEventListener("click", () => navigate("profile"));
  els.logoutButton.addEventListener("click", handleLogout);
  els.saveContextButton.addEventListener("click", saveActiveContext);
  els.profileLocation.addEventListener("change", renderDepartmentSelector);
  els.addLocationButton.addEventListener("click", addAdminLocation);
  els.addDepartmentButton.addEventListener("click", addAdminDepartment);

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
    favorites: "Favoritos",
    inbox: "Pedidos recibidos",
    reports: "Dashboard operativo",
    catalog: "Catálogo",
    config: "Configuración",
    sync: "Estado",
    profile: "Mi perfil",
    admin: "Administración",
    "email-admin": "Distribución por correo"
  };
  els.screenTitle.textContent = titles[target] || "Pedidos por Voz";
  if (target === "history") renderHistory();
  if (target === "favorites") renderFavorites();
  if (target === "inbox") renderInbox();
  if (target === "reports") renderReports();
  if (target === "catalog") renderCatalog();
  if (target === "sync") renderSync();
  if (target === "profile") renderUserContext();
  if (target === "admin") renderAdmin();
  if (target === "email-admin") emailController?.renderAdmin();
}

function applyAccessControls() {
  document.querySelectorAll("[data-permission]").forEach((element) => {
    element.hidden = !hasPermission(userContext, element.dataset.permission);
  });
  document.querySelectorAll("[data-role]").forEach((element) => {
    element.hidden = !hasRole(userContext, element.dataset.role);
  });
  const catalogNav = document.querySelector('.bottom-nav [data-target="catalog"]');
  if (catalogNav) catalogNav.hidden = !hasPermission(userContext, PERMISSIONS.manageCatalog);
  els.catalogForm.hidden = !hasPermission(userContext, PERMISSIONS.manageCatalog);
  els.catalogImport.closest(".file-button").hidden = !hasPermission(userContext, PERMISSIONS.manageCatalog);
}

function renderUserContext() {
  if (!userContext) return;
  els.identityName.textContent = userContext.displayName;
  els.identityContext.textContent = `${userContext.location.name} · ${userContext.department.name}`;
  els.profileName.value = userContext.displayName;
  els.profileEmail.value = userContext.email;
  els.profileRoles.textContent = `Roles: ${userContext.roles.join(", ") || "sin rol"}`;
  els.profileOrganization.innerHTML = userContext.organizations
    .map((organization) => `<option value="${escapeHtml(organization.id)}" ${organization.id === userContext.organizationId ? "selected" : ""}>${escapeHtml(organization.name)}</option>`)
    .join("");
  els.profileLocation.innerHTML = userContext.locations
    .filter((location) => location.organization_id === userContext.organizationId)
    .map((location) => `<option value="${escapeHtml(location.id)}" ${location.id === userContext.locationId ? "selected" : ""}>${escapeHtml(location.name)}</option>`)
    .join("");
  renderDepartmentSelector();
}

function renderDepartmentSelector() {
  if (!userContext) return;
  const locationId = els.profileLocation.value || userContext.locationId;
  els.profileDepartment.innerHTML = userContext.departments
    .filter((department) => department.location_id === locationId)
    .map((department) => `<option value="${escapeHtml(department.id)}" ${department.id === userContext.departmentId ? "selected" : ""}>${escapeHtml(department.name)}</option>`)
    .join("");
}

function renderRouting() {
  if (!userContext || !state?.current) return;
  const origin = userContext.departments.find((department) => department.id === userContext.departmentId);
  els.originDepartment.textContent = origin?.name || userContext.department?.name || "Departamento";
  const destinations = (userContext.directoryDepartments || userContext.departments).filter(
    (department) => department.organization_id === userContext.organizationId && department.id !== userContext.departmentId
  );
  els.destinationDepartment.innerHTML = [
    '<option value="">Seleccione destino</option>',
    ...destinations.map((department) => {
      const location = userContext.locations.find((entry) => entry.id === department.location_id);
      const label = location && location.id !== userContext.locationId
        ? `${department.name} · ${location.name}`
        : department.name;
      return `<option value="${escapeHtml(department.id)}">${escapeHtml(label)}</option>`;
    })
  ].join("");
  els.destinationDepartment.value = state.current.destinationDepartmentId || "";
  els.priority.value = state.current.priority || "normal";
  if (state.current.requiredAt) {
    els.requiredPreset.value = "custom";
    els.customRequiredAt.value = toDateTimeLocal(state.current.requiredAt);
  } else {
    els.requiredPreset.value = "tomorrow-am";
    els.customRequiredAt.value = "";
    state.current.requiredAt = resolveRequiredAt("tomorrow-am");
  }
  const editable = ["draft", "review"].includes(state.current.status);
  els.destinationDepartment.disabled = !editable;
  els.priority.disabled = !editable;
  els.requiredPreset.disabled = !editable;
  els.customRequiredAt.disabled = !editable;
  els.customRequiredLabel.hidden = els.requiredPreset.value !== "custom";
}

function handleRequiredPresetChange() {
  const preset = els.requiredPreset.value;
  els.customRequiredLabel.hidden = preset !== "custom";
  state.current.requiredAt = resolveRequiredAt(preset, new Date(), els.customRequiredAt.value);
  scheduleAutoSave();
}

function toDateTimeLocal(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

async function saveActiveContext() {
  try {
    const preferred = {
      organizationId: els.profileOrganization.value,
      locationId: els.profileLocation.value,
      departmentId: els.profileDepartment.value
    };
    const refreshed = navigator.onLine
      ? await loadUserContext(appSession, preferred)
      : selectActiveContext(userContext, preferred);
    userContext = refreshed;
    await saveCachedAuthContext(refreshed);
    setStorageContext(refreshed);
    setSupabaseSessionContext(appSession, refreshed);
    state = await loadAppState();
    state.current.requestedBy = state.current.requestedBy || refreshed.displayName;
    applyAccessControls();
    render();
    renderUserContext();
    navigate("new");
    verifySupabaseConnection();
    toast("Operación activa actualizada.");
  } catch (error) {
    toast(error.message || "No se pudo cambiar la operación activa.");
  }
}

async function handleLogout() {
  const pending = state?.syncQueue?.filter((entry) => entry.status !== "synced").length || 0;
  if (pending && !window.confirm(`Hay ${pending} cambio(s) pendiente(s) de sincronizar. Se conservarán en este dispositivo. ¿Cerrar sesión?`)) return;
  try {
    await signOut();
    showLogin();
  } catch (error) {
    toast(error.message || "No se pudo cerrar la sesión.");
  }
}

async function addAdminLocation() {
  const name = els.adminLocationName.value.trim();
  const code = normalizeAdminCode(els.adminLocationCode.value);
  if (!name || !code) return toast("Ingrese nombre y código para la sede.");
  const { error } = await getSupabaseClient().from("locations").insert({
    organization_id: userContext.organizationId,
    name,
    code,
    timezone: "America/Costa_Rica"
  });
  if (error) return toast(`No se pudo crear la sede: ${error.message}`);
  els.adminLocationName.value = "";
  els.adminLocationCode.value = "";
  await reloadContextAfterAdminChange();
  toast("Sede creada.");
}

async function addAdminDepartment() {
  const name = els.adminDepartmentName.value.trim();
  const code = normalizeAdminCode(els.adminDepartmentCode.value);
  if (!name || !code) return toast("Ingrese nombre y código para el departamento.");
  const { error } = await getSupabaseClient().from("departments").insert({
    organization_id: userContext.organizationId,
    location_id: userContext.locationId,
    name,
    code
  });
  if (error) return toast(`No se pudo crear el departamento: ${error.message}`);
  els.adminDepartmentName.value = "";
  els.adminDepartmentCode.value = "";
  await reloadContextAfterAdminChange();
  toast("Departamento creado.");
}

async function reloadContextAfterAdminChange() {
  const refreshed = await loadUserContext(appSession, userContext);
  userContext = refreshed;
  await saveCachedAuthContext(refreshed);
  setStorageContext(refreshed);
  setSupabaseSessionContext(appSession, refreshed);
  renderUserContext();
  renderAdmin();
}

async function renderAdmin() {
  if (!userContext || !hasRole(userContext, "administrator")) return;
  els.adminMembers.innerHTML = "<p class=\"hint\">Cargando usuarios…</p>";
  const client = getSupabaseClient();
  const { data: memberships, error } = await client
    .from("organization_memberships")
    .select("id,user_id,active")
    .eq("organization_id", userContext.organizationId)
    .order("created_at");
  if (error) {
    els.adminMembers.textContent = "No se pudieron cargar los usuarios.";
    return;
  }
  const userIds = memberships.map((entry) => entry.user_id);
  const [profilesResult, rolesResult] = await Promise.all([
    userIds.length ? client.from("profiles").select("id,display_name,active").in("id", userIds) : Promise.resolve({ data: [] }),
    client.from("membership_roles").select("user_id,role_code").eq("organization_id", userContext.organizationId)
  ]);
  const profiles = profilesResult.data || [];
  const roles = rolesResult.data || [];
  els.adminMembers.innerHTML = memberships.map((membership) => {
    const profile = profiles.find((entry) => entry.id === membership.user_id);
    const roleText = roles.filter((entry) => entry.user_id === membership.user_id).map((entry) => entry.role_code).join(", ");
    return `<article class="history-card"><strong>${escapeHtml(profile?.display_name || membership.user_id)}</strong><span>${escapeHtml(roleText || "sin rol")}</span><span>${membership.active && profile?.active !== false ? "Activo" : "Inactivo"}</span></article>`;
  }).join("") || "<p class=\"hint\">No hay membresías.</p>";
}

function normalizeAdminCode(value) {
  return String(value || "").trim().toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^A-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
}

function processTranscript(textOverride = null) {
  const hasTextOverride = typeof textOverride === "string";
  const text = (hasTextOverride ? textOverride : els.transcriptInput.value).trim();
  if (!text) {
    toast("No hay texto para procesar.");
    return;
  }
  const learnedCatalog = enrichCatalogWithAliases(state.catalog, state.settings.voiceAliases || {});
  const voiceResult = processVoiceRequest(text, replaceIndex === null ? state.current.items : [], learnedCatalog);
  state.current.originalTranscript = [state.current.originalTranscript, text]
    .filter(Boolean)
    .join("\n");

  if (voiceResult.action === "undo") {
    undoLast();
    return;
  }
  if (voiceResult.action === "none") {
    toast(voiceResult.message || "No pude identificar productos. Revise la transcripción.");
    return;
  }

  pushUndo();
  if (replaceIndex !== null) {
    state.current.items.splice(replaceIndex, 1, ...voiceResult.items.map(normalizeItem));
    replaceIndex = null;
  } else {
    state.current.items = voiceResult.items.map(normalizeItem);
  }
  addChange(state.current, `voz_${voiceResult.action}`, null, voiceResult.affectedItems);
  els.lastTranscript.textContent = `Último dictado: ${text}`;
  els.lastTranscript.hidden = false;
  els.transcriptInput.value = "";
  autoSaveOrder();
  renderSummary();
  renderItems();
  showDuplicateSuggestion(true);
  toast(voiceResult.message);
}

function startPressToTalk(event) {
  if (event.button !== 0 || els.voiceButton.disabled || dictationSessionActive) return;
  event.preventDefault();
  els.voiceButton.setPointerCapture?.(event.pointerId);
  toggleSpeech();
  navigator.vibrate?.(25);
}

function stopPressToTalk(event) {
  if (!dictationSessionActive) return;
  event.preventDefault();
  stopDictationSession();
  navigator.vibrate?.([18, 35, 18]);
}

function handleVoiceKeyboard(event) {
  if (!["Enter", " "].includes(event.key) || event.repeat) return;
  event.preventDefault();
  toggleSpeech();
}

function addQuickProduct(event) {
  const button = event.target.closest("button[data-product-id]");
  if (!button) return;
  const product = state.catalog.find((entry) => entry.id === button.dataset.productId);
  if (!product) return;
  pushUndo();
  const item = normalizeItem({
    id: createId("item"),
    productId: product.id,
    productCode: product.code,
    productName: product.officialName,
    rawProductName: product.officialName,
    quantity: 1,
    requestedQuantity: 1,
    unit: product.defaultUnit,
    unitExplicit: false,
    unitInferred: true,
    confidence: 96,
    confidenceBand: "high",
    needsReview: false
  });
  state.current.items.push(item);
  addChange(state.current, "agregar_frecuente", null, item);
  autoSaveOrder();
  render();
  toast(`${product.officialName} agregado.`);
}

async function saveCurrentAsTemplate() {
  const items = state.current.items.filter((item) => item.productName && Number(item.quantity) > 0);
  if (!items.length) return toast("Agregue productos antes de guardar la plantilla.");
  const name = window.prompt("Nombre de la plantilla", "Pedido semanal")?.trim();
  if (!name) return;
  state.settings.favoriteTemplates = state.settings.favoriteTemplates || [];
  state.settings.favoriteTemplates.unshift({
    id: createId("template"),
    name,
    items: items.map((item) => ({
      productId: item.productId,
      productCode: item.productCode,
      productName: item.productName,
      quantity: item.quantity,
      unit: item.unit,
      notes: item.notes
    }))
  });
  state.settings.favoriteTemplates = state.settings.favoriteTemplates.slice(0, 30);
  await saveSettings(state.settings);
  renderFavorites();
  toast("Plantilla guardada.");
}

async function applyFavoriteTemplate(event) {
  const button = event.target.closest("button[data-template-id]");
  if (!button) return;
  if (button.dataset.action === "delete-template") {
    state.settings.favoriteTemplates = (state.settings.favoriteTemplates || [])
      .filter((entry) => entry.id !== button.dataset.templateId);
    await saveSettings(state.settings);
    renderFavorites();
    toast("Plantilla eliminada.");
    return;
  }
  const template = getFavoriteTemplates().find((entry) => entry.id === button.dataset.templateId);
  if (!template?.items.length) return;
  pushUndo();
  const added = template.items.map((item) => normalizeItem({
    ...clone(item),
    id: createId("item"),
    requestedQuantity: item.quantity,
    confidence: 96,
    confidenceBand: "high",
    needsReview: false
  }));
  state.current.items.push(...added);
  addChange(state.current, "aplicar_plantilla", null, { id: template.id, name: template.name, items: added });
  autoSaveOrder();
  render();
  navigate("new");
  toast(`${template.name}: ${added.length} producto(s) agregados.`);
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
  renderSummary();
  renderValidation({ ok: true, errors: [], fieldErrors: {} });
  renderResponsibleState();
  scheduleAutoSave();
  if (field === "productName" && event.type === "change") renderItems();
}

async function handleItemAction(event) {
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
    const spokenPhrase = item.rawProductName || item.productName;
    item.productName = button.dataset.name;
    item.productCode = button.dataset.code;
    const selectedProduct = state.catalog.find((product) => product.id === button.dataset.productId || product.code === button.dataset.code);
    item.productId = selectedProduct?.id || item.productId;
    item.needsReview = false;
    item.confidence = 88;
    addChange(state.current, "seleccionar_sugerencia", null, item);
    if (selectedProduct && spokenPhrase) {
      state.settings.voiceAliases = state.settings.voiceAliases || {};
      state.settings.voiceAliases[normalizeText(spokenPhrase)] = selectedProduct.id;
      try {
        await saveSettings(state.settings);
        if (navigator.onLine && isSupabaseReady(state.settings.supabase)) {
          await saveProductAliasLearning(state.settings.supabase, spokenPhrase, selectedProduct.id);
        }
      } catch (error) {
        console.warn("No se pudo sincronizar el alias aprendido.", error);
      }
    }
  }
  autoSaveOrder();
  render();
}

async function confirmOrder() {
  state.current.requestedBy = els.requestedBy.value.trim();
  state.current.requestedByName = state.current.requestedBy;
  const validation = validateRequisition(state.current, state.catalog, "confirm");
  renderValidation(validation);
  if (!validation.ok) {
    toast(validation.errors[0]);
    return;
  }
  await ensureServerRequisitionNumber();
  markConfirmed(state.current);
  if (!(await saveOrderAndQueue())) return;
  toast("Pedido enviado correctamente.");
  render();
}

async function ensureServerRequisitionNumber() {
  if (!navigator.onLine || !isSupabaseReady(state.settings.supabase)) return;
  if (state.current.serverNumberReserved) return;
  try {
    try {
      const remote = await fetchRequisitionFromSupabase(state.settings.supabase, state.current.id);
      state.current.requisitionNumber = remote.requisitionNumber;
      state.current.serverNumberReserved = true;
      return;
    } catch (error) {
      if (error?.code !== "requisition_not_found") throw error;
    }
    const result = await reserveRequisitionNumber(state.settings.supabase);
    const number = typeof result === "string" ? result : result?.requisition_number || result?.requisitionNumber;
    if (number) {
      state.current.requisitionNumber = number;
      state.current.serverNumberReserved = true;
    }
  } catch (error) {
    console.warn("No se pudo reservar el consecutivo remoto; se conservará el provisional.", error);
  }
}

async function exportPdf() {
  if (!validateBeforeExport()) return;
  try {
    downloadPdf(withExportContext(state.current), state.settings.hourFormat);
    markExported(state.current);
    if (!(await saveOrderAndQueue())) return;
    toast("PDF generado y descargado.");
    render();
  } catch (error) {
    toast(error.message);
  }
}

async function exportCsv() {
  if (!validateBeforeExport()) return;
  downloadExcel(withExportContext(state.current), state.catalog, state.settings.hourFormat);
  markExported(state.current);
  if (!(await saveOrderAndQueue())) return;
  toast("Archivo Excel generado.");
  render();
}

async function shareOrder() {
  if (!validateBeforeExport()) return;
  try {
    const result = await shareRequisition(withExportContext(state.current));
    markExported(state.current);
    if (!(await saveOrderAndQueue())) return;
    toast(result === "copied" ? "Pedido copiado. Puede pegarlo en la aplicación que prefiera." : "Pedido compartido.");
  } catch (error) {
    if (error.name !== "AbortError") toast(error.message || "No se pudo compartir el pedido.");
  }
}

function withExportContext(requisition) {
  const origin = userContext.departments.find((department) => department.id === requisition.departmentId);
  const destination = (userContext.directoryDepartments || userContext.departments)
    .find((department) => department.id === requisition.destinationDepartmentId);
  const location = userContext.locations.find((entry) => entry.id === requisition.locationId);
  const exportRequisition = clone(requisition);
  exportRequisition.items = exportRequisition.items.map((item) => ({
    ...item,
    substitutionProductName: item.substitutionProductId
      ? state.catalog.find((product) => product.id === item.substitutionProductId)?.officialName || ""
      : ""
  }));
  return {
    ...exportRequisition,
    organizationName: userContext.organization?.name || "",
    locationName: location?.name || userContext.location?.name || "",
    departmentName: origin?.name || userContext.department?.name || "",
    destinationDepartmentName: destination?.name || ""
  };
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

async function saveOrderAndQueue() {
  state.current.requestedBy = els.requestedBy.value.trim();
  setLocalSaveState("saving");
  try {
    await enqueueLocalSave(async () => {
      markPendingSync(state.current);
      state.recentNames = await rememberName(state.current.requestedBy, state.recentNames);
      state.requisitions = await upsertRequisition(state.current, state.requisitions);
      state.syncQueue = await queueSyncChange(
        "requisition",
        { id: state.current.id },
        state.syncQueue
      );
      await persistCurrent();
    });
    setLocalSaveState("saved");
    render();
    scheduleAutoSync();
    return true;
  } catch (error) {
    handleLocalSaveError(error);
    return false;
  }
}

async function autoSaveOrder() {
  state.current.requestedBy = els.requestedBy.value.trim();
  state.current.updatedAt = new Date().toISOString();
  state.current.revisionNumber = Math.max(1, Number(state.current.revisionNumber) || 1) + 1;
  if (["draft", "review"].includes(state.current.status)) {
    state.current.status = state.current.items.some((item) => item.needsReview) ? "review" : "draft";
  }
  setLocalSaveState("saving");
  try {
    await enqueueLocalSave(async () => {
      markPendingSync(state.current);
      state.requisitions = await upsertRequisition(state.current, state.requisitions);
      state.syncQueue = await queueSyncChange(
        "requisition",
        { id: state.current.id },
        state.syncQueue
      );
      await persistCurrent();
    });
    setLocalSaveState("saved");
    scheduleAutoSync();
    return true;
  } catch (error) {
    handleLocalSaveError(error);
    return false;
  }
}

function scheduleAutoSave() {
  window.clearTimeout(autoSaveTimer);
  autoSaveTimer = window.setTimeout(async () => {
    if (state.current.items.length) await autoSaveOrder();
    else await persistCurrentSafely();
  }, 450);
}

function scheduleAutoSync() {
  if (
    !navigator.onLine ||
    !state.settings.supabase.autoSync ||
    !isSupabaseReady(state.settings.supabase) ||
    isCloudSyncing
  ) return;
  if (!hasDueSyncEntries(state.syncQueue)) {
    scheduleNextSyncRetry();
    return;
  }
  window.clearTimeout(autoSyncTimer);
  autoSyncTimer = window.setTimeout(() => performSupabaseSync(true, true), 900);
}

function scheduleNextSyncRetry() {
  const nextRetry = state.syncQueue
    .filter((entry) => entry.status === "failed" && entry.nextRetryAt)
    .map((entry) => Date.parse(entry.nextRetryAt))
    .filter(Number.isFinite)
    .sort((a, b) => a - b)[0];
  if (!nextRetry) return;
  window.clearTimeout(autoSyncTimer);
  autoSyncTimer = window.setTimeout(
    () => performSupabaseSync(true, true),
    Math.max(1_000, nextRetry - Date.now())
  );
}

async function startNewOrder() {
  cancelDictationSession();
  try {
    const previousWasSaved = await preserveCurrentOrder();
    await clearCurrentRequisition();
    state.current = createRequisition(state.requisitions);
    state.current.requestedBy = userContext.displayName;
    state.current.requestedByName = userContext.displayName;
    state.current.requestedByUserId = userContext.userId;
    state.current.organizationId = userContext.organizationId;
    state.current.locationId = userContext.locationId;
    state.current.departmentId = userContext.departmentId;
    state.current.priority = "normal";
    state.current.requiredAt = resolveRequiredAt("tomorrow-am");
    undoStack.length = 0;
    replaceIndex = null;
    els.transcriptInput.value = "";
    els.lastTranscript.hidden = true;
    await persistCurrent();
    setLocalSaveState("saved");
    render();
    navigate("new");
    els.voiceButton.focus();
    if (previousWasSaved) scheduleAutoSync();
    toast(
      previousWasSaved
        ? "Pedido anterior guardado en el historial. Nuevo pedido listo."
        : "Nuevo pedido listo."
    );
  } catch (error) {
    handleLocalSaveError(error);
  }
}

async function preserveCurrentOrder() {
  state.current.requestedBy = els.requestedBy.value.trim();
  if (!isMeaningfulRequisition(state.current)) return false;
  state.current.updatedAt = new Date().toISOString();
  if (["draft", "review"].includes(state.current.status)) {
    state.current.status = state.current.items.some((item) => item.needsReview) ? "review" : "draft";
  }
  try {
    await enqueueLocalSave(async () => {
      markPendingSync(state.current);
      state.requisitions = await upsertRequisition(state.current, state.requisitions);
      state.syncQueue = await queueSyncChange(
        "requisition",
        { id: state.current.id },
        state.syncQueue
      );
      state.recentNames = await rememberName(state.current.requestedBy, state.recentNames);
      await persistCurrent();
    });
    return true;
  } catch (error) {
    throw error;
  }
}

function importCatalog(event) {
  const [file] = event.target.files || [];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async () => {
    const imported = catalogFromCsv(String(reader.result || ""));
    if (!imported.length) {
      toast("No se encontraron productos en el catálogo.");
      return;
    }
    const byCode = new Map(state.catalog.map((product) => [product.code || product.id, product]));
    for (const product of imported) byCode.set(product.code || product.id, product);
    state.catalog = [...byCode.values()];
    try {
      await saveCatalog(state.catalog);
      state.syncQueue = await queueSyncChange(
        "catalog",
        { count: imported.length },
        state.syncQueue
      );
    } catch (error) {
      handleLocalSaveError(error);
      return;
    }
    renderCatalog();
    toast(`${imported.length} productos importados.`);
    event.target.value = "";
  };
  reader.readAsText(file, "utf-8");
}

async function saveCatalogProduct(event) {
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
  try {
    await saveCatalog(state.catalog);
    state.syncQueue = await queueSyncChange("catalog", { id: product.id }, state.syncQueue);
  } catch (error) {
    handleLocalSaveError(error);
    return;
  }
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

async function handleCatalogAction(event) {
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
    try {
      await saveCatalog(state.catalog);
    } catch (error) {
      handleLocalSaveError(error);
      return;
    }
    renderCatalog();
  }
}

async function handleHistoryAction(event) {
  const button = event.target.closest("button[data-action]");
  if (!button) return;
  const requisition = state.requisitions.find((entry) => entry.id === button.dataset.id);
  if (!requisition) return;
  if (button.dataset.action === "open") {
    cancelDictationSession();
    try {
      if (state.current.id !== requisition.id) await preserveCurrentOrder();
    } catch (error) {
      handleLocalSaveError(error);
      return;
    }
    state.current = clone(requisition);
    els.transcriptInput.value = "";
    undoStack.length = 0;
    replaceIndex = null;
    if (!(await persistCurrentSafely())) return;
    render();
    navigate("new");
    toast(["draft", "review"].includes(requisition.status) ? "Borrador abierto." : "Pedido abierto.");
  }
  if (button.dataset.action === "duplicate") {
    cancelDictationSession();
    try {
      await preserveCurrentOrder();
    } catch (error) {
      handleLocalSaveError(error);
      return;
    }
    const copy = createRequisition(state.requisitions);
    copy.requestedBy = requisition.requestedBy;
    copy.items = requisition.items.map((item) => ({ ...clone(item), id: createId("item") }));
    copy.originalTranscript = requisition.originalTranscript;
    addChange(copy, "duplicar_pedido", requisition, copy);
    state.current = copy;
    try {
      markPendingSync(copy);
      state.requisitions = await upsertRequisition(copy, state.requisitions);
      state.syncQueue = await queueSyncChange("requisition", { id: copy.id }, state.syncQueue);
    } catch (error) {
      handleLocalSaveError(error);
      return;
    }
    els.transcriptInput.value = "";
    undoStack.length = 0;
    replaceIndex = null;
    if (!(await persistCurrentSafely())) return;
    render();
    navigate("new");
    toast("Pedido duplicado como borrador.");
    scheduleAutoSync();
  }
  if (button.dataset.action === "void") {
    if (!window.confirm("¿Anular este pedido sin eliminarlo definitivamente?")) return;
    markVoided(requisition);
    try {
      markPendingSync(requisition);
      state.requisitions = await upsertRequisition(requisition, state.requisitions);
      state.syncQueue = await queueSyncChange(
        "requisition",
        { id: requisition.id },
        state.syncQueue
      );
    } catch (error) {
      handleLocalSaveError(error);
      return;
    }
    renderHistory();
    toast("Pedido anulado.");
    scheduleAutoSync();
  }
  if (["accept", "close"].includes(button.dataset.action)) {
    const nextStatus = button.dataset.action === "accept" ? "accepted" : "closed";
    const previous = clone(requisition);
    try {
      transitionRequisition(requisition, nextStatus);
      addChange(requisition, `flujo_${nextStatus}`, previous, requisition);
      await persistWorkflowRequisition(requisition);
      toast(nextStatus === "accepted" ? "Entrega recibida conforme." : "Pedido cerrado.");
    } catch (error) {
      toast(error.message);
    }
  }
}

async function handleInboxAction(event) {
  const button = event.target.closest("button[data-action][data-id]");
  if (!button || !hasPermission(userContext, PERMISSIONS.receiveRequisitions)) return;
  const requisition = state.requisitions.find((entry) => entry.id === button.dataset.id);
  if (!requisition) return;
  const previous = clone(requisition);
  try {
    if (button.dataset.action === "receive") transitionRequisition(requisition, "received");
    if (button.dataset.action === "prepare") transitionRequisition(requisition, "preparing");
    if (button.dataset.action === "save-fulfillment") {
      const card = button.closest("[data-requisition-id]");
      if (requisition.status === "received") transitionRequisition(requisition, "preparing");
      for (const row of card.querySelectorAll("[data-fulfillment-item]")) {
        const item = requisition.items.find((entry) => entry.id === row.dataset.fulfillmentItem);
        if (!item) continue;
        updateItemFulfillment(item, {
          fulfillmentStatus: row.querySelector('[data-field="fulfillmentStatus"]').value,
          deliveredQuantity: Number(row.querySelector('[data-field="deliveredQuantity"]').value || 0),
          unavailableReason: row.querySelector('[data-field="unavailableReason"]').value.trim(),
          substitutionProductId: row.querySelector('[data-field="substitutionProductId"]').value
        });
      }
      const derived = deriveRequisitionFulfillmentStatus(requisition.items);
      if (derived !== requisition.status && ["preparing", "partial", "delivered"].includes(derived)) {
        transitionRequisition(requisition, derived);
      }
    }
    if (button.dataset.action === "deliver-all") {
      if (requisition.status === "received") transitionRequisition(requisition, "preparing");
      requisition.items.forEach((item) => updateItemFulfillment(item, {
        fulfillmentStatus: "delivered",
        deliveredQuantity: item.requestedQuantity || item.quantity
      }));
      transitionRequisition(requisition, "delivered");
    }
    addChange(requisition, `flujo_${button.dataset.action}`, previous, requisition);
    await persistWorkflowRequisition(requisition);
    toast("Estado del pedido actualizado.");
  } catch (error) {
    Object.assign(requisition, previous);
    toast(error.message || "No se pudo actualizar el pedido.");
  }
}

async function persistWorkflowRequisition(requisition) {
  markPendingSync(requisition);
  state.requisitions = await upsertRequisition(requisition, state.requisitions);
  state.syncQueue = await queueSyncChange("requisition", { id: requisition.id }, state.syncQueue);
  if (state.current.id === requisition.id) {
    state.current = clone(requisition);
    await persistCurrent();
  }
  render();
  scheduleAutoSync();
}

async function saveUiSettings() {
  state.settings.hourFormat = els.hourFormat.value;
  state.settings.textSize = els.textSize.value;
  try {
    await saveSettings(state.settings);
  } catch (error) {
    handleLocalSaveError(error);
    return;
  }
  document.body.classList.toggle("text-large", state.settings.textSize === "large");
  render();
}

function applySettingsToForm() {
  els.hourFormat.value = state.settings.hourFormat || "24";
  els.textSize.value = state.settings.textSize || "normal";
  document.body.classList.toggle("text-large", state.settings.textSize === "large");
  els.supabaseUrl.value = state.settings.supabase.url || "";
  els.supabaseKey.value = state.settings.supabase.publishableKey || "";
  els.supabaseWorkspace.value = state.settings.supabase.workspaceId || "main";
  els.supabaseEnabled.checked = Boolean(state.settings.supabase.enabled);
  els.supabaseAutoSync.checked = Boolean(state.settings.supabase.autoSync);
}

async function saveSupabaseSettingsFromForm(options = {}) {
  const { announce = true } = options;
  const url = normalizeSupabaseUrl(els.supabaseUrl.value);
  const publishableKey = els.supabaseKey.value.trim() || state.settings.supabase.publishableKey || "";
  const validation = validatePublishableKey(publishableKey);
  if (els.supabaseEnabled.checked && (!url || !validation.ok)) {
    renderSupabaseMessage(validation.message || "Falta la URL de Supabase.", validation.technical);
    toast(validation.message || "Revise la conexión Supabase.");
    supabaseConnectionState = "error";
    renderConnection();
    return false;
  }
  state.settings.supabase = {
    url,
    publishableKey: validation.ok ? publishableKey : "",
    workspaceId: normalizeWorkspaceId(els.supabaseWorkspace.value),
    enabled: els.supabaseEnabled.checked && validation.ok && Boolean(url),
    autoSync: els.supabaseAutoSync.checked,
    integrationVersion: state.settings.supabase.integrationVersion,
    lastSyncAt: state.settings.supabase.lastSyncAt || ""
  };
  try {
    await saveSettings(state.settings);
  } catch (error) {
    handleLocalSaveError(error);
    return false;
  }
  applySettingsToForm();
  supabaseConnectionState = state.settings.supabase.enabled ? "checking" : "disabled";
  if (announce) {
    renderSupabaseMessage(
      state.settings.supabase.enabled
        ? "Conexión guardada. Puede probar, subir datos locales o descargar la nube."
        : "Supabase queda desactivado hasta que marque Activar nube."
    );
  }
  renderConnection();
  return true;
}

function normalizeWorkspaceId(value) {
  return String(value || "main")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "") || "main";
}

async function testSupabaseConnection() {
  if (!(await saveSupabaseSettingsFromForm({ announce: false }))) return;
  if (!isSupabaseReady(state.settings.supabase)) return;
  try {
    setCloudBusy(true);
    supabaseConnectionState = "checking";
    renderSupabaseMessage("Probando conexión...");
    renderConnection();
    await testSupabase(state.settings.supabase);
    supabaseConnectionState = "connected";
    renderSupabaseMessage("Conexión correcta. Supabase respondió correctamente.");
    renderConnection();
    toast("Conexión con Supabase verificada.");
  } catch (error) {
    handleSupabaseError(error, false);
  } finally {
    setCloudBusy(false);
  }
}

async function uploadLocalToSupabase() {
  if (!(await saveSupabaseSettingsFromForm({ announce: false }))) return;
  if (!isSupabaseReady(state.settings.supabase)) return;
  await performSupabaseSync(false, false);
}

async function downloadCloudToLocal() {
  if (!(await saveSupabaseSettingsFromForm({ announce: false }))) return;
  if (!isSupabaseReady(state.settings.supabase)) return;
  await performSupabaseDownload(false);
}

async function verifySupabaseConnection() {
  if (!navigator.onLine) {
    supabaseConnectionState = "offline";
    renderConnection();
    return;
  }
  if (!isSupabaseReady(state.settings.supabase)) {
    supabaseConnectionState = "disabled";
    renderSupabaseMessage("Supabase está desactivado.");
    renderConnection();
    return;
  }
  try {
    supabaseConnectionState = "checking";
    renderConnection();
    await testSupabase(state.settings.supabase);
    if (state.settings.supabase.autoSync) await refreshHistoryFromSupabase();
    supabaseConnectionState = "connected";
    renderSupabaseMessage(
      state.settings.supabase.autoSync
        ? "Conectado. Datos de la nube descargados y combinados."
        : "Conectado. La sincronización automática está desactivada."
    );
    renderConnection();
    if (state.settings.supabase.autoSync && state.syncQueue.length) scheduleAutoSync();
  } catch (error) {
    handleSupabaseError(error, true);
  }
}

async function performSupabaseSync(silent = false, downloadAfter = true) {
  if (!navigator.onLine || !isSupabaseReady(state.settings.supabase)) return;
  try {
    isCloudSyncing = true;
    setCloudBusy(true);
    supabaseConnectionState = "checking";
    if (!silent) renderSupabaseMessage("Subiendo datos locales...");
    renderConnection();
    state.syncQueue = await markSyncQueueSyncing(state.syncQueue);
    await testSupabase(state.settings.supabase);
    const pendingIds = new Set(state.syncQueue
      .filter((entry) => entry.type === "requisition" && entry.payload?.id)
      .map((entry) => entry.payload.id));
    const syncResult = await syncAllToSupabase(
      state.settings.supabase,
      state.requisitions.filter((requisition) => pendingIds.has(requisition.id)),
      state.catalog
    );
    if (syncResult.renames.length) {
      const currentRename = syncResult.renames.find((rename) => rename.id === state.current.id);
      if (currentRename) state.current.requisitionNumber = currentRename.requisitionNumber;
    }
    const syncedCurrent = state.requisitions.find((requisition) => requisition.id === state.current.id);
    if (syncedCurrent) {
      state.current = clone(syncedCurrent);
    }
    await saveRequisitions(state.requisitions);
    await persistCurrent();
    if (downloadAfter) await refreshHistoryFromSupabase();
    state.settings.supabase.lastSyncAt = new Date().toISOString();
    state.syncQueue = [];
    await saveSyncQueue([]);
    await saveSettings(state.settings);
    supabaseConnectionState = "connected";
    els.autosaveState.textContent = "Sincronizado";
    els.autosaveState.classList.add("synced");
    const adjustedNumber = syncResult.renames.at(-1)?.requisitionNumber;
    renderSupabaseMessage(
      adjustedNumber
        ? `Datos subidos. Número ajustado automáticamente: ${adjustedNumber}.`
        : downloadAfter
          ? "Datos locales subidos y datos de la nube combinados."
          : "Datos locales subidos a Supabase."
    );
    render();
    if (!silent) toast("Datos locales subidos correctamente.");
  } catch (error) {
    if (state.syncQueue.length) {
      try {
        const partiallySyncedCurrent = state.requisitions.find(
          (requisition) => requisition.id === state.current.id
        );
        if (partiallySyncedCurrent) {
          state.current = clone(partiallySyncedCurrent);
        }
        await saveRequisitions(state.requisitions);
        await persistCurrent();
        state.syncQueue = await markSyncQueueFailed(state.syncQueue, error);
        scheduleAutoSync();
      } catch (storageError) {
        handleLocalSaveError(storageError);
      }
    }
    handleSupabaseError(error, silent);
  } finally {
    isCloudSyncing = false;
    setCloudBusy(false);
    if (state.syncQueue.length) scheduleAutoSync();
  }
}

async function performSupabaseDownload(silent = false) {
  if (!navigator.onLine || !isSupabaseReady(state.settings.supabase)) return;
  try {
    isCloudSyncing = true;
    setCloudBusy(true);
    supabaseConnectionState = "checking";
    if (!silent) renderSupabaseMessage("Descargando datos de la nube...");
    renderConnection();
    await testSupabase(state.settings.supabase);
    await refreshHistoryFromSupabase();
    state.settings.supabase.lastSyncAt = new Date().toISOString();
    await saveSettings(state.settings);
    supabaseConnectionState = "connected";
    renderSupabaseMessage("Datos descargados y combinados sin borrar datos locales.");
    render();
    if (!silent) toast("Historial descargado desde Supabase.");
  } catch (error) {
    handleSupabaseError(error, silent);
  } finally {
    isCloudSyncing = false;
    setCloudBusy(false);
  }
}

function handleSupabaseError(error, silent = false) {
  supabaseConnectionState = "error";
  const classified = classifySupabaseError(error);
  renderSupabaseMessage(`${classified.label}: ${classified.message}`, classified.technical);
  if (!silent) toast(classified.message);
  renderConnection();
}

function setCloudBusy(busy) {
  [
    els.saveSupabaseButton,
    els.testSupabaseButton,
    els.uploadSupabaseButton,
    els.downloadSupabaseButton
  ].forEach((button) => {
    button.disabled = busy;
  });
}

async function refreshHistoryFromSupabase() {
  const [remoteRequisitions, remoteAliases] = await Promise.all([
    fetchRequisitionsFromSupabase(state.settings.supabase),
    fetchProductAliases(state.settings.supabase)
  ]);
  state.settings.voiceAliases = { ...(state.settings.voiceAliases || {}), ...remoteAliases };
  await saveSettings(state.settings);
  const pendingIds = state.syncQueue
    .filter((entry) => entry.type === "requisition" && entry.payload?.id)
    .map((entry) => entry.payload.id);
  const merged = mergeRequisitionHistories(state.requisitions, remoteRequisitions, pendingIds);
  const currentVersion = merged.find((entry) => entry.id === state.current.id);
  const currentIsPending = pendingIds.includes(state.current.id);
  if (
    currentVersion &&
    !currentIsPending &&
    new Date(currentVersion.updatedAt).getTime() > new Date(state.current.updatedAt).getTime()
  ) {
    state.current = clone(currentVersion);
    await persistCurrent();
  }
  state.requisitions = merged;
  await saveRequisitions(state.requisitions);
  renderHistory();
}

async function refreshRequisitionForEmail(requisitionId) {
  const pending = state.syncQueue.some((entry) =>
    entry.type === "requisition" && entry.payload?.id === requisitionId && entry.status !== "synced"
  );
  if (pending) {
    const error = new Error("Este pedido todavía está pendiente de sincronización. Espere a que termine antes de enviarlo por correo.");
    error.code = "sync_pending";
    throw error;
  }
  const remote = await fetchRequisitionFromSupabase(state.settings.supabase, requisitionId);
  state.requisitions = await upsertRequisition(remote, state.requisitions);
  if (state.current.id === requisitionId) {
    state.current = clone(remote);
    await persistCurrent();
  }
  render();
  return clone(remote);
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
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.maxAlternatives = 1;
  recognition.onstart = () => {
    isListening = true;
    els.voiceButton.classList.add("listening");
    els.voiceButton.setAttribute("aria-pressed", "true");
    els.voicePrimary.textContent = "Escuchando";
    els.voiceSecondary.textContent = "Suelte para terminar";
    els.speechStatus.textContent = "Escuchando... puede dictar varios productos.";
  };
  recognition.onerror = (event) => {
    const error = event.error || "desconocido";
    if (error === "no-speech" && dictationSessionActive) {
      els.speechStatus.textContent = "Sigo escuchando... continúe con el pedido.";
      return;
    }
    if (error === "aborted" && !dictationSessionActive) return;
    els.speechStatus.textContent = describeSpeechError(error);
    dictationSessionActive = false;
    clearDictationTimers();
    stopSpeechUi();
  };
  recognition.onend = () => {
    isListening = false;
    if (dictationSessionActive && Date.now() < dictationDeadline) {
      els.speechStatus.textContent = "Pausa detectada. Sigo escuchando...";
      window.clearTimeout(recognitionRestartTimer);
      recognitionRestartTimer = window.setTimeout(startRecognitionChunk, 250);
      return;
    }
    finishDictationSession();
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
  if (dictationSessionActive) {
    stopDictationSession();
    return;
  }
  dictationSessionActive = true;
  dictationEndingNormally = false;
  dictationDeadline = Date.now() + 45000;
  dictationStartingItemCount = state.current.items.length;
  speechSessionBaseText = "";
  speechSessionFinalText = "";
  els.transcriptInput.value = replaceIndex === null ? els.transcriptInput.value : "";
  clearDictationTimers();
  dictationStopTimer = window.setTimeout(stopDictationSession, 45000);
  startRecognitionChunk();
}

function startRecognitionChunk() {
  if (!dictationSessionActive || Date.now() >= dictationDeadline) {
    finishDictationSession();
    return;
  }
  try {
    recognition.start();
  } catch (error) {
    if (error.name === "InvalidStateError") return;
    dictationSessionActive = false;
    clearDictationTimers();
    stopSpeechUi();
    els.speechStatus.textContent = error.message;
  }
}

function stopDictationSession() {
  const wasActive = dictationSessionActive || isListening;
  if (wasActive) dictationEndingNormally = true;
  dictationSessionActive = false;
  clearDictationTimers();
  if (isListening) {
    try {
      recognition.stop();
    } catch {
      finishDictationSession();
    }
  } else if (wasActive) {
    finishDictationSession();
  }
}

function cancelDictationSession() {
  dictationSessionActive = false;
  dictationEndingNormally = false;
  clearDictationTimers();
  speechSessionFinalText = "";
  if (isListening) {
    try {
      recognition.abort();
    } catch {
      // The browser already closed the recognition session.
    }
  }
  stopSpeechUi();
}

function finishDictationSession() {
  const wasActive = dictationSessionActive || isListening;
  const shouldSummarize = wasActive || dictationEndingNormally || Boolean(speechSessionFinalText);
  dictationSessionActive = false;
  dictationEndingNormally = false;
  isListening = false;
  clearDictationTimers();
  stopSpeechUi();
  if (!shouldSummarize) return;
  const added = Math.max(0, state.current.items.length - dictationStartingItemCount);
  els.speechStatus.textContent = added
    ? `Dictado finalizado: ${added} ${added === 1 ? "producto agregado" : "productos agregados"}.`
    : "Dictado finalizado. No se agregó ningún producto.";
}

function clearDictationTimers() {
  window.clearTimeout(dictationStopTimer);
  window.clearTimeout(recognitionRestartTimer);
  dictationStopTimer = null;
  recognitionRestartTimer = null;
}

function stopSpeechUi() {
  isListening = false;
  els.voiceButton.classList.remove("listening");
  els.voiceButton.setAttribute("aria-pressed", "false");
  els.voicePrimary.textContent = "Mantenga y hable";
  els.voiceSecondary.textContent = "Puede pedir varios productos";
}

function describeSpeechError(error) {
  const messages = {
    "not-allowed": "No se autorizó el micrófono. Revise el permiso del navegador o escriba el pedido.",
    "service-not-allowed": "El navegador bloqueó el reconocimiento de voz. Puede escribir el pedido.",
    "audio-capture": "No se encontró un micrófono disponible. Puede escribir el pedido.",
    network: "La voz necesita conexión en este navegador. El pedido manual sigue disponible.",
    "language-not-supported": "Este navegador no admite reconocimiento en español de Costa Rica.",
    "no-speech": "No se detectó voz. Toque Dictar e inténtelo nuevamente.",
    aborted: "El dictado se detuvo. Puede continuar cuando esté listo."
  };
  return messages[error] || "No fue posible usar el micrófono. Puede escribir el pedido manualmente.";
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
  renderRouting();
  renderSummary();
  renderFrequentProducts();
  renderItems();
  renderHistory();
  renderFavorites();
  renderInbox();
  renderReports();
  renderCatalog();
  renderConnection();
  renderRecentNames();
  emailController?.renderCurrent(state.current);
}

function renderSummary() {
  els.requisitionNumber.textContent = state.current.requisitionNumber;
  els.statusBadge.textContent = STATUS[state.current.status] || state.current.status;
  els.statusBadge.className = `state-badge ${state.current.status}`;
  els.confirmButton.hidden = !["draft", "review"].includes(state.current.status);
  const editable = ["draft", "review"].includes(state.current.status);
  els.voiceButton.disabled = !editable;
  els.transcriptInput.disabled = !editable;
  els.processTranscriptButton.disabled = !editable;
  els.addRowButton.disabled = !editable;
  els.undoButton.disabled = !editable;
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
  const orderedItems = [...state.current.items].sort((left, right) => Number(right.needsReview) - Number(left.needsReview));
  orderedItems.forEach((item, index) => {
    const editable = ["draft", "review"].includes(state.current.status);
    const disabled = editable ? "" : "disabled";
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
          `<button class="secondary" type="button" data-action="suggestion" data-code="${escapeHtml(suggestion.code)}" data-product-id="${escapeHtml(suggestion.productId || "")}" data-name="${escapeHtml(suggestion.name)}">${escapeHtml(suggestion.name)}</button>`
      )
      .join("");
    card.innerHTML = `
      <div class="item-header">
        <div class="item-title">Línea ${index + 1}</div>
        <span class="confidence-badge ${escapeHtml(item.confidenceBand || "review")}">${item.confidence >= 90 ? "Alta" : item.confidence >= 70 ? "Media" : "Revisar"} · ${Math.round(item.confidence || 0)}%</span>
      </div>
      <div class="item-grid">
        <label class="product-field">Producto <input data-field="productName" value="${escapeHtml(item.productName)}" ${disabled} /></label>
        <label>Cantidad <input data-field="quantity" type="number" min="0.001" step="0.001" value="${item.quantity ?? ""}" ${disabled} /></label>
        <label>Unidad de compra <select data-field="unit" ${disabled}>${options}</select></label>
        ${item.notes ? `<label class="notes-field">Observaciones <input data-field="notes" value="${escapeHtml(item.notes)}" ${disabled} /></label>` : ""}
      </div>
      ${item.needsReview ? `<div class="review-callout">
        <p class="review-note">${item.ambiguous ? "¿Cuál producto quiso decir?" : "Revise esta línea antes de enviar."}</p>
        <button type="button" data-action="accept-review">Aceptar línea</button>
      </div>` : ""}
      ${item.unitAllowed === false ? `<label class="check-row">
        <input data-field="unitOverride" type="checkbox" ${item.unitOverride ? "checked" : ""} />
        <span>Autorizar unidad no habitual</span>
      </label>` : ""}
      ${suggestions ? `<div class="toolbar">${suggestions}</div>` : ""}
      ${editable ? `<div class="card-actions">
        <button class="secondary" type="button" data-action="duplicate">Duplicar</button>
        <button class="secondary" type="button" data-action="replace-voice">Redictar</button>
        <button class="danger" type="button" data-action="delete">Eliminar</button>
      </div>` : ""}
    `;
    els.itemsList.append(card);
  });
  els.itemsEmpty.classList.toggle("visible", state.current.items.length === 0);
  const reviewCount = state.current.items.filter((item) => item.needsReview).length;
  els.reviewSummary.textContent = `${state.current.items.length - reviewCount} listos · ${reviewCount} por revisar`;
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
  }).sort((left, right) => new Date(right.updatedAt) - new Date(left.updatedAt));
  els.historyList.innerHTML = "";
  rows.slice(0, historyVisibleLimit).forEach((req) => {
    const created = formatDateParts(req.createdAt, state.settings.hourFormat);
    const updated = formatDateParts(req.updatedAt, state.settings.hourFormat);
    const productNames = req.items
      .slice(0, 3)
      .map((item) => item.productName)
      .filter(Boolean)
      .join(", ");
    const remainingProducts = Math.max(0, req.items.length - 3);
    const actionLabel = ["draft", "review"].includes(req.status) ? "Continuar" : "Ver";
    const canAccept = req.status === "delivered" && req.requestedByUserId === userContext.userId;
    const canClose = req.status === "accepted" && (hasRole(userContext, "manager") || hasRole(userContext, "administrator"));
    const canVoid = ["draft", "review", "submitted", "received", "preparing", "partial"].includes(req.status);
    const canEmail = emailController?.canOffer(req);
    const card = document.createElement("article");
    card.className = "history-card";
    card.innerHTML = `
      <div class="history-header">
        <div>
          <div class="history-title">${escapeHtml(req.requisitionNumber)}</div>
          <div class="meta-line">
            <span>${escapeHtml(req.requestedBy || "Sin responsable")}</span>
            <span>${req.items.length} ${req.items.length === 1 ? "producto" : "productos"}</span>
            <span>${STATUS[req.status] || req.status}</span>
          </div>
        </div>
      </div>
      <p class="history-products">${escapeHtml(productNames || "Sin productos")}${remainingProducts ? ` y ${remainingProducts} más` : ""}</p>
      <p class="history-date">Creado ${created.date} ${created.time} · Actualizado ${updated.date} ${updated.time}</p>
      <div class="card-actions">
        <button type="button" data-action="open" data-id="${escapeHtml(req.id)}">${actionLabel}</button>
        ${canAccept ? `<button type="button" data-action="accept" data-id="${escapeHtml(req.id)}">Recibido conforme</button>` : ""}
        ${canClose ? `<button type="button" data-action="close" data-id="${escapeHtml(req.id)}">Cerrar</button>` : ""}
        <button class="secondary" type="button" data-action="duplicate" data-id="${escapeHtml(req.id)}">Duplicar</button>
        ${canEmail ? `<button class="secondary" type="button" data-email-requisition-id="${escapeHtml(req.id)}">Enviar por correo</button>` : ""}
        ${canVoid ? `<button class="danger" type="button" data-action="void" data-id="${escapeHtml(req.id)}">Anular</button>` : ""}
      </div>
    `;
    els.historyList.append(card);
  });
  els.historyEmpty.classList.toggle("visible", rows.length === 0);
  els.historyLoadMore.hidden = rows.length <= historyVisibleLimit;
  els.historyLoadMore.textContent = `Cargar más (${Math.max(0, rows.length - historyVisibleLimit)})`;
}

function resetAndRenderHistory() {
  historyVisibleLimit = 30;
  renderHistory();
}

function renderFrequentProducts() {
  const counts = new Map();
  state.requisitions.forEach((requisition) => {
    requisition.items.forEach((item) => {
      const product = state.catalog.find((entry) => entry.id === item.productId || (item.productCode && entry.code === item.productCode));
      if (!product) return;
      const entry = counts.get(product.id) || { product, count: 0 };
      entry.count += 1;
      counts.set(product.id, entry);
    });
  });
  const frequent = [...counts.values()].sort((left, right) => right.count - left.count).slice(0, 6);
  const choices = frequent.length
    ? frequent
    : state.catalog.filter((product) => product.active !== false).slice(0, 6).map((product) => ({ product, count: 0 }));
  els.frequentList.innerHTML = choices.map(({ product, count }) =>
    `<button class="quick-product" type="button" data-product-id="${escapeHtml(product.id)}"><strong>+ ${escapeHtml(product.officialName)}</strong><span>${escapeHtml(product.defaultUnit)}${count ? ` · ${count} pedidos` : ""}</span></button>`
  ).join("");
}

function renderFavorites() {
  const templates = getFavoriteTemplates().filter((template) => template.items.length);
  els.favoritesList.innerHTML = templates.map((template) => {
    const isCustom = (state.settings.favoriteTemplates || []).some((entry) => entry.id === template.id);
    return `<article class="history-card"><div class="history-header"><div><div class="history-title">${escapeHtml(template.name)}</div><p class="history-products">${escapeHtml(template.items.slice(0, 4).map((item) => item.productName).join(", "))}${template.items.length > 4 ? "…" : ""}</p></div><span class="state-badge">${template.items.length}</span></div><div class="card-actions"><button type="button" data-template-id="${escapeHtml(template.id)}">Agregar al pedido</button>${isCustom ? `<button class="danger" type="button" data-action="delete-template" data-template-id="${escapeHtml(template.id)}">Eliminar</button>` : ""}</div></article>`;
  }).join("");
  els.favoritesEmpty.classList.toggle("visible", templates.length === 0);
}

function getFavoriteTemplates() {
  const definitions = [
    ["Desayuno", ["leche", "huevo", "pan", "cafe"]],
    ["Frutas", ["banano", "papaya", "sandia", "melon"]],
    ["Banquetes", ["pechuga", "arroz", "tomate", "lechuga"]],
    ["Sushi", ["salmon", "arroz", "wasabi", "aguacate"]],
    ["Pedido semanal", ["azucar", "leche", "arroz", "cebolla"]]
  ];
  const starterTemplates = definitions.map(([name, keywords], index) => {
    const used = new Set();
    const items = keywords.flatMap((keyword) => {
      const product = state.catalog.find((entry) => entry.active !== false && !used.has(entry.id) && normalizeText(entry.officialName).includes(keyword));
      if (!product) return [];
      used.add(product.id);
      return [{
        productId: product.id,
        productCode: product.code,
        productName: product.officialName,
        quantity: 1,
        unit: product.defaultUnit,
        notes: ""
      }];
    });
    return { id: `starter-${index}`, name, items };
  });
  return [...(state.settings.favoriteTemplates || []), ...starterTemplates];
}

function renderInbox() {
  if (!state || !userContext || !hasPermission(userContext, PERMISSIONS.receiveRequisitions)) return;
  const selected = els.inboxStatus.value || "active";
  const activeStatuses = ["submitted", "received", "preparing", "partial"];
  const rows = state.requisitions
    .filter((req) => userContext.departmentIds.includes(req.destinationDepartmentId))
    .filter((req) => selected === "active" ? activeStatuses.includes(req.status) : req.status === selected)
    .sort((left, right) => {
      const priorityOrder = { emergency: 0, urgent: 1, normal: 2 };
      return (priorityOrder[left.priority] ?? 2) - (priorityOrder[right.priority] ?? 2)
        || new Date(left.requiredAt || left.createdAt) - new Date(right.requiredAt || right.createdAt);
    });
  els.inboxCount.textContent = `${rows.length} ${rows.length === 1 ? "pedido" : "pedidos"}`;
  els.inboxList.innerHTML = "";
  rows.forEach((req) => {
    const origin = userContext.departments.find((department) => department.id === req.departmentId);
    const required = formatDateParts(req.requiredAt || req.createdAt, state.settings.hourFormat);
    const canPrepare = ["received", "preparing", "partial"].includes(req.status);
    const card = document.createElement("article");
    card.className = `history-card priority-${req.priority || "normal"}`;
    card.dataset.requisitionId = req.id;
    const itemRows = req.items.map((item) => {
      const productOptions = state.catalog
        .filter((product) => product.active !== false && product.id !== item.productId)
        .map((product) => `<option value="${escapeHtml(product.id)}" ${product.id === item.substitutionProductId ? "selected" : ""}>${escapeHtml(product.officialName)}</option>`)
        .join("");
      const statusOptions = Object.entries(FULFILLMENT_STATUS)
        .map(([value, label]) => `<option value="${value}" ${value === item.fulfillmentStatus ? "selected" : ""}>${label}</option>`)
        .join("");
      return `<div class="fulfillment-row" data-fulfillment-item="${escapeHtml(item.id)}">
        <div><strong>${escapeHtml(item.productName)}</strong><span>${item.requestedQuantity || item.quantity} ${escapeHtml(item.unit)}</span></div>
        ${canPrepare ? `<label>Estado<select data-field="fulfillmentStatus">${statusOptions}</select></label>
          <label>Entregado<input data-field="deliveredQuantity" type="number" min="0" max="${item.requestedQuantity || item.quantity}" step="0.001" value="${item.deliveredQuantity || 0}" /></label>
          <label>Razón<input data-field="unavailableReason" value="${escapeHtml(item.unavailableReason || "")}" placeholder="Si no hay existencia" /></label>
          <label>Sustituto<select data-field="substitutionProductId"><option value="">Sin sustituto</option>${productOptions}</select></label>` : ""}
      </div>`;
    }).join("");
    const action = req.status === "submitted"
      ? `<button type="button" data-action="receive" data-id="${escapeHtml(req.id)}">Recibir pedido</button>`
      : req.status === "received"
        ? `<button type="button" data-action="prepare" data-id="${escapeHtml(req.id)}">Iniciar preparación</button>`
        : "";
    card.innerHTML = `<div class="history-header"><div><div class="history-title">${escapeHtml(req.requisitionNumber)}</div>
      <div class="meta-line"><span>${escapeHtml(origin?.name || "Origen")}</span><span>${escapeHtml(req.requestedByName || req.requestedBy)}</span><span>${STATUS[req.status] || req.status}</span></div></div>
      <span class="state-badge ${escapeHtml(req.priority || "normal")}">${escapeHtml(req.priority || "normal")}</span></div>
      <p class="history-date">Se necesita ${required.date} ${required.time}</p>${itemRows}
      <div class="card-actions">${action}${canPrepare ? `<button type="button" data-action="save-fulfillment" data-id="${escapeHtml(req.id)}">Guardar preparación</button><button class="secondary" type="button" data-action="deliver-all" data-id="${escapeHtml(req.id)}">Entregar todo</button>` : ""}</div>`;
    els.inboxList.append(card);
  });
  els.inboxEmpty.classList.toggle("visible", rows.length === 0);
}

function renderReports() {
  if (!state || !userContext || !hasPermission(userContext, PERMISSIONS.readReports)) return;
  const locationValue = els.reportLocation.value || "all";
  const departmentValue = els.reportDepartment.value || "all";
  els.reportLocation.innerHTML = ['<option value="all">Todas</option>', ...userContext.locations
    .filter((location) => location.organization_id === userContext.organizationId)
    .map((location) => `<option value="${escapeHtml(location.id)}">${escapeHtml(location.name)}</option>`)].join("");
  els.reportLocation.value = [...els.reportLocation.options].some((option) => option.value === locationValue) ? locationValue : "all";
  els.reportDepartment.innerHTML = ['<option value="all">Todos</option>', ...userContext.departments
    .filter((department) => els.reportLocation.value === "all" || department.location_id === els.reportLocation.value)
    .map((department) => `<option value="${escapeHtml(department.id)}">${escapeHtml(department.name)}</option>`)].join("");
  els.reportDepartment.value = [...els.reportDepartment.options].some((option) => option.value === departmentValue) ? departmentValue : "all";
  const report = buildOperationalReport(state.requisitions, {
    dateFrom: els.reportDateFrom.value,
    dateTo: els.reportDateTo.value,
    locationId: els.reportLocation.value,
    departmentId: els.reportDepartment.value,
    status: els.reportStatus.value
  }, { departments: userContext.departments });
  const kpis = [
    ["Pedidos hoy", report.kpis.today],
    ["Pendientes", report.kpis.pending],
    ["Preparando", report.kpis.preparing],
    ["Parciales", report.kpis.partial],
    ["Entregados", report.kpis.delivered],
    ["Urgentes", report.kpis.urgent],
    ["Sin existencia", report.kpis.unavailable],
    ["Atención promedio", `${report.kpis.averageAttentionHours} h`]
  ];
  els.reportKpis.innerHTML = kpis.map(([label, value]) => `<div><strong>${escapeHtml(value)}</strong><span>${escapeHtml(label)}</span></div>`).join("");
  renderProductReport(els.reportTopRequested, report.requestedProducts, "Cantidad");
  renderProductReport(els.reportUnavailable, report.unavailableProducts, "Eventos");
  renderProductReport(els.reportSubstitutions, report.substitutions, "Eventos");
  els.reportDepartments.innerHTML = report.departments.length ? `<table class="report-table"><thead><tr><th>Departamento</th><th>Pedidos</th><th>Cumplimiento</th><th>Tiempo</th></tr></thead><tbody>${report.departments.map((department) => `<tr><td>${escapeHtml(department.name)}</td><td>${department.count}</td><td>${department.fulfillmentPercent}%</td><td>${department.averageAttentionHours} h</td></tr>`).join("")}</tbody></table>` : '<p class="hint">Sin datos.</p>';
  els.reportsEmpty.classList.toggle("visible", report.rows.length === 0);
}

function renderProductReport(target, rows, valueLabel) {
  target.innerHTML = rows.length ? `<table class="report-table"><thead><tr><th>Producto</th><th>${escapeHtml(valueLabel)}</th><th>Unidad</th></tr></thead><tbody>${rows.map((row) => `<tr><td>${escapeHtml(row.productName)}</td><td>${formatReportNumber(row.value)}</td><td>${escapeHtml(row.unit || "-")}</td></tr>`).join("")}</tbody></table>` : '<p class="hint">Sin datos.</p>';
}

function formatReportNumber(value) {
  return new Intl.NumberFormat("es-CR", { maximumFractionDigits: 3 }).format(Number(value) || 0);
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
    offline: "Sin conexión",
    disabled: "Nube desactivada"
  };
  const cloudLabels = {
    connected: "Conectado",
    checking: "Comprobando",
    error: "Error",
    offline: "Sin conexión",
    disabled: "Desactivado"
  };
  const currentState = online ? supabaseConnectionState : "offline";
  els.connectionBadge.textContent = labels[currentState] || labels.error;
  els.connectionBadge.classList.toggle("online", currentState === "connected");
  els.connectionBadge.classList.toggle("error", currentState === "error");
  els.supabaseStatus.textContent = cloudLabels[currentState] || cloudLabels.error;
  els.supabaseStatus.className = `cloud-status ${
    currentState === "connected" ? "ready" : currentState
  }`;
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

async function persistCurrent() {
  await saveCurrentRequisition(state.current);
}

function markPendingSync(requisition) {
  requisition.syncStatus = "pending";
}

async function persistCurrentSafely() {
  setLocalSaveState("saving");
  try {
    await enqueueLocalSave(() => persistCurrent());
    setLocalSaveState("saved");
    return true;
  } catch (error) {
    handleLocalSaveError(error);
    return false;
  }
}

function enqueueLocalSave(operation) {
  const next = localSaveChain.then(operation, operation);
  localSaveChain = next.catch(() => {});
  return next;
}

function setLocalSaveState(status) {
  const labels = {
    saving: "Guardando…",
    saved: state?.syncQueue?.length ? "Guardado · pendiente" : "Guardado",
    error: "Error al guardar"
  };
  els.autosaveState.textContent = labels[status] || labels.saved;
  els.autosaveState.classList.toggle("synced", status === "saved" && !state?.syncQueue?.length);
  els.autosaveState.classList.toggle("error", status === "error");
  els.retryLocalSaveButton.hidden = status !== "error";
}

function handleLocalSaveError(error) {
  console.error("No se pudo guardar en el dispositivo.", error);
  setLocalSaveState("error");
  toast("No se pudo guardar el pedido en este dispositivo.");
}

function renderStorageStatus() {
  const storage = getStorageDiagnostics();
  els.localStorageStatus.textContent = storage.label;
  els.localStorageStatus.title = storage.error || "";
}

function showFatalStorageError(error) {
  console.error("No se pudo cargar el almacenamiento local.", error);
  els.autosaveState.textContent = "Error al cargar datos";
  els.autosaveState.classList.add("error");
  els.retryLocalSaveButton.hidden = true;
  toast("No se pudieron cargar los datos locales. Recargue la aplicación.");
}

function toast(message) {
  els.toast.textContent = message;
  els.toast.classList.add("visible");
  window.clearTimeout(toast.timer);
  toast.timer = window.setTimeout(() => els.toast.classList.remove("visible"), 3200);
}

function setupInstallPrompt() {
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferredInstallPrompt = event;
    els.installAppButton.hidden = false;
  });
  window.addEventListener("appinstalled", () => {
    deferredInstallPrompt = null;
    els.installAppButton.hidden = true;
    toast("Aplicación instalada correctamente.");
  });
}

async function installApp() {
  if (!deferredInstallPrompt) return;
  await deferredInstallPrompt.prompt();
  const choice = await deferredInstallPrompt.userChoice;
  deferredInstallPrompt = null;
  els.installAppButton.hidden = true;
  if (choice?.outcome !== "accepted") toast("La instalación quedó cancelada.");
}

async function registerServiceWorker() {
  if (!("serviceWorker" in navigator) || location.protocol === "file:") return;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (serviceWorkerReloading) return;
    serviceWorkerReloading = true;
    window.location.reload();
  });
  try {
    const registration = await navigator.serviceWorker.register(
      `./service-worker.js?v=${encodeURIComponent(APP_VERSION)}`
    );
    if (registration.waiting && navigator.serviceWorker.controller) {
      showAppUpdate(registration.waiting);
    }
    registration.addEventListener("updatefound", () => {
      const worker = registration.installing;
      if (!worker) return;
      worker.addEventListener("statechange", () => {
        if (worker.state === "installed" && navigator.serviceWorker.controller) {
          showAppUpdate(worker);
        }
      });
    });
  } catch {
    // Offline mode remains usable even if service worker registration fails.
  }
}

function showAppUpdate(worker) {
  waitingServiceWorker = worker;
  els.updateBanner.hidden = false;
}

function applyAppUpdate() {
  if (!waitingServiceWorker) return;
  els.updateAppButton.disabled = true;
  waitingServiceWorker.postMessage({ type: "SKIP_WAITING" });
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
