// Хранение в браузере: IndexedDB своими руками, без единой зависимости.
// База `scheme-markup`, хранилища `projects` (документ объекта), `images`
// (Blob планов) и `settings` (ключ-значение).
//
// Правило файла: потеря хранилища не должна ронять приложение. По file://
// IndexedDB доступен не везде, в приватном окне запись может отказать в любой
// момент — тогда store переходит в память, сообщает о беде подписчикам
// (панель показывает строку и советует выгрузить проект в файл) и продолжает
// работать. Данные сеанса живут в памяти в любом случае.

export const STORE_DB_NAME = "scheme-markup";
export const STORE_DB_VERSION = 1;
export const STORE_NAMES = { projects: "projects", images: "images", settings: "settings" };
// Ниже этого порога свободного места пользователя предупреждают заранее.
export const STORE_LOW_SPACE_BYTES = 50 * 1024 * 1024;
// Открытие базы иногда не отвечает вовсе (приватное окно, заблокированная
// вкладка): ждём ограниченное время и уходим в память.
export const STORE_OPEN_TIMEOUT_MS = 4000;

const storeMemory = { projects: new Map(), images: new Map(), settings: new Map() };
const storeListeners = new Set();
let storeDb = null;
let storeModeValue = "unknown";
let storeOpening = null;
let storeReported = false;
let storeWriteReported = false;

export function storeMode() {
  return storeModeValue;
}

export function onStoreProblem(listener) {
  storeListeners.add(listener);
  return () => storeListeners.delete(listener);
}

function reportStoreProblem(kind, error) {
  const problem = { kind, error: error || null };
  for (const listener of [...storeListeners]) {
    try {
      listener(problem);
    } catch (ignored) {
      /* подписчик не должен ломать запись */
    }
  }
}

function newStoreId() {
  return crypto.randomUUID();
}

function idbRequest(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("indexeddb-failed"));
  });
}

function openDatabase() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined" || indexedDB === null) {
      reject(new Error("indexeddb-unavailable"));
      return;
    }
    let settled = false;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      fn(value);
    };
    const timer = setTimeout(() => finish(reject, new Error("indexeddb-timeout")), STORE_OPEN_TIMEOUT_MS);
    let request;
    try {
      request = indexedDB.open(STORE_DB_NAME, STORE_DB_VERSION);
    } catch (error) {
      clearTimeout(timer);
      finish(reject, error);
      return;
    }
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAMES.projects)) {
        db.createObjectStore(STORE_NAMES.projects, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(STORE_NAMES.images)) {
        db.createObjectStore(STORE_NAMES.images, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(STORE_NAMES.settings)) {
        db.createObjectStore(STORE_NAMES.settings, { keyPath: "key" });
      }
    };
    request.onsuccess = () => {
      clearTimeout(timer);
      finish(resolve, request.result);
    };
    request.onerror = () => {
      clearTimeout(timer);
      finish(reject, request.error || new Error("indexeddb-failed"));
    };
    request.onblocked = () => {
      clearTimeout(timer);
      finish(reject, new Error("indexeddb-blocked"));
    };
  });
}

export async function openStore() {
  if (storeModeValue !== "unknown") return storeModeValue;
  if (!storeOpening) {
    storeOpening = openDatabase()
      .then((db) => {
        storeDb = db;
        storeModeValue = "idb";
        db.onclose = () => degradeToMemory(new Error("indexeddb-closed"));
        return storeModeValue;
      })
      .catch((error) => {
        degradeToMemory(error);
        return storeModeValue;
      });
  }
  return storeOpening;
}

function degradeToMemory(error) {
  storeDb = null;
  storeModeValue = "memory";
  if (storeReported) return;
  storeReported = true;
  reportStoreProblem("unavailable", error);
}

// Одна транзакция — одно действие: запись документа объекта атомарна, вкладка,
// закрытая посреди сохранения, оставляет прежнее состояние, а не половину.
async function runTransaction(name, mode, action) {
  await openStore();
  if (storeModeValue !== "idb" || !storeDb) return { ok: false, memory: true };
  try {
    return await new Promise((resolve, reject) => {
      const tx = storeDb.transaction(name, mode);
      let result;
      tx.oncomplete = () => {
        if (mode === "readwrite") storeWriteReported = false;
        resolve({ ok: true, result });
      };
      tx.onerror = () => reject(tx.error || new Error("indexeddb-failed"));
      tx.onabort = () => reject(tx.error || new Error("indexeddb-aborted"));
      Promise.resolve(action(tx.objectStore(name)))
        .then((value) => {
          result = value;
        })
        .catch((error) => {
          try {
            tx.abort();
          } catch (ignored) {
            /* транзакция уже завершилась */
          }
          reject(error);
        });
    });
  } catch (error) {
    // Автосохранение идёт на каждую правку: об отказавшей записи говорим один
    // раз — до тех пор, пока запись снова не пройдёт.
    if (mode === "readwrite" && !storeWriteReported) {
      storeWriteReported = true;
      reportStoreProblem("writeFailed", error);
    }
    return { ok: false, error };
  }
}

