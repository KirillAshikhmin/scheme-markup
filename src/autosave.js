// Файл проекта на диске: приёмка загруженного архива, автосохранение в папку
// и отметка «когда в последний раз выгружали».
//
// Почему отдельно от панели: здесь нет ни одной строки DOM — значит, приёмку
// загрузки (самое опасное место: чужие идентификаторы) можно проверить тестом,
// а панель остаётся тонкой. Zip читает и пишет только `projectFile.js`.
import { getImage, putImage, getSetting, setSetting, storeMemberId } from "./store.js";
import {
  packProject,
  projectFileBase,
  projectFileName,
  unpackProject,
  verifyProjectFile,
} from "./projectFile.js";
import { mergeProjects, areRelatedProjects } from "./merge.js";
import { updateProject } from "./model.js";
import { strings, text } from "./strings.js";

// Ключи настроек: ручка папки (структурно клонируется в IndexedDB как есть)
// и отметки последней выгрузки по объектам.
const AUTOSAVE_FOLDER_KEY = "autosaveFolder";
const AUTOSAVE_EXPORT_KEY = "lastFileExport";
// Файлы, про которые человек уже сказал «оставить». Ответ переживает
// перезагрузку: спрашивать о том же во второй раз — значит мозолить глаза.
// Хранится по имени файла; имя несёт хвосты объекта и участника, так что
// спутать его с файлом из другой папки практически нечем.
const AUTOSAVE_STALE_KEY = "staleKept";
// Задержка больше, чем у сохранения в браузер (400 мс): запись на диск дороже,
// и пачка правок должна уложиться в одну запись.
const AUTOSAVE_DELAY_MS = 1500;
// Как часто снимок в папке перечитывается с диска и сверяется с объектом.
const AUTOSAVE_VERIFY_MS = 10 * 60 * 1000;
// Как часто заглядывать в папку за чужими правками. Пять секунд: синхронизацию
// файлов делает не наш код (WebDAV, облачный диск), и до папки чужая правка
// доезжает секундами; человек за это время не успевает уйти далеко, а сам опрос
// читает только служебные данные о файлах — тела архивов не трогаются, пока не
// изменилось время записи.
const AUTOSAVE_WATCH_MS = 5000;

let autosaveHandle = null;
let autosavePermission = "none"; // none | prompt | granted | denied
// Идентификатор участника — этого браузера. Читается из настроек один раз за
// сеанс: имя снимка собирается на каждой записи, а ходить за ним в хранилище
// каждый раз незачем.
let autosaveMember = null;
let autosaveExports = null;
let autosaveStaleKept = null;
let autosaveTimer = null;
let autosaveRunning = false;
let autosavePending = null;
let autosaveLastError = null;
let autosaveVerified = null;
// Последний снимок, который видели обе стороны: общий предок для слияния.
let autosaveBase = null;
// Время записи нашего снимка в папку. Всё, что старше, мы уже учли — и это
// же защита от «протухшего» файла соседа: попади он в слияние, откатил бы нашу
// работу. Свои снимки отсекаются раньше и по имени (`autosaveOwnSnapshot`).
let autosaveSyncSince = 0;
// Что мы уже прочитали из папки: имя файла -> время его записи. Общая
// отметка времени тут не годится — в папке пишут трое, и файл второго,
// прочитанный после файла третьего, иначе остался бы незамеченным.
let autosaveSeen = new Map();
let autosaveWatchTimer = null;
let autosaveWatchBusy = false;
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

// Восемь знаков идентификатора — хвост, годный для имени файла.
function autosaveTag(value) {
  return String(value || "").replace(/[^0-9a-z]/gi, "").slice(0, 8).toLowerCase();
}

/**
 * Идентификатор участника — этого браузера. Заводится при первой надобности и
 * дальше не меняется; живёт в настройках хранилища, а не в объекте.
 */
export async function autosaveMemberId() {
  if (!autosaveMember) autosaveMember = await storeMemberId();
  return autosaveMember;
}

