export const DB_NAME = "pedidos-voz-db";
export const DB_VERSION = 2;

export const STORES = Object.freeze({
  requisitions: "requisitions",
  currentRequisition: "current_requisition",
  catalog: "catalog",
  settings: "settings",
  recentNames: "recent_names",
  syncQueue: "sync_queue",
  metadata: "metadata",
  authContexts: "auth_contexts"
});

const CURRENT_KEY = "current";
const SETTINGS_KEY = "settings";

export class IndexedDbUnavailableError extends Error {
  constructor(message = "IndexedDB no está disponible en este navegador.") {
    super(message);
    this.name = "IndexedDbUnavailableError";
  }
}

export class IndexedDbRepository {
  constructor(options = {}) {
    this.indexedDB = options.indexedDBFactory || globalThis.indexedDB;
    this.dbName = options.dbName || DB_NAME;
    this.version = options.version || DB_VERSION;
    this.db = null;
  }

  async open() {
    if (this.db) return this.db;
    if (!this.indexedDB?.open) throw new IndexedDbUnavailableError();
    const request = this.indexedDB.open(this.dbName, this.version);
    request.onupgradeneeded = () => createSchema(request.result, request.transaction);
    this.db = await requestResult(request, "No se pudo abrir la base local.");
    this.db.onversionchange = () => {
      this.db?.close();
      this.db = null;
    };
    return this.db;
  }

  close() {
    this.db?.close();
    this.db = null;
  }

  async deleteDatabase() {
    this.close();
    if (!this.indexedDB?.deleteDatabase) throw new IndexedDbUnavailableError();
    await requestResult(
      this.indexedDB.deleteDatabase(this.dbName),
      "No se pudo eliminar la base local de prueba."
    );
  }

  async getRequisition(id) {
    return this.get(STORES.requisitions, id);
  }

  async saveRequisition(requisition) {
    requireId(requisition, "requisición");
    await this.put(STORES.requisitions, requisition);
    return requisition;
  }

  async saveRequisitions(requisitions) {
    await this.putMany(STORES.requisitions, requisitions, "requisición");
    return requisitions;
  }

