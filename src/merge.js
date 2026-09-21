// Слияние двух экземпляров одного объекта. Чистый модуль: ни DOM, ни файлов —
// на вход два объекта и общий предок (если он есть), на выход слитый объект и
// перечень того, что разошлось.
//
// Зачем оно вообще: общая папка (WebDAV, облачный диск) даёт двум инженерам
// один проект, но синхронизацию файлов делает не наш код. Кто записал
// последним, тот и затёр — если сливать по файлу целиком. Поэтому сливаем по
// сущностям: чаще всего двое ставят **разные** метки, и такие правки обязаны
// сложиться без единого вопроса; спорное — редкость, и о нём надо сказать.
//
// Правило на спор одно и симметричное: побеждает сторона, чей объект правился
// позже (`updatedAt`), при равенстве — та, у кого меньше `id`. Симметричное
// потому, что обе стороны считают его из одной и той же пары и приходят к
// одному ответу: иначе файлы в папке ходили бы по кругу, переписывая друг
// друга. Проигравший вариант не пропадает молча — он попадает в `conflicts`.
//
// Правка важнее удаления: если одна сторона сущность удалила, а вторая
// правила, сущность остаётся (с пометкой в `conflicts`). Вернуть лишнюю метку
// — минута работы, восстановить потерянную — некому.

import { MARK_NUMBER_MAX, renumberAcceptedRepeats } from "./model.js";

// Сущности объекта, которые сливаются поимённо, по `id`.
//
// `equipmentTypes` здесь такой же справочник, как `categories` и `markTypes`:
// без него слитый объект брал бы типы только у «нас», и заведённое вторым
// участником («Реле 4 канала») пропадало бы молча вместе с колонкой типа у его
// моделей.
export const MERGE_ENTITIES = [
  "categories",
  "markTypes",
  "rooms",
  "schemes",
  "marks",
  "groups",
  "outlines",
  "equipmentTypes",
  "equipment",
  "placements",
];

// Коллекции, у которых есть поле `order`: после слияния порядок пересобирается.
const MERGE_ORDERED = ["categories", "markTypes", "schemes", "equipmentTypes", "equipment"];

// Коллекции, которых у объекта прежней разметки нет вовсе. Слияние двух таких
// объектов не должно заводить их пустыми: это была бы правка на пустом месте,
// и два одинаковых файла перестали бы сливаться в «ничего не изменилось».
const MERGE_OPTIONAL = ["outlines", "equipmentTypes", "equipment", "placements"];

/**
 * Принятые предупреждения: **объединение по ключу, а не конфликт.**
 *
 * «Так и задумано» — это ответ на вопрос, а не правка разметки. Если один
 * ответил, а второй нет, вопрос уже отвечен, и повторно спрашивать второго
 * незачем: никто при этом не теряет работу, у обоих остаётся тот же объект.
 *
 * **Чего эта механика не умеет и почему.** Запись принятия либо есть, либо её
 * нет — следа от снятия не остаётся. Значит «второй ещё не принимал» и «второй
 * вернул принятое в работу» для слияния выглядят одинаково, и объединение в
 * обоих случаях оставит принятие. Сторона выбрана сознательно: лишняя строка
 * «принято» снимается одним нажатием и видна в панели целиком, а потерянные
 * ответы пришлось бы давать заново по всему объекту — и молча. Тому, кто
 * вернул строку в работу, достаточно вернуть её ещё раз после обмена файлами.
 *
 * Дублей не появляется: ключ у записи один, и повторный обмен файлами ничего
 * не добавляет. Своя запись при совпадении ключа остаётся своей — у неё своё
 * время принятия и свой текст на момент ответа.
 */
function mergeAccepted(merged, ours, theirs) {
  const mine = mergeList(ours, "accepted");
  const other = mergeList(theirs, "accepted");
  // Ни у кого нет даже поля — объект прежней разметки остаётся как был.
  if (mine.length === 0 && other.length === 0) {
    if (!Array.isArray(ours.accepted) && !Array.isArray(theirs.accepted)) return;
    merged.accepted = Array.isArray(ours.accepted) ? ours.accepted : [];
    return;
  }
  const keys = new Set(mine.map((item) => item && item.key).filter(Boolean));
  const added = other.filter((item) => item && item.key && !keys.has(item.key));
  merged.accepted = added.length === 0 ? mine : [...mine, ...added];
}

