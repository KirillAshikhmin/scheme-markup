// Файл проекта на диске: приёмка загруженного архива, автосохранение в папку
// и отметка «когда в последний раз выгружали».
//
// Почему отдельно от панели: здесь нет ни одной строки DOM — значит, приёмку
// загрузки (самое опасное место: чужие идентификаторы) можно проверить тестом,
// а панель остаётся тонкой. Zip читает и пишет только `projectFile.js`.
import { getImage, getSetting, setSetting } from "./store.js";
import { packProject, projectFileName, verifyProjectFile } from "./projectFile.js";
import { updateProject } from "./model.js";
import { strings, text } from "./strings.js";

// Ключи настроек: ручка папки (структурно клонируется в IndexedDB как есть)
// и отметки последней выгрузки по объектам.
const AUTOSAVE_FOLDER_KEY = "autosaveFolder";
const AUTOSAVE_EXPORT_KEY = "lastFileExport";
// Задержка больше, чем у сохранения в браузер (400 мс): запись на диск дороже,
// и пачка правок должна уложиться в одну запись.
const AUTOSAVE_DELAY_MS = 1500;
// Как часто снимок в папке перечитывается с диска и сверяется с объектом.
const AUTOSAVE_VERIFY_MS = 10 * 60 * 1000;

let autosaveHandle = null;
let autosavePermission = "none"; // none | prompt | granted | denied
let autosaveExports = null;
let autosaveTimer = null;
let autosaveRunning = false;
let autosavePending = null;
let autosaveLastError = null;
let autosaveVerified = null;
const autosaveListeners = new Set();

// ——— приёмка загруженного файла ———————————————————————————————————————

// Архив приходит с чужими идентификаторами: и объекта, и картинок. Оставить их
// как есть нельзя — вторая загрузка того же файла перезаписала бы объект в базе
// и перемешала картинки с чужими. Поэтому всё переприсваивается здесь, разом,
// вместе со ссылками `scheme.imageId`; ссылка на картинку, которой в архиве не
// оказалось, обнуляется — схема без плана честнее схемы со ссылкой в никуда.
export function adoptLoadedProject(loaded, options = {}) {
  const source = loaded && loaded.project ? loaded.project : null;
  if (!source) throw new Error(strings.errors.foreignProject);
  const mode = options.mode === "replace" ? "replace" : "new";
  const newId = typeof options.newId === "function" ? options.newId : () => crypto.randomUUID();

  const sourceImages = loaded.images instanceof Map ? loaded.images : new Map(loaded.images || []);
  // Идентификаторы картинок приходят снаружи, когда их уже выдало хранилище
  // браузера (`store.putImage`): переприсваивание остаётся одной операцией,
  // и панели не приходится перекладывать ссылки второй раз.
  const given = options.imageIds instanceof Map ? options.imageIds : null;
  const remap = new Map();
  const images = new Map();
  for (const [oldId, blob] of sourceImages) {
    if (!blob) continue;
    const id = (given && given.get(oldId)) || newId();
    remap.set(oldId, id);
    images.set(id, blob);
  }

  const schemes = (source.schemes || []).map((scheme) => ({
    ...scheme,
    imageId: scheme.imageId && remap.has(scheme.imageId) ? remap.get(scheme.imageId) : null,
  }));

  const base = {
    ...source,
    id: mode === "replace" && options.currentId ? options.currentId : newId(),
    schemes,
  };
  // Отметку времени ставит модель: свой мутатор объекта в сборке не заводится.
  return { project: updateProject(base).project, images, mode };
}

// Картинки текущего объекта для упаковки: `packProject` принимает только Map.
async function autosaveCollectImages(project) {
  const images = new Map();
  for (const scheme of (project && project.schemes) || []) {
    if (!scheme.imageId || images.has(scheme.imageId)) continue;
    const blob = await getImage(scheme.imageId);
    if (blob) images.set(scheme.imageId, blob);
  }
  return images;
}

// Имя снимка в папке автосохранения. Файл в папке живёт рядом с чужими и
// переписывается сам, поэтому одного имени объекта мало: два объекта с
// одинаковым именем (а такие заводятся сами — например, файл, загруженный
// дважды) писали бы в один файл и затирали друг друга. Имя строит всё тот же
// `projectFileName`, идентификатор дописывается к нему.
export function autosaveSnapshotName(project, date) {
  const base = projectFileName(project, date);
  const tag = String((project && project.id) || "").replace(/[^0-9a-z]/gi, "").slice(0, 8).toLowerCase();
  return tag ? base.replace(/\.zip$/, "-" + tag + ".zip") : base;
}

function autosaveVerifyKey(project, images) {
  const ids = images instanceof Map ? [...images.keys()] : [];
  return String((project && project.id) || "") + "|" + ids.sort().join(",");
}