/**
 * Имя снимка в папке автосохранения: «<объект>-<хвост объекта>-<хвост
 * участника>.zip», **без даты**.
 *
 * Дата тут была бы новым файлом на каждый день: за неделю в папке копилась
 * неделя снимков, и вчерашний приезжал в слияние как чужая работа — возвращал
 * удалённое и путал номера. Файл один и переписывается сам, а когда он записан,
 * видно по времени файла. Дата живёт в имени ручной выгрузки
 * (`projectFile.projectFileName`): это копия «на память», и там она полезна.
 *
 * Хвостов два, и они про разное. Хвост объекта отвечает «какой объект»: два
 * объекта с одинаковым именем заводятся сами (файл, загруженный дважды) и без
 * него писали бы в один файл. Хвост участника отвечает «чья это копия» — он и
 * есть признак своего файла. Раньше эту роль исполнял хвост объекта, но
 * идентификатор объекта едет вместе с данными: копия профиля, восстановленная
 * база, объект, открытый с заменой, — и два браузера писали бы в один файл, а
 * работа соседа читалась бы как своя и не приезжала вовсе.
 *
 * Пока участник не прочитан (до `autosaveRestore`), имя собирается по-старому,
 * без хвоста участника: так вызов не выдумывает третьего имени файла.
 */
export function autosaveSnapshotName(project, member = autosaveMember) {
  const base = projectFileBase(project);
  const object = autosaveTag(project && project.id);
  // Участник — только строка: вторым доводом когда-то шла дата, и молчаливое
  // «сойдёт за идентификатор» дало бы третье имя файла.
  const writer = typeof member === "string" ? autosaveTag(member) : "";
  const tail = [object, writer].filter(Boolean).join("-");
  return tail ? base + "-" + tail + ".zip" : base + ".zip";
}

/**
 * Снимок **этого** объекта, писанный нами, — по имени, без чтения архива.
 * Узнаются разом: сегодняшний снимок, снимки прежних дней (у них в имени
 * стояла ещё и дата), снимок от прежнего имени объекта и снимок прежней
 * сборки, помеченный одним лишь хвостом объекта.
 *
 * Хвоста нужно два, и порядок важен: имя собирается как
 * «<объект>-<хвост объекта>-<хвост участника>.zip». По одному лишь хвосту
 * участника своим считался **любой** файл этого браузера — и в списке прежних
 * файлов «Белого дома» оказывалась «Данкова 60-142721c8-b06278c4.zip», чужой
 * объект, который окно предлагало удалить. Хвост участника отвечает «наш
 * браузер», хвост объекта — «этот объект»; на вопрос «мой ли это файл» нужны
 * оба ответа.
 */
export function autosaveOwnSnapshot(project, name, member = autosaveMember) {
  if (typeof name !== "string") return false;
  const object = autosaveTag(project && project.id);
  if (!object) return false;
  const lower = name.toLowerCase();
  const writer = typeof member === "string" ? autosaveTag(member) : "";
  if (writer && lower.endsWith("-" + object + "-" + writer + ".zip")) return true;
  // Прежние сборки ставили хвост объекта последним — и дата перед ним не мешает.
  return lower.endsWith("-" + object + ".zip");
}

/**
 * Файл этого браузера — неважно, для какого объекта. Нужен опросу папки: наш
 * же файл, пусть и от соседнего объекта, это не чужая работа и в слияние не
 * идёт. Особенно важно для объекта, заведённого загрузкой того же файла: у
 * двух таких объектов общие идентификаторы схем и меток, и `areRelatedProjects`
 * посчитал бы их роднёй.
 */
export function autosaveOurFile(name, member = autosaveMember) {
  const writer = typeof member === "string" ? autosaveTag(member) : "";
  if (!writer || typeof name !== "string") return false;
  return name.toLowerCase().endsWith("-" + writer + ".zip");
}