function mergeList(project, key) {
  return project && Array.isArray(project[key]) ? project[key] : [];
}

function mergeIndex(list) {
  const index = new Map();
  for (const item of list) {
    if (item && typeof item.id === "string") index.set(item.id, item);
  }
  return index;
}

// Сравнение по содержимому, устойчивое к порядку ключей: один и тот же объект,
// прошедший через JSON и миграцию на другой машине, обязан считаться равным.
function mergeText(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value) || "null";
  if (Array.isArray(value)) return "[" + value.map(mergeText).join(",") + "]";
  const keys = Object.keys(value).sort();
  return "{" + keys.map((key) => JSON.stringify(key) + ":" + mergeText(value[key])).join(",") + "}";
}

function mergeSame(a, b) {
  return mergeText(a) === mergeText(b);
}

// Кто выигрывает спор. Обе стороны считают это из одной пары и получают один
// ответ — иначе слияние не сходится.
export function mergeWinner(ours, theirs) {
  const oursAt = String((ours && ours.updatedAt) || "");
  const theirsAt = String((theirs && theirs.updatedAt) || "");
  if (oursAt !== theirsAt) return theirsAt > oursAt ? "theirs" : "ours";
  const oursId = String((ours && ours.id) || "");
  const theirsId = String((theirs && theirs.id) || "");
  return theirsId < oursId ? "theirs" : "ours";
}

// Постоянный ключ проекта, если он у объекта есть.
function mergeKeyOf(project) {
  const key = project && project.key;
  return typeof key === "string" && key ? key : null;
}

/**
 * Об одном ли объекте речь.
 *
 * Прямой ответ даёт постоянный ключ (`project.key`): он заводится при создании
 * объекта и переживает и загрузку файла, и копирование, и переименование.
 * Совпал — это один проект, и доказывать больше нечего.
 *
 * **Разные ключи «нет» не значат.** Две копии одного проекта, разошедшиеся до
 * того, как ключи появились, получат каждая свой — и отказ по несовпадению
 * оставил бы их без слияния навсегда. Поэтому дальше работает прежняя догадка:
 * два человека получают проект из одного файла, и идентификаторы схем и меток
 * у них общие (свой `id` объекта и свои id картинок каждый браузер выдаёт
 * сам). Ничего общего — значит, это чужой файл, сливать его нельзя.
 */
export function areRelatedProjects(ours, theirs) {
  if (!ours || !theirs) return false;
  const ourKey = mergeKeyOf(ours);
  const theirKey = mergeKeyOf(theirs);
  if (ourKey && theirKey && ourKey === theirKey) return true;
  if (ours.id && ours.id === theirs.id) return true;
  for (const key of ["schemes", "marks", "rooms", "markTypes"]) {
    const mine = mergeIndex(mergeList(ours, key));
    for (const item of mergeList(theirs, key)) {
      if (mine.has(item.id)) return true;
    }
  }
  return false;
}

// Какой ключ останется у слитого объекта. Правило симметрично: обе стороны
// приходят к одному ответу, иначе ключи гуляли бы туда-сюда.
function mergeMergeKeys(ourKey, theirKey) {
  if (ourKey && theirKey) return ourKey < theirKey ? ourKey : theirKey;
  return ourKey || theirKey || null;
}

function mergeLabel(entity, item, typeCodes) {
  if (!item) return "";
  if (entity === "marks") {
    const code = typeCodes.get(item.typeId) || "";
    return code ? code + item.number : String(item.number || "");
  }
  if (entity === "markTypes") return item.code || item.name || "";
  return item.name || "";
}