// Сверять каждую запись в папку не нужно и вредно: правки идут пачками раз в
// полторы секунды, а сверка — полный проход по всем планам объекта (на десятке
// планов по паре мегабайт это сотни миллисекунд на каждую правку, и они лягут
// на тот же поток, что рисует холст). Сбой записи — свойство не отдельной
// правки, а пары «эти данные + этот браузер»: если архив из этих планов
// собрался верно, через минуту он соберётся так же. Меняется это ровно тогда,
// когда меняется состав планов. Поэтому сверяются: первая запись в папку,
// первая после ошибки, первая после смены состава планов — и дальше не реже
// раза в десять минут. Запись «Сохранить в файл» сверяется всегда: этот файл
// пользователь уносит с собой как резервную копию.
export function autosaveVerifyDue(project, images, now) {
  if (autosaveLastError) return true;
  if (!autosaveVerified) return true;
  if (autosaveVerified.key !== autosaveVerifyKey(project, images)) return true;
  const moment = now instanceof Date ? now.getTime() : Date.now();
  return moment - autosaveVerified.at >= AUTOSAVE_VERIFY_MS;
}

// Новая папка — снимок в ней ещё ни разу не проверен.
export function autosaveResetVerify() {
  autosaveVerified = null;
}

function autosaveMarkVerified(project, images, date) {
  autosaveVerified = {
    key: autosaveVerifyKey(project, images),
    at: (date instanceof Date ? date : new Date()).getTime(),
  };
}

// Один путь упаковки на всю панель: и «Сохранить в файл», и запись в папку.
export async function autosavePack(project, options = {}) {
  const images = await autosaveCollectImages(project);
  const date = options.date instanceof Date ? options.date : new Date();
  const blob = await packProject(project, images, {
    date,
    onProgress: options.onProgress,
    verify: options.verify,
  });
  return { blob, name: projectFileName(project, date), images };
}

// ——— папка ————————————————————————————————————————————————————————————

function autosaveSupported() {
  return typeof window !== "undefined" && typeof window.showDirectoryPicker === "function";
}

export function autosaveReady() {
  return Boolean(autosaveHandle) && autosavePermission === "granted";
}

export function autosaveStatus() {
  return {
    supported: autosaveSupported(),
    folder: autosaveHandle ? autosaveHandle.name : null,
    permission: autosavePermission,
    busy: autosaveRunning,
    error: autosaveLastError,
  };
}

export function onAutosaveChange(listener) {
  autosaveListeners.add(listener);
  return () => autosaveListeners.delete(listener);
}

function autosaveAnnounce() {
  const status = autosaveStatus();
  for (const listener of [...autosaveListeners]) {
    try {
      listener(status);
    } catch (ignored) {
      /* подписчик не должен ломать запись */
    }
  }
}

async function autosaveQueryPermission(handle) {
  if (!handle) return "none";
  if (typeof handle.queryPermission !== "function") return "granted";
  try {
    return await handle.queryPermission({ mode: "readwrite" });
  } catch (error) {
    return "denied";
  }
}

// При старте: ручка из прошлого сеанса ещё жива, но разрешение могло
// «остыть» — тогда панель покажет кнопку «Разрешить», и второй раз выбирать
// папку не придётся.
export async function autosaveRestore() {
  autosaveExports = (await getSetting(AUTOSAVE_EXPORT_KEY)) || {};
  if (!autosaveSupported()) return autosaveStatus();
  let handle = null;
  try {
    handle = await getSetting(AUTOSAVE_FOLDER_KEY);
  } catch (error) {
    handle = null;
  }
  if (!handle || typeof handle.getFileHandle !== "function") {
    autosaveHandle = null;
    autosavePermission = "none";
    return autosaveStatus();
  }
  autosaveHandle = handle;
  autosavePermission = await autosaveQueryPermission(handle);
  autosaveAnnounce();
  return autosaveStatus();
}

// Только из обработчика клика: браузер спрашивает папку лишь по жесту.
export async function autosavePickFolder() {
  if (!autosaveSupported()) return autosaveStatus();
  const handle = await window.showDirectoryPicker({ id: "scheme-markup", mode: "readwrite" });
  autosaveHandle = handle;
  autosavePermission = await autosaveQueryPermission(handle);
  if (autosavePermission !== "granted") await autosaveGrant();
  autosaveLastError = null;
  autosaveResetVerify();
  await setSetting(AUTOSAVE_FOLDER_KEY, handle);
  autosaveAnnounce();
  return autosaveStatus();
}

export async function autosaveGrant() {
  if (!autosaveHandle || typeof autosaveHandle.requestPermission !== "function") return autosaveStatus();
  try {
    autosavePermission = await autosaveHandle.requestPermission({ mode: "readwrite" });
  } catch (error) {
    autosavePermission = "denied";
  }
  autosaveAnnounce();
  return autosaveStatus();
}

export async function autosaveForget() {
  autosaveHandle = null;
  autosavePermission = "none";
  autosaveLastError = null;
  autosaveResetVerify();
  if (autosaveTimer) {
    clearTimeout(autosaveTimer);
    autosaveTimer = null;
  }
  autosavePending = null;
  await setSetting(AUTOSAVE_FOLDER_KEY, null);
  autosaveAnnounce();
  return autosaveStatus();
}

// ——— запись ———————————————————————————————————————————————————————————