// Писал ли этот файл наш браузер — по тому, что лежит внутри, безразлично к
// объекту. Отметка участника отвечает прямо; у файла прежней сборки её нет, и
// тогда судить можно только по объекту внутри.
function autosaveWroteArchive(project, loaded, member) {
  if (!loaded || !loaded.project) return false;
  if (loaded.member) return Boolean(member) && loaded.member === member;
  return Boolean(project && project.id) && loaded.project.id === project.id;
}

/**
 * Наш снимок **этого** объекта — по тому, что лежит внутри. Только такой файл
 * попадает в список прежних и только его можно удалить по просьбе.
 *
 * Два условия, и оба обязательны: внутри наш объект и писал файл наш браузер.
 * Раньше хватало отметки участника, и снимок соседнего объекта, открытый на
 * проверку перед удалением, эту проверку **проходил**.
 *
 * Чужая отметка по-прежнему перевешивает совпадение объекта: файл с нашим
 * объектом внутри, но помеченный соседом, — это его работа, и она идёт в
 * слияние, а не в список на удаление.
 */
export function autosaveOwnArchive(project, loaded, member = autosaveMember) {
  if (!project || !project.id || !loaded || !loaded.project) return false;
  if (loaded.project.id !== project.id) return false;
  return autosaveWroteArchive(project, loaded, member);
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
    member: options.member,
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
  // Имя снимка собирается синхронно (панель показывает его в диалоге), а
  // участник живёт в хранилище — значит, прочитать его надо до того, как имя
  // кому-то понадобится. Старт панели ждёт `autosaveRestore`, и это место.
  await autosaveMemberId();
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
  autosaveResetSync();
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
  autosaveResetSync();
  autosaveStopWatch();
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
    // Участник читается до имени файла: сперва «кто пишет», потом «куда».
    const member = await autosaveMemberId();
    const packedFile = await autosavePack(project, { ...options, date, member, verify: false });
    const name = autosaveSnapshotName(project, member);
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
      await verifyProjectFile(written, project, packedFile.images, { member });
      autosaveMarkVerified(project, packedFile.images, date);
    }
    autosaveLastError = null;
    // Записанный снимок — новая общая точка отсчёта: с ней сливаются чужие
    // правки, и по её времени отсекаются файлы, которые мы уже учли.
    autosaveBase = project;
    if (typeof fileHandle.getFile === "function") {
      const stamp = await fileHandle.getFile();
      autosaveSyncSince = Math.max(autosaveSyncSince, stamp.lastModified || 0);
      autosaveSeen.set(name, stamp.lastModified || 0);
    } else {
      autosaveSyncSince = Math.max(autosaveSyncSince, date.getTime());
    }
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

// ——— общая папка: чужие правки ————————————————————————————————————————
//
// Папку кладут в WebDAV или облачный диск, и над объектом работают вдвоём.
// Синхронизацию файлов делает не наш код: наше дело — заметить, что файл в
// папке изменился не нами, и слить чужую работу со своей, а не затереть.
// У каждого браузера свой файл снимка (имя включает идентификатор объекта):
// у файла ровно один писатель, а читают файлы все. Двум писателям в один файл
// поверх WebDAV всё равно никто не даст договориться — блокировок там нет.

export function autosaveBaseProject() {
  return autosaveBase;
}

// Забыть общую точку: другая папка — другая история.
export function autosaveResetSync() {
  autosaveBase = null;
  autosaveSyncSince = 0;
  autosaveSeen = new Map();
}

async function autosaveFolderEntries() {
  const entries = [];
  if (!autosaveHandle || typeof autosaveHandle.values !== "function") return entries;
  for await (const entry of autosaveHandle.values()) {
    if (entry.kind === "file" && /\.zip$/i.test(entry.name)) entries.push(entry);
  }
  return entries;
}