// Слияние одной коллекции. Возвращает список сущностей и дописывает в отчёт
// то, что пришло со стороны и то, что разошлось.
function mergeCollection(entity, ours, theirs, base, report, winner) {
  const oursIndex = mergeIndex(mergeList(ours, entity));
  const theirsIndex = mergeIndex(mergeList(theirs, entity));
  const baseIndex = mergeIndex(mergeList(base, entity));
  const ids = [...oursIndex.keys()];
  for (const id of theirsIndex.keys()) {
    if (!oursIndex.has(id)) ids.push(id);
  }

  const result = [];
  for (const id of ids) {
    const mine = oursIndex.get(id) || null;
    const other = theirsIndex.get(id) || null;
    const was = baseIndex.get(id) || null;

    if (mine && other) {
      if (mergeSame(mine, other)) {
        result.push(mine);
      } else if (was && mergeSame(was, mine)) {
        result.push(other);
        report.changes.push({ entity, id, action: "updated", item: other });
      } else if (was && mergeSame(was, other)) {
        result.push(mine);
      } else {
        const kept = winner === "theirs" ? other : mine;
        result.push(kept);
        report.conflicts.push({ code: "bothChanged", entity, id, kept: winner, item: kept, other: winner === "theirs" ? mine : other });
        if (winner === "theirs") report.changes.push({ entity, id, action: "updated", item: other });
      }
      continue;
    }

    if (mine && !other) {
      // У них сущности нет. Либо они её удалили, либо у нас она только появилась.
      if (!was) {
        result.push(mine);
      } else if (mergeSame(was, mine)) {
        report.changes.push({ entity, id, action: "removed", item: mine });
      } else {
        result.push(mine);
        report.conflicts.push({ code: "deletedElsewhere", entity, id, kept: "ours", item: mine });
      }
      continue;
    }

    if (!mine && other) {
      if (!was) {
        result.push(other);
        report.changes.push({ entity, id, action: "added", item: other });
      } else if (mergeSame(was, other)) {
        // Удалили мы, они не трогали — сущность остаётся удалённой.
      } else {
        result.push(other);
        report.conflicts.push({ code: "deletedHere", entity, id, kept: "theirs", item: other });
        report.changes.push({ entity, id, action: "added", item: other });
      }
    }
  }

  return MERGE_ORDERED.includes(entity) ? mergeReorder(result) : result;
}

// Порядок коллекции со своим `order`: сначала по нему, при равенстве — по `id`,
// потом сплошная нумерация без дыр. Тем же порядком встаёт и запись, которую
// вернуло `mergeRestore`.
function mergeReorder(list) {
  const sorted = [...list].sort((a, b) => {
    const byOrder = (Number(a.order) || 0) - (Number(b.order) || 0);
    if (byOrder !== 0) return byOrder;
    return String(a.id) < String(b.id) ? -1 : 1;
  });
  return sorted.map((item, index) => (item.order === index ? item : { ...item, order: index }));
}

/**
 * Возвращает запись справочника, на которую в слитом объекте осталась ссылка.
 *
 * Модель не даёт удалить то, чем пользуются: `deleteCategory` отказывает, пока
 * у категории есть типы, `deleteType` — пока у типа есть метки,
 * `deleteEquipmentType` и `deleteEquipment` — пока на них ссылаются модели и
 * размещения. Через двух участников это правило обходится: у меня меток на
 * типе нет, я его удаляю; у вас в это же время появляется пять меток этого
 * типа. Раньше слияние соглашалось с удалением и сносило ваши метки — пять
 * строк «ссылка вела в никуда» и `clearHistory()` следом, вернуть нечем.
 *
 * Правило теперь то же, что у правки против удаления: **ссылка важнее
 * удаления.** Удалить запись на одной стороне было законно только потому, что
 * чужой работы не было видно.
 *
 * Чья версия возвращается: той стороны, у которой запись ещё жива — только она
 * могла её переименовать или перекрасить, у удалившей ничего нет. Живы обе
 * (запись унесло цепочкой, а не удалением) — версия победителя спора, как
 * везде. Не осталось ни у кого — из общего снимка. Каждое возвращение идёт в
 * `conflicts` строкой `restoredRef` с указанием версии.
 */