  async getRequisitions(options = {}) {
    const {
      limit = null,
      offset = 0,
      status = "",
      requestedBy = "",
      search = "",
      dateFrom = "",
      dateTo = ""
    } = options;
    if (limit == null && !status && !requestedBy && !search && !dateFrom && !dateTo) {
      const all = await this.getAll(STORES.requisitions);
      return all.sort(compareUpdatedDescending);
    }

    const db = await this.open();
    const transaction = db.transaction(STORES.requisitions, "readonly");
    const completion = transactionDone(transaction);
    const store = transaction.objectStore(STORES.requisitions);
    const source = store.index("updatedAt");
    const items = [];
    let skipped = 0;
    let hasMore = false;
    const normalizedSearch = normalizeSearch(search);
    const normalizedResponsible = normalizeSearch(requestedBy);
    const boundedLimit = Math.max(1, Number(limit) || 20);

    await new Promise((resolve, reject) => {
      const request = source.openCursor(null, "prev");
      request.onerror = () => reject(request.error || new Error("No se pudo consultar el historial."));
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) {
          resolve();
          return;
        }
        const value = cursor.value;
        if (!matchesRequisition(value, { status, normalizedResponsible, normalizedSearch, dateFrom, dateTo })) {
          cursor.continue();
          return;
        }
        if (skipped < Math.max(0, Number(offset) || 0)) {
          skipped += 1;
          cursor.continue();
          return;
        }
        if (items.length >= boundedLimit) {
          hasMore = true;
          resolve();
          return;
        }
        items.push(value);
        cursor.continue();
      };
    });
    await completion;
    return {
      items,
      offset: Math.max(0, Number(offset) || 0),
      nextOffset: hasMore ? Math.max(0, Number(offset) || 0) + items.length : null,
      hasMore
    };
  }

  async deleteRequisition(id) {
    await this.delete(STORES.requisitions, id);
  }

  async getCurrentRequisition(scopeKey = CURRENT_KEY) {
    return (await this.get(STORES.currentRequisition, scopeKey))?.value || null;
  }

  async saveCurrentRequisition(requisition, scopeKey = CURRENT_KEY) {
    requireId(requisition, "pedido actual");
    await this.put(STORES.currentRequisition, { key: scopeKey, value: requisition });
    return requisition;
  }

  async clearCurrentRequisition(scopeKey = CURRENT_KEY) {
    await this.delete(STORES.currentRequisition, scopeKey);
  }

  async getCatalog() {
    return this.getAll(STORES.catalog);
  }

  async saveCatalog(products) {
    await this.putMany(STORES.catalog, products, "producto");
    return products;
  }

  async getSettings(scopeKey = "") {
    return (await this.get(STORES.settings, settingsKey(scopeKey)))?.value || null;
  }

  async saveSettings(settings, scopeKey = "") {
    await this.put(STORES.settings, { key: settingsKey(scopeKey), value: settings });
    return settings;
  }

  async getRecentNames(scopeKey = "") {
    const records = await this.getAll(STORES.recentNames);
    return records
      .filter((record) => (record.scopeKey || "") === scopeKey)
      .sort((a, b) => a.position - b.position)
      .map((record) => record.name);
  }

  async saveRecentNames(names, scopeKey = "") {
    const records = names.map((name, position) => ({
      id: scopeKey ? `${scopeKey}:${normalizeSearch(name)}` : normalizeSearch(name),
      name,
      position,
      ...(scopeKey ? { scopeKey } : {})
    }));
    await this.replaceRecentNamesScope(records, scopeKey);
    return names;
  }

  async replaceRecentNamesScope(records, scopeKey) {
    const db = await this.open();
    const transaction = db.transaction(STORES.recentNames, "readwrite");
    const completion = transactionDone(transaction);
    const store = transaction.objectStore(STORES.recentNames);
    await new Promise((resolve, reject) => {
      const request = store.openCursor();
      request.onerror = () => reject(request.error || new Error("No se pudieron actualizar los nombres recientes."));
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) {
          records.forEach((record) => store.put(record));
          resolve();
          return;
        }
        if ((cursor.value.scopeKey || "") === scopeKey) cursor.delete();
        cursor.continue();
      };
    });
    await completion;
  }

  async getSyncQueue() {
    const queue = await this.getAll(STORES.syncQueue);
    return queue.sort(compareCreatedDescending);
  }

  async saveSyncQueue(queue) {
    await this.replaceStore(STORES.syncQueue, queue, "entrada de sincronización");
    return queue;
  }

  async getMetadata(key) {
    return (await this.get(STORES.metadata, key))?.value;
  }

  async setMetadata(key, value) {
    await this.put(STORES.metadata, { key, value, updatedAt: new Date().toISOString() });
    return value;
  }

  async getAuthContext(userId) {
    return this.get(STORES.authContexts, userId);
  }

  async saveAuthContext(context) {
    requireId({ id: context?.userId }, "contexto de usuario");
    await this.put(STORES.authContexts, { ...context, userId: context.userId });
    return context;
  }

  async getMigrationRecords() {
    return this.getAll(STORES.metadata);
  }

  async importV10Snapshot(snapshot, metadata = []) {
    const db = await this.open();
    const transaction = db.transaction(Object.values(STORES), "readwrite");
    const completion = transactionDone(transaction);
    const requests = [];

    for (const requisition of snapshot.requisitions) {
      requests.push(transaction.objectStore(STORES.requisitions).put(requisition));
    }
    if (snapshot.currentRequisition) {
      requests.push(
        transaction.objectStore(STORES.currentRequisition).put({
          key: CURRENT_KEY,
          value: snapshot.currentRequisition
        })
      );
    }
    for (const product of snapshot.catalog) {
      requests.push(transaction.objectStore(STORES.catalog).put(product));
    }
    if (snapshot.settings) {
      requests.push(
        transaction.objectStore(STORES.settings).put({ key: SETTINGS_KEY, value: snapshot.settings })
      );
    }
    for (const [position, name] of snapshot.recentNames.entries()) {
      requests.push(
        transaction.objectStore(STORES.recentNames).put({
          id: normalizeSearch(name),
          name,
          position
        })
      );
    }
    for (const entry of snapshot.syncQueue) {
      requests.push(transaction.objectStore(STORES.syncQueue).put(entry));
    }
    for (const record of metadata) {
      requests.push(transaction.objectStore(STORES.metadata).put(record));
    }

    await Promise.all(requests.map((request) => requestResult(request)));
    await completion;
  }

  async count(storeName) {
    const db = await this.open();
    const transaction = db.transaction(storeName, "readonly");
    const completion = transactionDone(transaction);
    const count = await requestResult(transaction.objectStore(storeName).count());
    await completion;
    return count;
  }

  async get(storeName, key) {
    const db = await this.open();
    const transaction = db.transaction(storeName, "readonly");
    const completion = transactionDone(transaction);
    const value = await requestResult(transaction.objectStore(storeName).get(key));
    await completion;
    return value;
  }

  async getAll(storeName) {
    const db = await this.open();
    const transaction = db.transaction(storeName, "readonly");
    const completion = transactionDone(transaction);
    const values = await requestResult(transaction.objectStore(storeName).getAll());
    await completion;
    return values;
  }

  async put(storeName, value) {
    const db = await this.open();
    const transaction = db.transaction(storeName, "readwrite");
    const completion = transactionDone(transaction);
    await requestResult(transaction.objectStore(storeName).put(value));
    await completion;
  }

  async putMany(storeName, values, label = "registro") {
    values.forEach((value) => requireId(value, label));
    const db = await this.open();
    const transaction = db.transaction(storeName, "readwrite");
    const completion = transactionDone(transaction);
    const requests = values.map((value) => transaction.objectStore(storeName).put(value));
    await Promise.all(requests.map((request) => requestResult(request)));
    await completion;
  }

  async replaceStore(storeName, values, label = "registro") {
    values.forEach((value) => requireId(value, label));
    const db = await this.open();
    const transaction = db.transaction(storeName, "readwrite");
    const completion = transactionDone(transaction);
    const store = transaction.objectStore(storeName);
    const requests = [store.clear(), ...values.map((value) => store.put(value))];
    await Promise.all(requests.map((request) => requestResult(request)));
    await completion;
  }

  async delete(storeName, key) {
    const db = await this.open();
    const transaction = db.transaction(storeName, "readwrite");
    const completion = transactionDone(transaction);
    await requestResult(transaction.objectStore(storeName).delete(key));
    await completion;
  }
}