// Наши снимки этого объекта, что лежат в папке, от самого свежего к прежним.
// Ручки файлов нужны и для чтения, и для удаления, поэтому наружу отдаётся
// урезанный список (`autosaveOwnSnapshots`), а внутрь — вместе с ручками.
async function autosaveOwnEntries(project) {
  const own = [];
  if (!project) return own;
  for (const entry of await autosaveFolderEntries()) {
    if (!autosaveOwnSnapshot(project, entry.name)) continue;
    const file = await entry.getFile();
    own.push({ entry, name: entry.name, at: file.lastModified || 0 });
  }
  own.sort((one, other) => other.at - one.at || (one.name < other.name ? -1 : 1));
  return own;
}

/**
 * Открывает и сверяет файлы, прошедшие отбор по имени: имя — не улика, объект
 * переименовывают, а хвост короток, и список ведёт к кнопке «Удалить».
 *
 * Читать всю папку при старте дорого и от этого отказались; здесь читаются
 * только имена-кандидаты, а их единицы: у объекта с одним файлом — ни одного
 * сверх того, что и так открывает `autosaveAdoptFolder` ради общего предка.
 * `known` — уже прочитанное (чтобы не открывать один файл дважды).
 */
async function autosaveOwnChecked(project, entries, known) {
  const kept = [];
  for (const item of entries) {
    let loaded = known && known.get(item.name);
    if (!loaded) {
      try {
        loaded = await unpackProject(await item.entry.getFile());
      } catch (error) {
        // Нечитаемый архив в список не идёт: предлагать удалить то, чего мы не
        // смогли открыть, — значит предлагать удалить неизвестно что.
        continue;
      }
    }
    if (!autosaveOwnArchive(project, loaded)) continue;
    kept.push(item);
  }
  return kept;
}

/**
 * Что из наших снимков **этого объекта** лежит в папке: `[{name, at}]`, свежий
 * первым. Панели это нужно, чтобы сказать человеку про файлы, оставшиеся от
 * прежних дней и прежних имён объекта: удалять их сами мы не вправе — это его
 * данные. Каждый файл здесь открыт и сверен: в списке не бывает чужого.
 */
export async function autosaveOwnSnapshots(project) {
  if (!project || !autosaveReady()) return [];
  await autosaveMemberId();
  const checked = await autosaveOwnChecked(project, await autosaveOwnEntries(project));
  return checked.map(({ name, at }) => ({ name, at }));
}

/**
 * Открыли папку — поднимаем из неё общего предка. До первой своей записи
 * `autosaveBase` пуст, а без предка слияние становится объединением: «сущности
 * нет» и «сущность удалили» снаружи выглядят одинаково, и чужой файл возвращает
 * удалённое. Наш собственный снимок на это годится ровно так же, как он годится
 * после записи: это последнее, что мы отдали в папку, — и именно его видела
 * вторая сторона.
 *
 * Заодно отдаёт список прежних снимков этого объекта (`stale`) — всё, что лежит
 * в папке помимо текущего файла.
 *
 * Возвращает `{name, at, base, stale}` или `null`, если своих снимков в папке
 * нет. Время записи (`autosaveSyncSince`) не двигается: оно значит «что мы уже
 * учли», а учитывает правки соседей запись, а не чтение.
 */
export async function autosaveAdoptFolder(project) {
  if (!project || !autosaveReady()) return null;
  await autosaveMemberId();
  const own = await autosaveOwnEntries(project);
  if (own.length === 0) return null;
  const current = autosaveSnapshotName(project);
  // Предок чужого объекта предком не бывает: объект переключили — прежний
  // снимок к этому спору отношения не имеет.
  if (autosaveBase && autosaveBase.id !== project.id) autosaveBase = null;
  let base = null;
  let from = null;
  // Что открыли по дороге — сверке пригодится, второй раз файл не читаем.
  const read = new Map();
  for (const item of own) {
    if (autosaveBase) break;
    let loaded = null;
    try {
      loaded = await unpackProject(await item.entry.getFile());
    } catch (error) {
      // Битый снимок — не повод ломать сеанс: просто не с чего брать предка.
      continue;
    }
    read.set(item.name, loaded);
    if (!autosaveOwnArchive(project, loaded)) continue;
    base = loaded.project;
    from = item;
    autosaveBase = base;
  }
  // Свои файлы в слияние не идут ни при каком времени записи, но отметка
  // всё равно ставится: опрос не станет перечитывать их зря.
  for (const item of own) autosaveSeen.set(item.name, item.at);
  // Прежние файлы ведут к кнопке «Удалить», поэтому каждый открыт и сверен по
  // объекту внутри. Обычно их нет вовсе, и лишнего чтения не случается.
  const rest = own.filter((item) => item.name !== current);
  const stale = rest.length === 0 ? [] : await autosaveOwnChecked(project, rest, read);
  return {
    base,
    name: from ? from.name : null,
    at: from ? from.at : 0,
    stale: stale.map(({ name, at }) => ({ name, at })),
  };
}