function mergeRestore(merged, entity, needed, sources, report, winner) {
  const live = mergeIndex(merged[entity]);
  const missing = [...needed].filter((id) => id && !live.has(id));
  if (missing.length === 0) return;
  const oursIndex = mergeIndex(mergeList(sources.ours, entity));
  const theirsIndex = mergeIndex(mergeList(sources.theirs, entity));
  const baseIndex = mergeIndex(mergeList(sources.base, entity));

  const restored = [];
  for (const id of missing.sort()) {
    const mine = oursIndex.get(id) || null;
    const other = theirsIndex.get(id) || null;
    let item = null;
    let kept = "base";
    if (mine && other) {
      item = winner === "theirs" ? other : mine;
      kept = winner;
    } else if (mine || other) {
      item = mine || other;
      kept = mine ? "ours" : "theirs";
    } else {
      item = baseIndex.get(id) || null;
    }
    // Вернуть неоткуда: записи нет ни у кого. Дальше сработает обычная чистка
    // висячих ссылок — она хотя бы скажет об этом вслух.
    if (!item) continue;
    restored.push(item);
    report.conflicts.push({ code: "restoredRef", entity, id, kept, item });
  }
  if (restored.length === 0) return;
  const next = [...merged[entity], ...restored];
  merged[entity] = MERGE_ORDERED.includes(entity) ? mergeReorder(next) : next;
}

// Чем пользуются: множество идентификаторов, на которые ссылается коллекция.
function mergeRefs(list, key) {
  const ids = new Set();
  for (const item of list) if (item && item[key]) ids.add(item[key]);
  return ids;
}

// Счётчики номеров: номер не переиспользуется, поэтому берётся больший.
function mergeCounters(ours, theirs) {
  const counters = { ...((ours && ours.counters) || {}) };
  for (const [code, value] of Object.entries((theirs && theirs.counters) || {})) {
    const mine = Number(counters[code]) || 0;
    const other = Number(value) || 0;
    counters[code] = Math.max(mine, other);
  }
  return counters;
}

/**
 * Кластеры совместного номера.
 *
 * Метки, уже стоявшие под одним обозначением **в одном объекте** — у нас, у
 * них или в общем предке, — спорить между собой не могут: это намеренный
 * повтор, приём заказчика (G25, G96), а не столкновение двух счётчиков.
 * Такие метки собираются в кластер и дальше живут одним номером на всех.
 *
 * Отношение считается по каждому обозначению отдельно: метки, делившие «Т1»,
 * не становятся роднёй под «С5», куда одна из них потом переехала.
 *
 * Возвращает `(key, markId) -> id кластера`; одиночка сама себе кластер.
 */
function mergeNumberClusters(sources, codes) {
  const byKey = new Map();
  const find = (parent, id) => {
    let root = id;
    while (parent.get(root) !== root) root = parent.get(root);
    let step = id;
    while (parent.get(step) !== root) {
      const next = parent.get(step);
      parent.set(step, root);
      step = next;
    }
    return root;
  };
  for (const source of sources) {
    if (!source) continue;
    const groups = new Map();
    for (const mark of mergeList(source, "marks")) {
      const code = mark && codes.get(mark.typeId);
      if (!code || typeof mark.id !== "string") continue;
      const key = code + "|" + mark.number;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(mark.id);
    }
    for (const [key, ids] of groups) {
      if (ids.length < 2) continue;
      let parent = byKey.get(key);
      if (!parent) {
        parent = new Map();
        byKey.set(key, parent);
      }
      for (const id of ids) if (!parent.has(id)) parent.set(id, id);
      const root = find(parent, ids[0]);
      for (const id of ids) {
        const other = find(parent, id);
        if (other !== root) parent.set(other, root);
      }
    }
  }
  return (key, markId) => {
    const parent = byKey.get(key);
    return parent && parent.has(markId) ? find(parent, markId) : markId;
  };
}