export async function autosaveWrite(project, options = {}) {
  if (!project) return { ok: false, reason: "noProject" };
  if (!autosaveReady()) return { ok: false, reason: "noFolder" };
  autosaveRunning = true;
  autosaveAnnounce();
  try {
    const date = options.date instanceof Date ? options.date : new Date();
    // Сверку здесь делает не упаковка, а чтение уже записанного файла: так
    // проверка захватывает и запись на диск, а не только сборку в памяти.
    const packedFile = await autosavePack(project, { ...options, date, verify: false });
    const name = autosaveSnapshotName(project, date);
    const fileHandle = await autosaveHandle.getFileHandle(name, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(packedFile.blob);
    await writable.close();
    const due =
      options.verify === true ||
      (options.verify !== false && autosaveVerifyDue(project, packedFile.images, date));
    if (due) {
      const written =
        typeof fileHandle.getFile === "function" ? await fileHandle.getFile() : packedFile.blob;
      await verifyProjectFile(written, project, packedFile.images);
      autosaveMarkVerified(project, packedFile.images, date);
    }
    autosaveLastError = null;
    const at = await autosaveNoteExport(project.id, options.at);
    // Объект возвращается вместе с результатом: пока шла запись, пользователь
    // мог успеть поправить ещё раз — панели надо знать, что именно легло в файл.
    return { ok: true, name, at, project };
  } catch (error) {
    // Разрешение могли отозвать между правками — тогда панель снова покажет
    // кнопку «Разрешить», а не будет молча терять записи.
    if (error && error.name === "NotAllowedError") autosavePermission = "prompt";
    autosaveLastError = error;
    return { ok: false, error };
  } finally {
    autosaveRunning = false;
    autosaveAnnounce();
  }
}

// Правки идут пачками: пишем не чаще, чем раз в AUTOSAVE_DELAY_MS, и никогда
// двумя записями сразу — правка, пришедшая во время записи, ждёт её конца.
export function autosaveSchedule(project, options = {}) {
  if (!autosaveReady() || !project) return false;
  autosavePending = project;
  if (autosaveTimer) clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(() => {
    autosaveTimer = null;
    autosaveFlush(options);
  }, typeof options.delay === "number" ? options.delay : AUTOSAVE_DELAY_MS);
  return true;
}

// Есть ли незаписанная правка: отложенная, ожидающая очереди или та, что
// пишется прямо сейчас. Вкладка спрашивает об этом перед закрытием.
export function autosavePendingWrite() {
  return Boolean(autosaveTimer || autosavePending || autosaveRunning);
}

export async function autosaveFlush(options = {}) {
  if (autosaveTimer) {
    clearTimeout(autosaveTimer);
    autosaveTimer = null;
  }
  if (autosaveRunning || !autosavePending) return { ok: false, reason: "idle" };
  const project = autosavePending;
  autosavePending = null;
  const result = await autosaveWrite(project, options);
  if (typeof options.onDone === "function") options.onDone(result);
  // Пока писали, могла прийти новая правка — её запись ставим в очередь.
  if (autosavePending) autosaveSchedule(autosavePending, options);
  return result;
}

// ——— «выгружено N назад» ———————————————————————————————————————————————

export async function autosaveNoteExport(projectId, at) {
  const stamp = at || new Date().toISOString();
  if (!projectId) return stamp;
  if (!autosaveExports) autosaveExports = (await getSetting(AUTOSAVE_EXPORT_KEY)) || {};
  autosaveExports = { ...autosaveExports, [projectId]: stamp };
  await setSetting(AUTOSAVE_EXPORT_KEY, autosaveExports);
  autosaveAnnounce();
  return stamp;
}

export function autosaveLastExport(projectId) {
  if (!projectId || !autosaveExports) return null;
  return autosaveExports[projectId] || null;
}

// Русские числительные: «1 минуту», «2 минуты», «5 минут». Одиннадцать —
// исключение из правила последней цифры, поэтому второй десяток проверяется
// отдельно.
function autosavePlural(count, forms) {
  const tail = Math.abs(count) % 100;
  const last = tail % 10;
  if (tail > 10 && tail < 20) return forms[2];
  if (last === 1) return forms[0];
  if (last > 1 && last < 5) return forms[1];
  return forms[2];
}

// «в файл выгружено: 3 дня назад». Момент сравнения передаётся явно — так
// строку можно проверить тестом, не подменяя часы.
export function autosaveAgoText(at, now) {
  const words = strings.autosave.ago;
  const stamp = at ? Date.parse(at) : Number.NaN;
  if (Number.isNaN(stamp)) return words.never;
  const moment = now instanceof Date ? now.getTime() : Date.now();
  const minutes = Math.floor(Math.max(0, moment - stamp) / 60000);
  if (minutes < 1) return words.justNow;
  if (minutes < 60) return text("autosave.ago.pattern", { count: minutes, word: autosavePlural(minutes, words.minutes) });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return text("autosave.ago.pattern", { count: hours, word: autosavePlural(hours, words.hours) });
  const days = Math.floor(hours / 24);
  return text("autosave.ago.pattern", { count: days, word: autosavePlural(days, words.days) });
}