/**
 * Удаляет названные снимки из папки. Только по просьбе человека: сами мы его
 * файлы не трогаем. Трогается лишь то, что писали мы, — имя обязано нести наш
 * хвост-идентификатор, а внутри должен лежать наш объект; текущий снимок не
 * удаляется никогда. Возвращает `{removed, kept}` именами: что не прочиталось
 * или оказалось чужим, остаётся на месте.
 */
export async function autosaveRemoveSnapshots(project, names) {
  const result = { removed: [], kept: [] };
  if (!project || !autosaveReady()) return result;
  if (typeof autosaveHandle.removeEntry !== "function") {
    result.kept = [...(names || [])];
    return result;
  }
  await autosaveMemberId();
  const wanted = new Set(Array.isArray(names) ? names : []);
  const current = autosaveSnapshotName(project);
  // Отбор по имени — только первое сито: перед удалением файл открывается и
  // сверяется по объекту внутри (`autosaveOwnArchive`).
  for (const item of await autosaveOwnEntries(project)) {
    if (!wanted.has(item.name) || item.name === current) continue;
    let loaded = null;
    try {
      loaded = await unpackProject(await item.entry.getFile());
    } catch (error) {
      result.kept.push(item.name);
      continue;
    }
    if (!autosaveOwnArchive(project, loaded)) {
      result.kept.push(item.name);
      continue;
    }
    try {
      await autosaveHandle.removeEntry(item.name);
      autosaveSeen.delete(item.name);
      result.removed.push(item.name);
    } catch (error) {
      autosaveLastError = error;
      result.kept.push(item.name);
    }
  }
  return result;
}

// Планы из чужого файла кладутся в хранилище под своими идентификаторами:
// схема ссылается на картинку по id из файла, и переименовать его значит
// развести ссылки двух браузеров.
async function autosaveAdoptImages(project, images) {
  if (!(images instanceof Map)) return 0;
  const needed = new Set((project.schemes || []).map((scheme) => scheme.imageId).filter(Boolean));
  let added = 0;
  for (const [id, blob] of images) {
    if (!needed.has(id) || !blob) continue;
    if (await getImage(id)) continue;
    await putImage(blob, id);
    added += 1;
  }
  return added;
}

/**
 * Один проход по папке: ищет файлы, записанные после нашего снимка, и сливает
 * первый, в котором действительно есть чужая работа. Возвращает результат
 * слияния (`merge.js`) с именем файла и числом принятых планов — или `null`,
 * если сливать нечего.
 */