/**
 * Номера после слияния.
 *
 * Двое поставили по «Р15»: номер выдаётся счётчиком в пределах объекта, и в
 * разных браузерах он один и тот же. Разводить надо ровно такие метки — и
 * только их. Повтор номера сам по себе не поломка: несколько точечных
 * светильников одной группы носят «Т1» нарочно, модель это бережёт
 * (`compactNumbers`), и слияние обязано беречь тоже. Номер уже написан на
 * схеме, в таблице и в голове у монтажника, а результат слияния применяется
 * без спроса и обрывает историю — переписать его молча нельзя.
 *
 * Поэтому разводятся не метки, а **кластеры**: намеренная группа переезжает на
 * новый номер целиком, оставаясь группой. На номере остаётся кластер из общего
 * предка (его и написали на схеме), при равенстве — с меньшим id метки.
 * Правило симметрично: обе стороны считают его из одной пары и приходят к
 * одному ответу, иначе файлы в папке ходили бы по кругу.
 *
 * Возвращает `{marks, moves}`; `moves` — переезды намеренных повторов, по ним
 * переселяются принятые предупреждения.
 */
function mergeNumbers(marks, types, counters, sources, report) {
  const codes = new Map(types.map((type) => [type.id, type.code]));
  const known = mergeIndex(mergeList(sources.base, "marks"));
  const clusterOf = mergeNumberClusters([sources.base, sources.ours, sources.theirs], codes);

  const byKey = new Map();
  for (const mark of marks) {
    const code = codes.get(mark.typeId);
    if (!code || typeof mark.id !== "string") continue;
    const key = code + "|" + mark.number;
    let clusters = byKey.get(key);
    if (!clusters) {
      clusters = new Map();
      byKey.set(key, clusters);
    }
    const id = clusterOf(key, mark.id);
    let cluster = clusters.get(id);
    if (!cluster) {
      cluster = { key, code, number: mark.number, marks: [], inBase: false, minId: mark.id };
      clusters.set(id, cluster);
    }
    cluster.marks.push(mark);
    if (known.has(mark.id)) cluster.inBase = true;
    if (mark.id < cluster.minId) cluster.minId = mark.id;
  }

  // Занято всё, что в слитом объекте уже стоит: на каждом обозначении кто-то
  // да остаётся.
  const taken = new Set(byKey.keys());
  const moving = [];
  const staying = new Map();
  for (const [key, clusters] of byKey) {
    const list = [...clusters.values()];
    list.sort((a, b) => {
      const byBase = (a.inBase ? 0 : 1) - (b.inBase ? 0 : 1);
      if (byBase !== 0) return byBase;
      return a.minId < b.minId ? -1 : 1;
    });
    staying.set(key, list[0]);
    for (const cluster of list.slice(1)) moving.push(cluster);
  }
  if (moving.length === 0) return { marks, moves: [] };

  // Порядок выдачи не зависит от того, чей файл назвали «нашим».
  moving.sort((a, b) => (a.key === b.key ? (a.minId < b.minId ? -1 : 1) : a.key < b.key ? -1 : 1));

  const fixed = new Map();
  const moves = [];
  for (const cluster of moving) {
    const code = cluster.code;
    let next = Math.max(Number(counters[code]) || 0, Number(cluster.number) || 0);
    let candidate;
    do {
      next += 1;
      candidate = code + "|" + next;
    } while (taken.has(candidate) && next <= MARK_NUMBER_MAX);
    // Свободного номера в потолке `setMarkNumber` не нашлось. Выдать то, чего
    // руками не поставить, слияние не вправе — метка остаётся на своём номере,
    // а повтор покажет панель предупреждений.
    if (next > MARK_NUMBER_MAX) continue;
    taken.add(candidate);
    counters[code] = Math.max(Number(counters[code]) || 0, next);
    for (const mark of cluster.marks) fixed.set(mark.id, next);
    report.renumbered.push({
      markId: cluster.marks[0].id,
      markIds: cluster.marks.map((mark) => mark.id),
      code,
      from: cluster.number,
      to: next,
    });
    // Переехал намеренный повтор — вместе с ним переезжает и ответ «так и
    // задумано». Одиночной метке переносить нечего: вопроса о повторе на её
    // новом номере не возникнет.
    const typeIds = new Set(cluster.marks.map((mark) => mark.typeId));
    if (cluster.marks.length > 1 && typeIds.size === 1) {
      const rest = staying.get(cluster.key);
      moves.push({
        typeId: cluster.marks[0].typeId,
        code,
        from: cluster.number,
        to: next,
        // Старый номер остаётся повтором — значит вопрос там не снят, и ответ
        // не переезжает, а копируется.
        keepFrom: rest.marks.length > 1 && rest.marks[0].typeId === cluster.marks[0].typeId,
      });
    }
  }
  return {
    marks: marks.map((mark) => (fixed.has(mark.id) ? { ...mark, number: fixed.get(mark.id) } : mark)),
    moves,
  };
}