// ——— объекты ——————————————————————————————————————————————————————————

export async function listProjects() {
  const summaries = new Map();
  const read = await runTransaction(STORE_NAMES.projects, "readonly", (store) => idbRequest(store.getAll()));
  if (read.ok) {
    for (const doc of read.result || []) summaries.set(doc.id, summaryOf(doc));
  }
  for (const doc of storeMemory.projects.values()) summaries.set(doc.id, summaryOf(doc));
  return [...summaries.values()].sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
}

function summaryOf(project) {
  return {
    id: project.id,
    name: project.name,
    updatedAt: project.updatedAt,
    schemes: (project.schemes || []).length,
    marks: (project.marks || []).length,
  };
}

export async function loadProject(id) {
  if (!id) return null;
  if (storeMemory.projects.has(id)) return storeMemory.projects.get(id);
  const read = await runTransaction(STORE_NAMES.projects, "readonly", (store) => idbRequest(store.get(id)));
  return read.ok && read.result ? read.result : null;
}

// Отказ записи не теряет работу: документ остаётся в памяти сеанса, а панель
// получает повод предложить выгрузку в файл.
export async function saveProject(project) {
  if (!project || !project.id) return { ok: false };
  const written = await runTransaction(STORE_NAMES.projects, "readwrite", (store) =>
    idbRequest(store.put(project)),
  );
  if (written.ok) {
    storeMemory.projects.delete(project.id);
    return { ok: true, mode: "idb" };
  }
  storeMemory.projects.set(project.id, project);
  return { ok: false, mode: "memory", error: written.error || null };
}

export async function deleteProject(id) {
  storeMemory.projects.delete(id);
  const removed = await runTransaction(STORE_NAMES.projects, "readwrite", (store) => idbRequest(store.delete(id)));
  return { ok: removed.ok || storeModeValue === "memory" };
}

// ——— изображения ——————————————————————————————————————————————————————

export async function putImage(blob) {
  const id = newStoreId();
  const written = await runTransaction(STORE_NAMES.images, "readwrite", (store) =>
    idbRequest(store.put({ id, blob, type: blob.type || "", size: blob.size || 0 })),
  );
  if (!written.ok) storeMemory.images.set(id, blob);
  return id;
}

export async function getImage(id) {
  if (!id) return null;
  if (storeMemory.images.has(id)) return storeMemory.images.get(id);
  const read = await runTransaction(STORE_NAMES.images, "readonly", (store) => idbRequest(store.get(id)));
  return read.ok && read.result ? read.result.blob : null;
}

export async function deleteImage(id) {
  if (!id) return { ok: true };
  storeMemory.images.delete(id);
  const removed = await runTransaction(STORE_NAMES.images, "readwrite", (store) => idbRequest(store.delete(id)));
  return { ok: removed.ok || storeModeValue === "memory" };
}

// ——— настройки ————————————————————————————————————————————————————————

export async function getSetting(key) {
  if (storeMemory.settings.has(key)) return storeMemory.settings.get(key);
  const read = await runTransaction(STORE_NAMES.settings, "readonly", (store) => idbRequest(store.get(key)));
  return read.ok && read.result ? read.result.value : null;
}

export async function setSetting(key, value) {
  const written = await runTransaction(STORE_NAMES.settings, "readwrite", (store) =>
    idbRequest(store.put({ key, value })),
  );
  if (written.ok) storeMemory.settings.delete(key);
  else storeMemory.settings.set(key, value);
  return { ok: written.ok };
}

// ——— место ————————————————————————————————————————————————————————————

export async function estimateSpace() {
  const empty = { usage: null, quota: null, free: null, low: false };
  if (typeof navigator === "undefined" || !navigator.storage || !navigator.storage.estimate) return empty;
  try {
    const { usage, quota } = await navigator.storage.estimate();
    if (typeof quota !== "number" || typeof usage !== "number") return empty;
    const free = Math.max(0, quota - usage);
    return { usage, quota, free, low: free < STORE_LOW_SPACE_BYTES };
  } catch (error) {
    return empty;
  }
}