export async function autosaveScanExternal(project, options = {}) {
  if (!project || !autosaveReady() || autosaveRunning || autosaveWatchBusy) return null;
  autosaveWatchBusy = true;
  try {
    // Кто мы — до первого решения «своё или чужое»: без участника свой же
    // снимок выглядел бы чужим и поехал бы в слияние.
    await autosaveMemberId();
    const since = typeof options.since === "number" ? options.since : autosaveSyncSince;
    for (const entry of await autosaveFolderEntries()) {
      // Свой снимок — и сегодняшний, и оставшийся от прежних дней или от
      // прежнего имени объекта. Это не чужая работа, а наша же вчерашняя:
      // слияние с ней вернуло бы всё, что мы с тех пор удалили, а отменить
      // было бы нечем. Узнаётся по имени, до чтения архива. Файл соседнего
      // нашего объекта — тоже не чужая работа: его писали мы.
      if (autosaveOwnSnapshot(project, entry.name) || autosaveOurFile(entry.name)) continue;
      const file = await entry.getFile();
      const at = file.lastModified || 0;
      // Файл, который мы уже читали, интересен только если его переписали;
      // незнакомый — только если он новее нашего снимка. Второе и есть защита
      // от протухшего файла: всё, что старше, мы либо писали сами, либо учли.
      const seenAt = autosaveSeen.get(entry.name);
      if (seenAt !== undefined ? at <= seenAt : at <= since) continue;
      autosaveSeen.set(entry.name, at);
      let loaded = null;
      try {
        loaded = await unpackProject(file);
      } catch (error) {
        // В общей папке лежит и чужое: битый или посторонний архив — не повод
        // ломать сеанс, просто не наш файл.
        continue;
      }
      // Второй рубеж — на случай снимка, переименованного руками: хвоста в
      // имени уже нет, но отметка участника внутри осталась нашей (а у файла
      // прежней сборки — идентификатор объекта). Здесь тоже безразлично, для
      // какого из наших объектов файл писан: раз писали мы — не чужая работа.
      if (autosaveWroteArchive(project, loaded, autosaveMember)) continue;
      if (!areRelatedProjects(project, loaded.project)) continue;
      const merged = mergeProjects(project, loaded.project, autosaveBase);
      if (!merged.changed) continue;
      const plans = await autosaveAdoptImages(merged.project, loaded.images);
      return { ...merged, file: entry.name, at, plans };
    }
    return null;
  } finally {
    autosaveWatchBusy = false;
  }
}

// Опрос папки. Останавливается сам, когда папку забыли или сменили.
export function autosaveWatch(options = {}) {
  const getProject = typeof options.getProject === "function" ? options.getProject : () => null;
  const onExternal = typeof options.onExternal === "function" ? options.onExternal : () => {};
  const delay = typeof options.interval === "number" ? options.interval : AUTOSAVE_WATCH_MS;
  autosaveStopWatch();

  const tick = async () => {
    autosaveWatchTimer = null;
    // Вкладка в фоне не опрашивает папку: вернётся — и сразу посмотрит.
    const hidden = typeof document !== "undefined" && document.hidden;
    if (!hidden) {
      try {
        const result = await autosaveScanExternal(getProject());
        if (result) onExternal(result);
      } catch (error) {
        autosaveLastError = error;
      }
    }
    autosaveWatchTimer = setTimeout(tick, delay);
  };
  autosaveWatchTimer = setTimeout(tick, delay);
  return autosaveStopWatch;
}

export function autosaveStopWatch() {
  if (autosaveWatchTimer) clearTimeout(autosaveWatchTimer);
  autosaveWatchTimer = null;
}

// ——— «выгружено N назад» ———————————————————————————————————————————————

// ——— «оставить» помнится ————————————————————————————————————————————

async function autosaveStaleMap() {
  if (!autosaveStaleKept) autosaveStaleKept = (await getSetting(AUTOSAVE_STALE_KEY)) || {};
  return autosaveStaleKept;
}

/** Имена прежних файлов, про которые человек уже сказал «оставить». */
export async function autosaveStaleKeptNames() {
  return Object.keys(await autosaveStaleMap());
}

/** Запомнить ответ «оставить»: об этих файлах больше не спрашиваем. */
export async function autosaveNoteStaleKept(names) {
  const list = (Array.isArray(names) ? names : []).filter((name) => typeof name === "string" && name);
  if (list.length === 0) return;
  const map = { ...(await autosaveStaleMap()) };
  for (const name of list) map[name] = true;
  autosaveStaleKept = map;
  await setSetting(AUTOSAVE_STALE_KEY, map);
}

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
