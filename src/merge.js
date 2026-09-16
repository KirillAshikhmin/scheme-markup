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

// Сущности объекта, которые сливаются поимённо, по `id`.
export const MERGE_ENTITIES = [
  "categories",
  "markTypes",
  "rooms",
  "schemes",
  "marks",
  "groups",
  "outlines",
  "equipment",
  "placements",
];

// Коллекции, у которых есть поле `order`: после слияния порядок пересобирается.
const MERGE_ORDERED = ["categories", "markTypes", "schemes", "equipment"];

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

/**
 * Об одном ли объекте речь. Два человека получают проект из одного файла, и
 * идентификаторы схем и меток у них общие (свой `id` объекта и свои id картинок
 * каждый браузер выдаёт сам). Ничего общего — значит, это чужой файл, сливать
 * его нельзя.
 */
export function areRelatedProjects(ours, theirs) {
  if (!ours || !theirs) return false;
  if (ours.id && ours.id === theirs.id) return true;
  for (const key of ["schemes", "marks", "rooms", "markTypes"]) {
    const mine = mergeIndex(mergeList(ours, key));
    for (const item of mergeList(theirs, key)) {
      if (mine.has(item.id)) return true;
    }
  }
  return false;
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

  if (MERGE_ORDERED.includes(entity)) {
    result.sort((a, b) => {
      const byOrder = (Number(a.order) || 0) - (Number(b.order) || 0);
      if (byOrder !== 0) return byOrder;
      return String(a.id) < String(b.id) ? -1 : 1;
    });
    return result.map((item, index) => (item.order === index ? item : { ...item, order: index }));
  }
  return result;
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

// Двое поставили по «Р15»: номер выдаётся счётчиком в пределах объекта, и в
// разных браузерах он один и тот же. Разъезжаются такие метки здесь — тому,
// кто был в общем предке, номер оставляем (его уже написали на схеме и в
// таблице), новой метке выдаём следующий свободный.
function mergeNumbers(marks, types, counters, base, report) {
  const codes = new Map(types.map((type) => [type.id, type.code]));
  const known = mergeIndex(mergeList(base, "marks"));
  const order = marks.map((mark, index) => ({ mark, index }));
  order.sort((a, b) => {
    const mineFirst = (known.has(a.mark.id) ? 0 : 1) - (known.has(b.mark.id) ? 0 : 1);
    if (mineFirst !== 0) return mineFirst;
    return String(a.mark.id) < String(b.mark.id) ? -1 : 1;
  });

  const taken = new Set();
  const fixed = new Map();
  for (const { mark } of order) {
    const code = codes.get(mark.typeId);
    if (!code) continue;
    const key = code + "|" + mark.number;
    if (!taken.has(key)) {
      taken.add(key);
      continue;
    }
    let next = Math.max(Number(counters[code]) || 0, Number(mark.number) || 0);
    let candidate;
    do {
      next += 1;
      candidate = code + "|" + next;
    } while (taken.has(candidate));
    taken.add(candidate);
    counters[code] = Math.max(Number(counters[code]) || 0, next);
    fixed.set(mark.id, next);
    report.renumbered.push({ markId: mark.id, code, from: mark.number, to: next });
  }
  if (fixed.size === 0) return marks;
  return marks.map((mark) => (fixed.has(mark.id) ? { ...mark, number: fixed.get(mark.id) } : mark));
}

// Ссылки на то, чего в слитом объекте нет: висячая ссылка хуже отсутствующей.
// Снимается одним проходом, каждая потеря — в отчёт.
function mergeReferences(merged, report) {
  const schemes = mergeIndex(merged.schemes);
  const rooms = mergeIndex(merged.rooms);
  const types = mergeIndex(merged.markTypes);
  const categories = mergeIndex(merged.categories);

  merged.markTypes = merged.markTypes.filter((type) => {
    if (categories.has(type.categoryId)) return true;
    report.conflicts.push({ code: "danglingRef", entity: "markTypes", id: type.id, kept: "none", item: type });
    return false;
  });
  const liveTypes = mergeIndex(merged.markTypes);

  merged.marks = merged.marks.filter((mark) => {
    if (schemes.has(mark.schemeId) && liveTypes.has(mark.typeId)) return true;
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
    const controls = Array.isArray(mark.controls) ? mark.controls.filter((id) => marks.has(id)) : mark.controls;
    if (Array.isArray(controls) && controls.length !== mark.controls.length) patch.controls = controls;
    return Object.keys(patch).length === 0 ? mark : { ...mark, ...patch };
  });
  // Типы после чистки могли уехать: `types` держим ради ясности сравнения выше.
  void types;
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
  for (const entity of MERGE_ENTITIES) {
    merged[entity] = mergeCollection(entity, ours, theirs, ancestor, report, winner);
  }

  merged.counters = mergeCounters(ours, theirs);
  merged.marks = mergeNumbers(merged.marks, merged.markTypes, merged.counters, ancestor, report);
  mergeReferences(merged, report);

  // Имя и настройки вида — те же правила, что и у сущностей.
  if (!mergeSame(ours.name, theirs.name)) {
    const keptName = winner === "theirs" ? theirs.name : ours.name;
    merged.name = keptName;
    report.conflicts.push({ code: "bothChanged", entity: "name", id: ours.id, kept: winner, item: { name: keptName }, other: { name: winner === "theirs" ? ours.name : theirs.name } });
  }
  if (!mergeSame(ours.view, theirs.view)) merged.view = winner === "theirs" ? theirs.view : ours.view;
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

  return {
    project: merged,
    changed: !mergeSame(ours, merged),
    changes: report.changes,
    conflicts: report.conflicts,
    renumbered: report.renumbered,
    counts,
  };
}
