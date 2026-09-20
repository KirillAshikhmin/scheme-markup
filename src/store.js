// Хранение в браузере: IndexedDB своими руками, без единой зависимости.
// База `scheme-markup`, хранилища `projects` (документ объекта), `images`
// (Blob планов) и `settings` (ключ-значение).
//
// Правило файла: потеря хранилища не должна ронять приложение. По file://
// IndexedDB доступен не везде, в приватном окне запись может отказать в любой
// момент — тогда store переходит в память, сообщает о беде подписчикам
// (панель показывает строку и советует выгрузить проект в файл) и продолжает
// работать. Данные сеанса живут в памяти в любом случае.

import { usedImageIds } from "./model.js";

export const STORE_DB_NAME = "scheme-markup";
export const STORE_DB_VERSION = 1;
export const STORE_NAMES = { projects: "projects", images: "images", settings: "settings" };
// Ниже этого порога свободного места пользователя предупреждают заранее.
export const STORE_LOW_SPACE_BYTES = 50 * 1024 * 1024;
// Открытие базы иногда не отвечает вовсе (приватное окно, заблокированная
// вкладка): ждём ограниченное время и уходим в память.
export const STORE_OPEN_TIMEOUT_MS = 4000;
// Картинка моложе этого возраста неприкосновенна: её объект мог не успеть
// досохраниться — в этой вкладке (автосохранение отложено) или в соседней,
// открытой на том же хранилище.
export const STORE_IMAGE_GRACE_MS = 5 * 60 * 1000;

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

// `imageId` задаётся, когда план приехал из чужого файла: в общей папке схема
// ссылается на картинку по идентификатору из файла, и переименовать его —
// значит развести ссылки двух браузеров.
export async function putImage(blob, imageId) {
  const id = typeof imageId === "string" && imageId ? imageId : newStoreId();
  const createdAt = Date.now();
  const written = await runTransaction(STORE_NAMES.images, "readwrite", (store) =>
    idbRequest(store.put({ id, blob, type: blob.type || "", size: blob.size || 0, createdAt })),
  );
  if (!written.ok) storeMemory.images.set(id, { blob, createdAt });
  return id;
}

export async function getImage(id) {
  if (!id) return null;
  if (storeMemory.images.has(id)) return storeMemory.images.get(id).blob;
  const read = await runTransaction(STORE_NAMES.images, "readonly", (store) => idbRequest(store.get(id)));
  return read.ok && read.result ? read.result.blob : null;
}

export async function deleteImage(id) {
  if (!id) return { ok: true };
  storeMemory.images.delete(id);
  const removed = await runTransaction(STORE_NAMES.images, "readwrite", (store) => idbRequest(store.delete(id)));
  return { ok: removed.ok || storeModeValue === "memory" };
}

// ——— уборка ———————————————————————————————————————————————————————————

// Картинки лежат общей кучей на все объекты, поэтому «ничья» — та, на которую
// не ссылается ни один объект. Чистая половина уборки: её и проверяют тесты.
//
// Два правила, оба про «лучше не тронуть, чем потерять план»:
// список объектов пуст или не список — сирот нет вовсе (нечего сверять,
// значит нечего и удалять); картинка моложе `minAgeMs` — не сирота, её объект
// мог ещё не досохраниться, в том числе в соседней вкладке.
export function orphanImageIds(projects, images, options = {}) {
  if (!Array.isArray(projects) || projects.length === 0) return [];
  const now = Number.isFinite(options.now) ? options.now : Date.now();
  const minAgeMs = Number.isFinite(options.minAgeMs) ? options.minAgeMs : STORE_IMAGE_GRACE_MS;
  const used = new Set();
  for (const project of projects) {
    for (const id of usedImageIds(project)) used.add(id);
  }
  const orphans = [];
  for (const entry of images || []) {
    const id = typeof entry === "string" ? entry : entry && entry.id;
    if (!id || used.has(id)) continue;
    const createdAt = typeof entry === "string" ? null : entry && entry.createdAt;
    // Без отметки — запись из прежних версий: она заведомо старше сеанса.
    if (Number.isFinite(createdAt) && now - createdAt < minAgeMs) continue;
    orphans.push(id);
  }
  return orphans;
}