/**
 * Ссылки на то, чего в слитом объекте нет.
 *
 * Два разных случая, и путать их нельзя.
 *
 * **Справочник.** Категорию, тип метки, тип оборудования и модель модель
 * удалить, пока на них ссылаются, не даёт вовсе. Значит такое удаление здесь
 * не выполняется, а откатывается: запись возвращается (`mergeRestore`), и
 * ручная работа второго участника остаётся на месте.
 *
 * **Схема и помещение.** Их модель удалять разрешает и сама описывает, что при
 * этом уходит: `deleteScheme` уносит свои метки, блоки, контуры и размещения,
 * `deleteRoom` — свои контуры, а меткам обнуляет помещение. Слияние повторяет
 * её правило, а не выдумывает своё: воскрешать схему было бы гаданием ещё и
 * потому, что подложка лежит вне объекта. Каждая потеря — в отчёт, и само
 * удаление схемы или комнаты уже стоит там строкой «удалено: …».
 */
function mergeReferences(merged, report, sources, winner) {
  const schemes = mergeIndex(merged.schemes);
  const rooms = mergeIndex(merged.rooms);

  // Метка без схемы уходит вместе со схемой — по правилу `deleteScheme`.
  merged.marks = merged.marks.filter((mark) => {
    if (schemes.has(mark.schemeId)) return true;
    report.conflicts.push({ code: "danglingRef", entity: "marks", id: mark.id, kept: "none", item: mark });
    return false;
  });

  // Тип, на котором остались метки, и категория, на которой остались типы,
  // возвращаются: `typeHasMarks` и `categoryHasTypes` такого удаления не
  // допускают. Порядок важен — у вернувшегося типа тоже должна быть категория.
  mergeRestore(merged, "markTypes", mergeRefs(merged.marks, "typeId"), sources, report, winner);
  mergeRestore(merged, "categories", mergeRefs(merged.markTypes, "categoryId"), sources, report, winner);

  const categories = mergeIndex(merged.categories);
  merged.markTypes = merged.markTypes.filter((type) => {
    if (categories.has(type.categoryId)) return true;
    report.conflicts.push({ code: "danglingRef", entity: "markTypes", id: type.id, kept: "none", item: type });
    return false;
  });
  const liveTypes = mergeIndex(merged.markTypes);

  merged.marks = merged.marks.filter((mark) => {
    if (liveTypes.has(mark.typeId)) return true;
    report.conflicts.push({ code: "danglingRef", entity: "marks", id: mark.id, kept: "none", item: mark });
    return false;
  });
  const marks = mergeIndex(merged.marks);

  merged.groups = merged.groups
    .map((group) => {
      const markIds = (group.markIds || []).filter((id) => marks.has(id));
      return markIds.length === group.markIds.length ? group : { ...group, markIds };
    })
    .filter((group) => {
      if (schemes.has(group.schemeId) && (group.markIds || []).length > 1) return true;
      report.conflicts.push({ code: "danglingRef", entity: "groups", id: group.id, kept: "none", item: group });
      return false;
    });
  const groups = mergeIndex(merged.groups);

  merged.outlines = merged.outlines.filter((outline) => {
    if (schemes.has(outline.schemeId) && rooms.has(outline.roomId)) return true;
    report.conflicts.push({ code: "danglingRef", entity: "outlines", id: outline.id, kept: "none", item: outline });
    return false;
  });

  // Тип модели и сама модель — такой же справочник: `equipmentTypeInUse` и
  // `equipmentInUse` удалить их «под» чужой работой не дают. Модель возвращаем
  // ради размещений, которые пережили чистку меток.
  mergeRestore(merged, "equipmentTypes", mergeRefs(merged.equipment, "typeId"), sources, report, winner);
  const placed = merged.placements.filter((placement) => marks.has(placement.markId));
  mergeRestore(merged, "equipment", mergeRefs(placed, "equipmentId"), sources, report, winner);

  // Вернуть тип модели оказалось неоткуда. Тип у единицы необязателен («тип не
  // заполнен» — не поломка), а ссылка в никуда читается как пустая колонка и
  // молчит, — поэтому поле чистим, но вслух.
  const equipmentTypes = mergeIndex(merged.equipmentTypes);
  merged.equipment = merged.equipment.map((item) => {
    if (!item.typeId || equipmentTypes.has(item.typeId)) return item;
    report.conflicts.push({ code: "danglingType", entity: "equipment", id: item.id, kept: "ours", item });
    return { ...item, typeId: "" };
  });

  const equipment = mergeIndex(merged.equipment);
  merged.placements = merged.placements
    .map((placement) => {
      const links = Array.isArray(placement.links) ? placement.links.filter((id) => marks.has(id)) : placement.links;
      return Array.isArray(links) && links.length !== placement.links.length ? { ...placement, links } : placement;
    })
    .filter((placement) => {
      if (equipment.has(placement.equipmentId) && marks.has(placement.markId)) return true;
      report.conflicts.push({ code: "danglingRef", entity: "placements", id: placement.id, kept: "none", item: placement });
      return false;
    });

  merged.marks = merged.marks.map((mark) => {
    const patch = {};
    if (mark.groupId && !groups.has(mark.groupId)) patch.groupId = null;
    if (mark.roomId && !rooms.has(mark.roomId)) patch.roomId = null;
    // Канал — часть связи, и записи перекладываются **как есть**: связь без
    // канала записана строкой, связь с каналом — объектом `{id, channel}`, и
    // пересборка списка из одних идентификаторов теряла бы канал на каждом
    // слиянии. Отсюда же и `id` берётся из обеих форм, а не прямо из элемента.
    const controls = Array.isArray(mark.controls)
      ? mark.controls.filter((item) => marks.has(typeof item === "string" ? item : item && item.id))
      : mark.controls;
    if (Array.isArray(controls) && controls.length !== mark.controls.length) patch.controls = controls;
    return Object.keys(patch).length === 0 ? mark : { ...mark, ...patch };
  });
  return merged;
}

