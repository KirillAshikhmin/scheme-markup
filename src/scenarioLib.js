// Библиотека сценариев внутри продукта (таск 05 просмотра; истории 45, 48, 49;
// требования G23, G25, G26).
//
// Слово заказчика: «что если они будут вшиты в проекта, а в объект просто
// добавляться из готовой библиотеки, соответственно и в файле и в ссылке не
// будут храниться». Логические и глобальные сценарии — это десятки килобайт JS
// на каждый, и до сих пор каждый объект носил свою копию текста. Теперь текст
// лежит **рядом со страницей**: `scenarios/<имя>@<отпечаток>.js` и реестр
// `scenarios/index.json` (имя, версия, вид, отпечаток, размер, файл). Файлы
// собирает руками `tools/scenario-lib.mjs` из `Sprut.Hub_Tools`, итог
// закоммичен, сборка о команде не знает.
//
// ——— почему разрешение живёт в странице ————————————————————————————————————
//
// Поток имитации лишён сети и кода из строки (`simWorkerSeal`,
// `simWorkerNoStringCode`): скачать скрипт он не может — и не должен. Поэтому
// исходники подставляются **до** `buildHomeSpec`: страница скачивает те
// скрипты, на которые ссылается открытый объект (и только их), кладёт их в
// кэш и отдаёт дому готовые записи. `fetch` и хранилище передаются
// аргументом — модуль ничего не знает ни про сеть, ни про браузер сверх этих
// двух дверей, и тесты подставляют свои.
//
// ——— почему только точное совпадение ———————————————————————————————————————
//
// Ссылкой на библиотеку становится исходник, совпавший с библиотечным **байт в
// байт** (G24.1): человек, поправивший в скрипте одно число, остаётся со своим
// текстом, и объект от обновления библиотеки не меняется. Отсюда отпечаток —
// SHA-256 текста, он же имя в кэше и ключ реестра; скачанный файл сверяется с
// ним же, иначе библиотечным он не считается.
//
// ——— чего здесь нет ————————————————————————————————————————————————————————
//
// Видимых строк (они в `strings.scenarioLib.*`), правки объекта (`scenario.lib`
// пишет модель) и перевода старых объектов на ссылку (миграция — своя труба).
// Этот модуль только узнаёт, скачивает, помнит и подставляет.
import { scenariosInOrder } from "./model.js";
import { getSetting, setSetting } from "./store.js";

/** Папка библиотеки рядом со страницей — путь относительный: Pages живёт в подпапке. */
export const SCENARIO_LIB_DIR = "scenarios";
/** Реестр библиотеки внутри неё. */
export const SCENARIO_LIB_INDEX = "index.json";
/** Версия формата реестра. */
export const SCENARIO_LIB_VERSION = 1;
/** Ключ настроек браузера: `{index, scripts: {<отпечаток>: <исходник>}}`. */
export const SCENARIO_LIB_SETTING = "scenarioLib";
/** Сколько скриптов помнит браузер; лишние — самые давние. */
export const SCENARIO_LIB_CACHE_MAX = 50;

const SCENARIO_LIB_HASH_RE = /^[0-9a-f]{64}$/;
const SCENARIO_LIB_BYTES = new TextEncoder();

// ——— отпечаток ————————————————————————————————————————————————————————————
//
// SHA-256 своими руками: `crypto.subtle` асинхронный, а узнавание скрипта
// (`scenarioLibRefOf`) зовётся по ходу чтения объекта и обязано быть
// синхронным. Тест сверяет ответ с `node:crypto` — две реализации одного
// алгоритма расходиться не должны.
const SCENARIO_LIB_K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

function libRotr(value, by) {
  return ((value >>> by) | (value << (32 - by))) >>> 0;
}