// Не смогли прочитать — возвращаем null: удалять по неполному списку нельзя,
// так теряются чужие планы.
async function allProjectDocs() {
  const read = await runTransaction(STORE_NAMES.projects, "readonly", (store) => idbRequest(store.getAll()));
  if (!read.ok && storeModeValue === "idb") return null;
  const docs = new Map();
  for (const doc of read.result || []) docs.set(doc.id, doc);
  for (const doc of storeMemory.projects.values()) docs.set(doc.id, doc);
  return [...docs.values()];
}

// Записи, а не одни ключи: возраст картинки решает, можно ли её трогать.
export async function listImageRecords() {
  const read = await runTransaction(STORE_NAMES.images, "readonly", (store) => idbRequest(store.getAll()));
  if (!read.ok && storeModeValue === "idb") return null;
  const records = (read.result || []).map((item) => ({ id: String(item.id), createdAt: item.createdAt }));
  for (const [id, item] of storeMemory.images) records.push({ id, createdAt: item.createdAt });
  return records;
}

// Убирает подложки, которые не нужны ни одному объекту. `extraProjects` —
// то, что ещё не доехало до хранилища (только что открытый объект): его
// картинки тоже не ничьи.
export async function sweepOrphanImages(extraProjects = []) {
  const docs = await allProjectDocs();
  const stored = await listImageRecords();
  if (!docs || !stored) return { removed: 0, skipped: true };
  const orphans = orphanImageIds([...docs, ...extraProjects], stored);
  for (const id of orphans) await deleteImage(id);
  return { removed: orphans.length, skipped: false };
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

// ——— участник ——————————————————————————————————————————————————————————
//
// Кто пишет — этот браузер. Идентификатор нужен автосохранению в общую папку:
// им помечается снимок, и по нему свой файл отличается от файла соседа. Здесь
// он живёт потому, что это свойство браузера, а не объекта: попади он в
// `project.json`, он поехал бы вместе с данными — и два человека, открывшие
// один файл, снова стали бы одним участником.
export const STORE_MEMBER_KEY = "memberId";
// Запасная полка для того же идентификатора. Настройки лежат в IndexedDB, а он
// бывает недоступен (приватное окно, запрет данных сайта) — тогда `setSetting`
// уходит в память, и после перезагрузки идентификатор был бы новым. Для объекта
// это не беда, а для имени файла беда: каждая перезагрузка заводила бы в папке
// пользователя ещё один файл. Одна строка в localStorage дешевле такой беды.
const STORE_MEMBER_BACKUP = "scheme-markup-member";

let storeMemberCache = null;

function readMemberBackup() {
  try {
    if (typeof localStorage === "undefined" || !localStorage) return null;
    const saved = localStorage.getItem(STORE_MEMBER_BACKUP);
    return typeof saved === "string" && saved ? saved : null;
  } catch (error) {
    return null;
  }
}

function writeMemberBackup(id) {
  try {
    if (typeof localStorage === "undefined" || !localStorage) return;
    localStorage.setItem(STORE_MEMBER_BACKUP, id);
  } catch (error) {
    /* не сохранилось — идентификатор всё равно живёт в настройках */
  }
}

/**
 * Идентификатор этого браузера: заводится один раз при первой надобности и
 * дальше не меняется. Один на все вкладки — две вкладки одного человека над
 * одним объектом это один участник, а не два.
 */
export async function storeMemberId() {
  if (storeMemberCache) return storeMemberCache;
  const saved = await getSetting(STORE_MEMBER_KEY);
  if (typeof saved === "string" && saved) {
    storeMemberCache = saved;
    writeMemberBackup(saved);
    return saved;
  }
  // Настроек нет — но идентификатор мог уцелеть на запасной полке: чистка
  // IndexedDB не должна выдавать давнего участника за нового.
  const id = readMemberBackup() || newStoreId();
  storeMemberCache = id;
  await setSetting(STORE_MEMBER_KEY, id);
  writeMemberBackup(id);
  return id;
}

// Только для тестов: следующий вызов `storeMemberId` снова пойдёт в настройки.
export function storeForgetMember() {
  storeMemberCache = null;
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