/**
 * Сливает два экземпляра одного объекта.
 *
 * `base` — общий предок (последний снимок, который видели обе стороны); без
 * него слияние становится объединением: удаления не видны, потому что «нет
 * сущности» и «сущность удалили» снаружи выглядят одинаково.
 *
 * Возвращает `{project, changed, changes, conflicts, renumbered, counts}`:
 * `changes` — что пришло со стороны (added | updated | removed) с подписью
 * каждой сущности, `conflicts` — где стороны разошлись и чей вариант оставлен.
 */
export function mergeProjects(ours, theirs, base, options = {}) {
  if (!ours || !theirs) return { project: ours || theirs || null, changed: false, changes: [], conflicts: [], renumbered: [], counts: { added: 0, updated: 0, removed: 0, conflicts: 0, renumbered: 0 } };

  const winner = options.winner === "ours" || options.winner === "theirs" ? options.winner : mergeWinner(ours, theirs);
  const ancestor = base && areRelatedProjects(ours, base) ? base : null;
  const report = { changes: [], conflicts: [], renumbered: [] };

  const merged = { ...ours };
  // Коллекция, которой не знала ни одна сторона, так и остаётся незаведённой:
  // список пуст и заводить его не на чем.
  const absent = [];
  for (const entity of MERGE_ENTITIES) {
    merged[entity] = mergeCollection(entity, ours, theirs, ancestor, report, winner);
    if (
      MERGE_OPTIONAL.includes(entity) &&
      !Array.isArray(ours[entity]) &&
      !Array.isArray(theirs[entity])
    ) {
      absent.push(entity);
    }
  }

  const sources = { ours, theirs, base: ancestor };
  merged.counters = mergeCounters(ours, theirs);
  mergeAccepted(merged, ours, theirs);
  // Сначала состав, потом номера: вернувшийся тип приводит с собой свои метки,
  // и разводить обозначения надо уже по окончательному списку.
  mergeReferences(merged, report, sources, winner);
  const numbered = mergeNumbers(merged.marks, merged.markTypes, merged.counters, sources, report);
  merged.marks = numbered.marks;
  // Ответы «так и задумано» едут за своими обозначениями: вопрос уже задан и
  // закрыт, а переспросить слияние не может — оно применяется молча.
  const accepted = renumberAcceptedRepeats(merged, numbered.moves);
  if (accepted) merged.accepted = accepted;
  for (const entity of absent) {
    if (merged[entity].length === 0) delete merged[entity];
  }

  // Имя и настройки вида — те же правила, что и у сущностей.
  if (!mergeSame(ours.name, theirs.name)) {
    const keptName = winner === "theirs" ? theirs.name : ours.name;
    merged.name = keptName;
    report.conflicts.push({ code: "bothChanged", entity: "name", id: ours.id, kept: winner, item: { name: keptName }, other: { name: winner === "theirs" ? ours.name : theirs.name } });
  }
  if (!mergeSame(ours.view, theirs.view)) merged.view = winner === "theirs" ? theirs.view : ours.view;
  // Ключ проекта сходится. Есть у одного — берут оба: это факт, а не мнение, и
  // после первой же встречи родство перестаёт быть догадкой. Есть у обоих и
  // разные (копии разошлись до появления ключей) — берётся меньший по строке:
  // правило одинаково с обеих сторон, поэтому за один обмен файлами ключ у них
  // становится общим. Нет ни у кого — поле не заводится, старый объект
  // остаётся прежним.
  const mergedKey = mergeMergeKeys(mergeKeyOf(ours), mergeKeyOf(theirs));
  if (mergedKey) merged.key = mergedKey;
  if (theirs.createdAt && (!merged.createdAt || theirs.createdAt < merged.createdAt)) merged.createdAt = theirs.createdAt;
  merged.updatedAt = String(theirs.updatedAt || "") > String(ours.updatedAt || "") ? theirs.updatedAt : ours.updatedAt;

  // Подписи для отчёта считаются по слитому справочнику: тип метки мог приехать
  // тем же слиянием.
  const typeCodes = new Map(merged.markTypes.map((type) => [type.id, type.code]));
  for (const change of report.changes) change.label = mergeLabel(change.entity, change.item, typeCodes);
  for (const conflict of report.conflicts) conflict.label = mergeLabel(conflict.entity, conflict.item, typeCodes);

  const counts = {
    added: report.changes.filter((change) => change.action === "added").length,
    updated: report.changes.filter((change) => change.action === "updated").length,
    removed: report.changes.filter((change) => change.action === "removed").length,
    conflicts: report.conflicts.length,
    renumbered: report.renumbered.length,
  };

  // Слияние, в котором не изменилось ничего, кроме служебных полей — ключа
  // проекта и отметки времени, — применяется молча: показывать «приехали
  // правки: 0» и обрывать историю не за что. Работой это не является ни в
  // каком смысле, а ключ до объекта доехать должен.
  const quiet = mergeSame({ ...ours, key: merged.key, updatedAt: merged.updatedAt }, merged);

  return {
    project: merged,
    changed: !mergeSame(ours, merged),
    quiet,
    changes: report.changes,
    conflicts: report.conflicts,
    renumbered: report.renumbered,
    counts,
  };
}
