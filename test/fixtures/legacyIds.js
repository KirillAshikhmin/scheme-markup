// Сверка «объект прежней сборки открылся как закрывался» (G68) после того, как
// идентификаторы стали номерами (G08–G11, ADR 030).
//
// Открытие объекта теперь **перенумеровывает** его целиком: uuid уходят,
// сущности получают номера, и каждая ссылка переписывается (`idsMigrate`).
// Поэтому сравнивать объект до открытия и после «как есть» больше нельзя —
// тексты разойдутся на каждом идентификаторе, и тест стал бы говорить о
// перенумерации вместо того, о чём он написан.
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
import { ID_COUNTER_KEY, idsReplace } from "../../src/model.js";

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

/**
 * Объект «до перенумерации»: у каждой сущности вместо номера строка-uuid, и
 * счётчика номеров нет. Нужен тем тестам, которые говорят о **лестнице версий
 * формата** ниже восьмой: она отвечает только объекту, которого перенумерация
 * ещё не касалась (ADR 030).
 */
export function legacyIdsBefore(project) {
  const was = new Map();
  for (const key of LEGACY_COLLECTIONS) {
    for (const item of (project && project[key]) || []) if (item && typeof item.id === "string") was.set(item.id, "old-" + item.id);
  }
  for (const scheme of (project && project.schemes) || []) {
    for (const guide of (scheme && scheme.guides) || []) if (guide && typeof guide.id === "string") was.set(guide.id, "old-" + guide.id);
  }
  const moved = was.size === 0 ? project : idsReplace(project, was).project;
  const counters = { ...moved.counters };
  delete counters[ID_COUNTER_KEY];
  return { ...moved, counters };
}

/**
 * Таблица «прежний идентификатор → новый номер»: ею тест называет сущность
 * открытого объекта тем именем, которым она названа в фикстуре.
 */
export function legacyIdsForward(before, after) {
  const forward = new Map();
  for (const [now, was] of legacyIdsBack(before, after)) forward.set(was, now);
  return forward;
}

/** Таблица «новый номер → прежний идентификатор» по месту в коллекциях. */
export function legacyIdsBack(before, after) {
  const back = new Map();
  const put = (was, now) => {
    if (typeof was !== "string" || !was || typeof now !== "string" || !now || was === now) return;
    back.set(now, was);
  };
  for (const key of LEGACY_COLLECTIONS) {
    const old = Array.isArray(before && before[key]) ? before[key] : [];
    const list = Array.isArray(after && after[key]) ? after[key] : [];
    if (old.length === 0 || old.length !== list.length) continue;
    old.forEach((item, at) => {
      const now = list[at];
      put(item && item.id, now && now.id);
      if (key !== "schemes") return;
      const guides = Array.isArray(item && item.guides) ? item.guides : [];
      const theirs = Array.isArray(now && now.guides) ? now.guides : [];
      if (guides.length !== theirs.length) return;
      guides.forEach((guide, index) => put(guide && guide.id, theirs[index] && theirs[index].id));
    });
  }
  return back;
}

/**
 * Открытый объект с **прежними** именами: его и сравнивают с исходным. Счётчик
 * номеров (`counters[ID_COUNTER_KEY]`) возвращается к исходному значению — он
 * и есть след перенумерации, а не правка разметки; остальные счётчики (номера
 * меток по кодам типов) сверяются как были.
 */
export function legacyIdsRestored(before, after) {
  const back = legacyIdsBack(before, after);
  const restored = back.size === 0 ? after : idsReplace(after, back).project;
  const was = before && before.counters ? before.counters : null;
  const had = Boolean(was) && Object.prototype.hasOwnProperty.call(was, ID_COUNTER_KEY);
  const has = Boolean(restored.counters) && Object.prototype.hasOwnProperty.call(restored.counters, ID_COUNTER_KEY);
  if (!has && !had) return restored;
  const counters = { ...restored.counters };
  if (had) counters[ID_COUNTER_KEY] = was[ID_COUNTER_KEY];
  else delete counters[ID_COUNTER_KEY];
  return { ...restored, counters };
}
