// Сверка «объект прежней сборки открылся как закрывался» (G68) после того, как
// идентификаторы стали номерами (G08–G11, ADR 030) и номера стали считаться
// **по видам** (G391, ADR 038).
//
// Открытие объекта теперь **перенумеровывает** его целиком: uuid уходят,
// сущности получают номера своего вида, и каждая ссылка переписывается
// (`idsMigrate`). Поэтому сравнивать объект до открытия и после «как есть»
// больше нельзя — тексты разойдутся на каждом идентификаторе, и тест стал бы
// говорить о перенумерации вместо того, о чём он написан.
//
// Здесь сверка возвращается к прежней строгости с другой стороны:
// перенумерация — **чистое переименование**, и значит объект, у которого
// вернули прежние имена, обязан совпасть с исходным **побайтово**. Это не
// ослабление G68, а то же правило, проверенное точнее: оно поймает и
// переехавшую метку, и дописанное поле, и потерянную ссылку — всё, кроме самих
// номеров.
//
// Соответствие «было → стало» берётся **по месту в коллекции**: перенумерация
// идёт списком за списком и порядок не трогает (`idsRewrite` — `list.map`).
// Коллекция, длина которой изменилась (её тронула другая миграция — например
// комментарий-тип уехал на встроенный), из сверки имён выпадает: у её
// сущностей сопоставлять нечего, и угадывать нельзя.
//
// **Таблицы переездов здесь названы по видам** — так их теперь и принимает
// `idsReplace`: номер свой у каждого вида, и одна таблица на все виды увезла бы
// помещение 5 вместе с меткой 5.
import { idsReplace } from "../../src/model.js";

// Коллекции объекта — те же, что у таблицы `ID_OWNERS` модели. Разойдутся —
// сверка просто не переименует часть сущностей, и тест покажет разницу: лучше
// шумный тест, чем тихая сверка не того.
const LEGACY_COLLECTIONS = [
  "marks",
  "groups",
  "outlines",
  "schemes",
  "rooms",
  "categories",
  "markTypes",
  "walls",
  "openings",
  "schemeObjects",
  "schemeObjectKinds",
  "equipmentTypes",
  "equipment",
  "placements",
  "scenarios",
  "logicBindings",
];

// Вложенный вид: направляющие схемы нумеруются своим счётчиком (`#guides`), и
// переезжают своей таблицей.
const LEGACY_NESTED = "guides";

// Счётчик вида в `counters` — то же, что `model.idCounterKey`, но здесь он
// повторён нарочно: фикстура сверяет формат файла, и подставь она дверь самой
// модели — сверяла бы код с ним самим.
const legacyCounterKey = (collection) => "#" + collection;

const LEGACY_COUNTER_KEYS = [
  "#id",
  ...LEGACY_COLLECTIONS.map(legacyCounterKey),
  legacyCounterKey(LEGACY_NESTED),
];

/**
 * Объект «до перенумерации»: у каждой сущности вместо номера строка-uuid, и ни
 * одного счётчика номеров. Нужен тем тестам, которые говорят о **лестнице
 * версий формата** ниже девятой: она отвечает только объекту, которого
 * перенумерация ещё не касалась (ADR 030, ADR 038).
 */
export function legacyIdsBefore(project) {
  const moves = new Map();
  const put = (collection, id) => {
    if (typeof id !== "string" || !id) return;
    if (!moves.has(collection)) moves.set(collection, new Map());
    moves.get(collection).set(id, "old-" + id);
  };
  for (const key of LEGACY_COLLECTIONS) {
    for (const item of (project && project[key]) || []) put(key, item && item.id);
  }
  for (const scheme of (project && project.schemes) || []) {
    for (const guide of (scheme && scheme[LEGACY_NESTED]) || []) put(LEGACY_NESTED, guide && guide.id);
  }
  const moved = moves.size === 0 ? project : idsReplace(project, moves).project;
  const counters = { ...moved.counters };
  for (const key of LEGACY_COUNTER_KEYS) delete counters[key];
  return { ...moved, counters };
}

/**
 * Таблица «прежний идентификатор → новый номер»: ею тест называет сущность
 * открытого объекта тем именем, которым она названа в фикстуре.
 *
 * Здесь она **без разбора по видам**, и это не промах: прежние имена —
 * uuid или рукописные `"mark-1"`, и они уникальны по всему объекту, а таблица
 * читается тестом на запрос «как теперь зовут вот эту сущность», а не
 * подставляется в объект. Таблица, которая правит объект (`legacyIdsBack`),
 * названа по видам — иначе помещение 5 уехало бы вместе с меткой 5.
 */
export function legacyIdsForward(before, after) {
  const forward = new Map();
  for (const table of legacyIdsBack(before, after).values()) {
    for (const [now, was] of table) forward.set(was, now);
  }
  return forward;
}

/** Таблица «новый номер → прежний идентификатор» по местам в коллекциях, по видам. */
export function legacyIdsBack(before, after) {
  const back = new Map();
  const put = (collection, was, now) => {
    if (typeof was !== "string" || !was || typeof now !== "string" || !now || was === now) return;
    if (!back.has(collection)) back.set(collection, new Map());
    back.get(collection).set(now, was);
  };
  for (const key of LEGACY_COLLECTIONS) {
    const old = Array.isArray(before && before[key]) ? before[key] : [];
    const list = Array.isArray(after && after[key]) ? after[key] : [];
    // Коллекция, **подросшая** от другой миграции (вещи приборам достраивает
    // `migrateThingMarks`, и дописывает их в конец), сверяется по общему
    // началу: у прежних сущностей место то же. Прежде такая коллекция
    // выпадала из сверки целиком — и её переименование не проверялось ничем.
    // Укоротившаяся (комментарий-тип уехал на встроенный) по-прежнему
    // выпадает: там сущности сдвинулись, и сопоставлять их по месту нельзя.
    if (old.length === 0 || old.length > list.length) continue;
    old.forEach((item, at) => {
      const now = list[at];
      put(key, item && item.id, now && now.id);
      if (key !== "schemes") return;
      const guides = Array.isArray(item && item[LEGACY_NESTED]) ? item[LEGACY_NESTED] : [];
      const theirs = Array.isArray(now && now[LEGACY_NESTED]) ? now[LEGACY_NESTED] : [];
      if (guides.length !== theirs.length) return;
      guides.forEach((guide, index) => put(LEGACY_NESTED, guide && guide.id, theirs[index] && theirs[index].id));
    });
  }
  return back;
}

/**
 * Открытый объект с **прежними** именами: его и сравнивают с исходным. Счётчики
 * номеров видов возвращаются к исходным значениям — они и есть след
 * перенумерации, а не правка разметки; остальные счётчики (номера меток по
 * кодам типов) сверяются как были.
 */
export function legacyIdsRestored(before, after) {
  const back = legacyIdsBack(before, after);
  const restored = back.size === 0 ? after : idsReplace(after, back).project;
  const was = before && before.counters ? before.counters : {};
  const counters = { ...restored.counters };
  let changed = false;
  for (const key of LEGACY_COUNTER_KEYS) {
    const had = Object.prototype.hasOwnProperty.call(was, key);
    const has = Object.prototype.hasOwnProperty.call(counters, key);
    if (!had && !has) continue;
    changed = true;
    if (had) counters[key] = was[key];
    else delete counters[key];
  }
  return changed ? { ...restored, counters } : restored;
}