function createSchema(db, transaction) {
  const requisitions = ensureStore(db, transaction, STORES.requisitions, { keyPath: "id" });
  ensureIndex(requisitions, "requisitionNumber", "requisitionNumber");
  ensureIndex(requisitions, "status", "status");
  ensureIndex(requisitions, "createdAt", "createdAt");
  ensureIndex(requisitions, "updatedAt", "updatedAt");
  ensureIndex(requisitions, "requestedBy", "requestedBy");
  ensureIndex(requisitions, "organizationId", "organizationId");
  ensureIndex(requisitions, "requestedByUserId", "requestedByUserId");
  ensureIndex(requisitions, "localOwnerUserId", "localOwnerUserId");

  ensureStore(db, transaction, STORES.currentRequisition, { keyPath: "key" });
  ensureStore(db, transaction, STORES.catalog, { keyPath: "id" });
  ensureStore(db, transaction, STORES.settings, { keyPath: "key" });
  ensureStore(db, transaction, STORES.recentNames, { keyPath: "id" });
  const syncQueue = ensureStore(db, transaction, STORES.syncQueue, { keyPath: "id" });
  ensureIndex(syncQueue, "status", "status");
  ensureIndex(syncQueue, "createdAt", "createdAt");
  ensureIndex(syncQueue, "nextRetryAt", "nextRetryAt");
  ensureIndex(syncQueue, "organizationId", "organizationId");
  ensureIndex(syncQueue, "userId", "userId");
  ensureStore(db, transaction, STORES.metadata, { keyPath: "key" });
  ensureStore(db, transaction, STORES.authContexts, { keyPath: "userId" });
}

function ensureStore(db, transaction, name, options) {
  if (db.objectStoreNames.contains(name)) {
    return transaction.objectStore(name);
  }
  return db.createObjectStore(name, options);
}

function ensureIndex(store, name, keyPath) {
  if (!store.indexNames.contains(name)) store.createIndex(name, keyPath, { unique: false });
}

function requireId(value, label) {
  if (!value?.id) throw new TypeError(`La ${label} no tiene un ID válido.`);
}

function settingsKey(scopeKey) {
  return scopeKey ? `${SETTINGS_KEY}:${scopeKey}` : SETTINGS_KEY;
}

function requestResult(request, fallbackMessage = "La operación local no se pudo completar.") {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error(fallbackMessage));
  });
}

function transactionDone(transaction) {
  return new Promise((resolve, reject) => {
    if (transaction.error) {
      reject(transaction.error);
      return;
    }
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error || new Error("La transacción local fue cancelada."));
    transaction.onerror = () => reject(transaction.error || new Error("La transacción local falló."));
  });
}

function normalizeSearch(value) {
  return String(value || "")
    .trim()
    .toLocaleLowerCase("es")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function matchesRequisition(requisition, filters) {
  if (filters.status && requisition.status !== filters.status) return false;
  if (filters.dateFrom && requisition.createdAt < filters.dateFrom) return false;
  if (filters.dateTo && requisition.createdAt > filters.dateTo) return false;
  const responsible = normalizeSearch(requisition.requestedBy);
  if (filters.normalizedResponsible && !responsible.includes(filters.normalizedResponsible)) return false;
  if (filters.normalizedSearch) {
    const haystack = normalizeSearch(`${requisition.requisitionNumber} ${requisition.requestedBy}`);
    if (!haystack.includes(filters.normalizedSearch)) return false;
  }
  return true;
}

function compareUpdatedDescending(a, b) {
  return String(b.updatedAt || b.createdAt || "").localeCompare(String(a.updatedAt || a.createdAt || ""));
}

function compareCreatedDescending(a, b) {
  return String(b.createdAt || "").localeCompare(String(a.createdAt || ""));
}