/** Отпечаток текста: SHA-256 его utf-8 байтов, 64 знака в нижнем регистре. */
export function scenarioLibHash(source) {
  const bytes = SCENARIO_LIB_BYTES.encode(typeof source === "string" ? source : String(source ?? ""));
  const total = Math.ceil((bytes.length + 9) / 64) * 64;
  const block = new Uint8Array(total);
  block.set(bytes);
  block[bytes.length] = 0x80;
  const view = new DataView(block.buffer);
  const bits = bytes.length * 8;
  view.setUint32(total - 8, Math.floor(bits / 0x100000000));
  view.setUint32(total - 4, bits >>> 0);

  const h = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  const w = new Uint32Array(64);
  for (let at = 0; at < total; at += 64) {
    for (let i = 0; i < 16; i += 1) w[i] = view.getUint32(at + i * 4);
    for (let i = 16; i < 64; i += 1) {
      const a = w[i - 15];
      const b = w[i - 2];
      const s0 = (libRotr(a, 7) ^ libRotr(a, 18) ^ (a >>> 3)) >>> 0;
      const s1 = (libRotr(b, 17) ^ libRotr(b, 19) ^ (b >>> 10)) >>> 0;
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let a = h[0];
    let b = h[1];
    let c = h[2];
    let d = h[3];
    let e = h[4];
    let f = h[5];
    let g = h[6];
    let hh = h[7];
    for (let i = 0; i < 64; i += 1) {
      const s1 = (libRotr(e, 6) ^ libRotr(e, 11) ^ libRotr(e, 25)) >>> 0;
      const ch = ((e & f) ^ (~e & g)) >>> 0;
      const t1 = (hh + s1 + ch + SCENARIO_LIB_K[i] + w[i]) >>> 0;
      const s0 = (libRotr(a, 2) ^ libRotr(a, 13) ^ libRotr(a, 22)) >>> 0;
      const maj = ((a & b) ^ (a & c) ^ (b & c)) >>> 0;
      const t2 = (s0 + maj) >>> 0;
      hh = g;
      g = f;
      f = e;
      e = (d + t1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) >>> 0;
    }
    h[0] = (h[0] + a) >>> 0;
    h[1] = (h[1] + b) >>> 0;
    h[2] = (h[2] + c) >>> 0;
    h[3] = (h[3] + d) >>> 0;
    h[4] = (h[4] + e) >>> 0;
    h[5] = (h[5] + f) >>> 0;
    h[6] = (h[6] + g) >>> 0;
    h[7] = (h[7] + hh) >>> 0;
  }
  let out = "";
  for (const part of h) out += part.toString(16).padStart(8, "0");
  return out;
}

/** Имя файла библиотеки: читаемый ключ и первые 16 знаков отпечатка. */
export function scenarioLibFileName(key, hash) {
  const own = String(key || "").trim() || "script";
  return own + "@" + String(hash || "").slice(0, 16) + ".js";
}

function libHashOf(value) {
  const hash = value && typeof value === "object" && typeof value.hash === "string" ? value.hash.trim().toLowerCase() : "";
  return SCENARIO_LIB_HASH_RE.test(hash) ? hash : "";
}

// ——— реестр ———————————————————————————————————————————————————————————————

function libEntryOf(item, current) {
  const hash = libHashOf(item);
  const file = item && typeof item.file === "string" ? item.file.trim() : "";
  if (!hash || !file) return null;
  return Object.freeze({
    name: typeof item.name === "string" ? item.name : "",
    version: typeof item.version === "string" ? item.version : "",
    kind: item.kind === "global" ? "global" : "logic",
    hash,
    size: Number.isFinite(item.size) ? Number(item.size) : 0,
    file,
    // `true` — отпечаток нынешней сборки библиотеки, `false` — прежней (файл
    // остался, потому что на нём стоят готовые объекты), `null` — реестр об
    // этом не говорит вовсе (реестр прежнего вида или собранный руками).
    current,
  });
}

/**
 * Разбор `index.json` — чистый: текст или готовый объект → `Map(отпечаток →
 * запись)`. Мусор выбрасывается записью, а не отказом всего реестра: обрезанный
 * файл не должен лишать дом всех библиотечных сценариев.
 */
export function scenarioLibIndexRead(json) {
  let data = json;
  if (typeof json === "string") {
    try {
      data = JSON.parse(json);
    } catch {
      return new Map();
    }
  }
  const list = data && typeof data === "object" && Array.isArray(data.scripts) ? data.scripts : [];
  // Библиотека только прирастает: файл прежнего отпечатка не удаляется, иначе
  // объект, стоящий на нём, остался бы без текста навсегда. Поэтому в реестре
  // живут и прежние записи, а `current` называет отпечатки нынешней сборки.
  // Нет списка — «неизвестно», и «есть версия новее» решается одними версиями,
  // как прежде.
  const said = data && typeof data === "object" && Array.isArray(data.current);
  const current = said ? new Set(data.current.filter((hash) => typeof hash === "string").map((hash) => hash.trim().toLowerCase())) : null;
  const out = new Map();
  for (const item of list) {
    const entry = item && typeof item === "object" ? libEntryOf(item, current === null ? null : current.has(libHashOf(item))) : null;
    if (entry) out.set(entry.hash, entry);
  }
  return out;
}

/** Ссылка записи сценария (`scenario.lib`) → `{name, version, hash}` или `null`. */
export function scenarioLibRef(scenario) {
  const lib = scenario && typeof scenario === "object" ? scenario.lib : null;
  const hash = libHashOf(lib);
  if (!hash) return null;
  return {
    name: typeof lib.name === "string" ? lib.name : "",
    version: typeof lib.version === "string" ? lib.version : "",
    hash,
  };
}

/**
 * Узнать библиотечный скрипт по исходнику — **точным совпадением** (G24.1).
 * Похожий текст, отличающийся одним знаком, библиотечным не считается.
 */
export function scenarioLibRefOf(source, index) {
  if (typeof source !== "string" || source === "") return null;
  const map = index instanceof Map ? index : scenarioLibIndexRead(index);
  const entry = map.get(scenarioLibHash(source));
  return entry ? { name: entry.name, version: entry.version, hash: entry.hash } : null;
}

// Версия как число для сравнения: «1.10» новее «1.2». Нет чисел — нет ответа.
function libVersionRank(version) {
  const parts = String(version || "")
    .trim()
    .split(".")
    .map((part) => Number.parseInt(part, 10));
  if (parts.length === 0 || !Number.isFinite(parts[0])) return -1;
  let rank = 0;
  for (let i = 0; i < 4; i += 1) rank = rank * 10000 + (Number.isFinite(parts[i]) ? Math.min(9999, Math.max(0, parts[i])) : 0);
  return rank;
}

/**
 * Есть ли в библиотеке версия новее той, на которой стоит объект (G27). Сам
 * объект не меняется никогда — это предложение, и решает человек. Имя —
 * единственное, что связывает версии одного скрипта: отпечаток у новой другой.
 *
 * Правил два, и второе важнее, чем кажется:
 *
 *   1. есть запись того же имени с версией **выше** — она и есть «новее»;
 *   2. версии не решают (у глобальных скриптов `version` в `info` нет вовсе —
 *      таких в живом объекте большинство, а у логических версию поднимают не
 *      всегда) — «новее» считается запись **нынешней сборки** библиотеки
 *      (`entry.current`), если объект стоит на другом отпечатке. Без этого
 *      правила безверсионному скрипту не пришло бы даже предложения обновить,
 *      и он остался бы на прежнем отпечатке навсегда.
 *
 * Правило **над обоими**: есть у этого имени запись нынешней сборки — выбирать
 * можно только среди таких записей, и ни среди каких других (ревью ветки, F1).
 * Прежние записи живут в реестре вечно, и среди них бывает версия выше
 * нынешней — откатили скрипт. Предложить её значило бы дважды соврать: файла
 * того отпечатка в библиотеке может уже не быть, а объект, стоящий на
 * нынешнем, носил бы предложение обновиться вечно.
 *
 * Реестр, который о нынешней сборке не говорит (`current === null`), решает
 * одними версиями — как прежде.
 */
export function scenarioLibNewer(ref, index) {
  const own = ref && typeof ref === "object" ? ref : null;
  const name = own && typeof own.name === "string" ? own.name : "";
  if (!name) return null;
  const hash = libHashOf(own);
  const map = index instanceof Map ? index : scenarioLibIndexRead(index);
  const rank = libVersionRank(own.version);
  // Родня по имени: вся — чтобы узнать, есть ли у имени нынешняя сборка (в том
  // числе тот отпечаток, на котором объект стоит).
  const family = [...map.values()].filter((entry) => entry.name === name);
  const said = family.some((entry) => entry.current === true);
  // Кандидаты: нынешняя сборка, если о ней сказано, кроме своего отпечатка.
  const kin = (said ? family.filter((entry) => entry.current === true) : family).filter((entry) => entry.hash !== hash);
  let best = null;
  if (rank >= 0) {
    for (const entry of kin) {
      if (libVersionRank(entry.version) <= rank) continue;
      if (!best || libVersionRank(entry.version) > libVersionRank(best.version)) best = entry;
    }
  }
  if (best) return best;
  // Правило 2: нынешняя сборка библиотеки. Запись с версией **ниже** своей не
  // предлагается и так — откат библиотеки не повод звать её «новее».
  return (
    kin.find((entry) => {
      if (entry.current !== true) return false;
      const theirs = libVersionRank(entry.version);
      return rank < 0 || theirs < 0 || theirs >= rank;
    }) || null
  );
}

// ——— сеть, кэш и память сеанса ——————————————————————————————————————————————

// Память сеанса: реестр и скрипты по отпечатку. Второе открытие того же
// объекта сети не трогает вовсе — ни файла, ни реестра.
let libIndexMap = null;
let libIndexText = "";
let libIndexTried = false;
const libScripts = new Map();
let libWoke = false;

/** Забыть всё, что помнит модуль (кэш сеанса). Нужно тестам и смене origin. */
export function scenarioLibForget() {
  libIndexMap = null;
  libIndexText = "";
  libIndexTried = false;
  libScripts.clear();
  libWoke = false;
}

function libFetchDoor(opts) {
  const given = opts && typeof opts === "object" ? opts : {};
  if (typeof given.fetch === "function") return given.fetch;
  return typeof fetch === "function" ? (url) => fetch(url) : null;
}

function libStoreDoor(opts) {
  const given = opts && typeof opts === "object" ? opts : {};
  const own = given.store;
  if (own && typeof own.get === "function" && typeof own.set === "function") return own;
  return { get: getSetting, set: setSetting };
}

// Текст по адресу рядом со страницей; нет сети, нет файла, отказ сервера —
// `null`. Бросать здесь нечему: «скрипт не доехал» — обычное состояние (G26).
async function libGet(url, opts) {
  const door = libFetchDoor(opts);
  if (!door) return null;
  try {
    const response = await door(url);
    if (!response || response.ok === false) return null;
    const text = await response.text();
    return typeof text === "string" ? text : null;
  } catch {
    return null;
  }
}

// Кэш браузера поднимается один раз на сеанс. Исходник из кэша сверяется с
// отпечатком: испорченная запись библиотечной не считается.
async function libWake(opts) {
  if (libWoke) return;
  libWoke = true;
  const store = libStoreDoor(opts);
  let saved = null;
  try {
    saved = await store.get(SCENARIO_LIB_SETTING);
  } catch {
    saved = null;
  }
  if (!saved || typeof saved !== "object") return;
  if (typeof saved.index === "string" && saved.index && !libIndexText) libIndexText = saved.index;
  const scripts = saved.scripts && typeof saved.scripts === "object" ? saved.scripts : {};
  for (const [hash, source] of Object.entries(scripts)) {
    if (typeof source !== "string" || libScripts.has(hash)) continue;
    if (scenarioLibHash(source) === hash) libScripts.set(hash, source);
  }
}

async function libKeep(opts) {
  const store = libStoreDoor(opts);
  const scripts = {};
  for (const hash of [...libScripts.keys()].slice(-SCENARIO_LIB_CACHE_MAX)) scripts[hash] = libScripts.get(hash);
  try {
    await store.set(SCENARIO_LIB_SETTING, { index: libIndexText, scripts });
  } catch {
    /* нет места в браузере — библиотека живёт сеанс, а дом идёт */
  }
}

/**
 * Реестр библиотеки: из сети, а без неё — из кэша браузера. Пустой ответ не
 * запоминается, но второй раз за сеанс в сеть не ходят: отказ есть отказ.
 */
export async function scenarioLibIndex(opts) {
  if (libIndexMap) return libIndexMap;
  await libWake(opts);
  if (!libIndexTried) {
    libIndexTried = true;
    const text = await libGet(SCENARIO_LIB_DIR + "/" + SCENARIO_LIB_INDEX, opts);
    const map = text === null ? new Map() : scenarioLibIndexRead(text);
    if (map.size > 0) {
      libIndexMap = map;
      libIndexText = text;
      // Реестр в кэш — сразу: без него второе открытие без сети не знало бы
      // даже, какой файл просить, и «версия новее» не нашлась бы.
      await libKeep(opts);
      return libIndexMap;
    }
  }
  if (libIndexText) {
    const saved = scenarioLibIndexRead(libIndexText);
    if (saved.size > 0) {
      libIndexMap = saved;
      return libIndexMap;
    }
  }
  return new Map();
}

// Один скрипт без записи кэша браузера: её делает тот, кто позвал (одна
// запись на открытие объекта, а не одна на скрипт).
async function libOne(ref, opts) {
  const hash = libHashOf(ref);
  if (!hash) return null;
  if (libScripts.has(hash)) return libScripts.get(hash);
  await libWake(opts);
  if (libScripts.has(hash)) return libScripts.get(hash);
  const index = await scenarioLibIndex(opts);
  const entry = index.get(hash);
  if (!entry) return null;
  const source = await libGet(SCENARIO_LIB_DIR + "/" + entry.file, opts);
  if (source === null) return null;
  // Файл, не совпавший с отпечатком, библиотечным не считается: объект стоит
  // на конкретном тексте, и подменённый ему не подходит.
  if (scenarioLibHash(source) !== hash) return null;
  libScripts.set(hash, source);
  return source;
}

/** Исходник библиотечного скрипта по ссылке `{hash}`; не доехал — `null`. */
export async function scenarioLibFetch(ref, opts) {
  const source = await libOne(ref, opts);
  if (source !== null) await libKeep(opts);
  return source;
}

/**
 * Сценарии объекта с подставленными исходниками — **до** `buildHomeSpec`.
 * Скачиваются только те скрипты, на которые ссылается объект; что уже в
 * кэше, сети не стоит. Ответ — `{scenarios, missing}`: `missing` —
 * `[{id, name, version, hash}]`, а сама запись уходит в дом помеченной
 * (`source: ""`, `active: false`, `libMissing: true`), чтобы дом шёл, а
 * остальные сценарии работали (G26).
 */
export async function scenarioLibResolve(project, opts) {
  const list = scenariosInOrder(project);
  const refs = new Map();
  for (const scenario of list) {
    const ref = scenarioLibRef(scenario);
    if (ref) refs.set(ref.hash, ref);
  }
  if (refs.size === 0) return { scenarios: list, missing: [] };

  await libWake(opts);
  let got = 0;
  for (const ref of refs.values()) {
    if (libScripts.has(ref.hash)) continue;
    if ((await libOne(ref, opts)) !== null) got += 1;
  }
  if (got > 0) await libKeep(opts);

  const missing = [];
  const scenarios = list.map((scenario) => {
    const ref = scenarioLibRef(scenario);
    if (!ref) return scenario;
    const source = libScripts.get(ref.hash);
    if (typeof source === "string") return { ...scenario, source };
    // Текст записи, если он у неё есть: ссылка не разрешилась, а сценарий
    // рабочий — обнулять его нечем (ревью ветки, F1). Своего текста у записи
    // этой сборки не бывает (модель снимает одно другим), но файл, пришедший
    // не отсюда, несёт оба поля.
    if (typeof scenario.source === "string" && scenario.source !== "") return scenario;
    missing.push({
      id: String(scenario.id || ""),
      name: ref.name || (typeof scenario.name === "string" ? scenario.name : ""),
      version: ref.version,
      hash: ref.hash,
    });
    return { ...scenario, source: "", active: false, libMissing: true };
  });
  return { scenarios, missing };
}
