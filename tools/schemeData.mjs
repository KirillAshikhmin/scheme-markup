// Сведения об объекте **без браузера**: одна дверь к модулям сборки.
//
// Файл объекта — это zip с `project.json`, а метки, типы, помещения, стены,
// проёмы, вещи и связи читаются оттуда теми же модулями, которыми их читает
// страница (`projectFile.js`, `model.js`, `tables.js`). Браузер для этого не
// нужен вовсе: он нужен только тому, что **рисуется** — см. `schemeSheets.mjs`.
//
// Правила этого файла:
//
// 1. **Второго счёта здесь нет.** Площадь, длина, высота, габарит, подпись
//    блока, порядок типов и состав таблиц берутся у модели и у `tables.js`.
//    Своего в модуле ровно две вещи, и обе названы вслух: перевод площади
//    контура из долей в квадратные метры (`outlineAreaM2` — у страницы такой
//    двери нет, она площадь помещения не показывает) и склейка записей в
//    простую таблицу, которую потом печатает **чужой** `toCsv`/`toMarkdown`.
// 2. **Объект только читается** (G68). Ни одна функция не зовёт мутаторов
//    модели, файл открывается на чтение, и после прогона он байт в байт тот
//    же. Проверять это глазами не нужно: мутаторы модели возвращают новый
//    объект и в `project.json` сами ничего не пишут — писать умеет только
//    страница через `store.js`.
// 3. **Единицы названы в ключах.** `...Mm` — миллиметры чертежа, `...M` —
//    метры, `...M2` — квадратные метры, `...Px` — пиксели плана, `...Deg` —
//    градусы. Безымянных чисел наружу не выходит.
//
// Имена модели берутся пространством (`model.*`) нарочно: модуль — дверь к
// шести десяткам её функций, и перечислять их по именам в заголовке значило бы
// держать второй список того же.
import { readFileSync } from "node:fs";
import * as model from "../src/model.js";
import { unpackProject } from "../src/projectFile.js";
import { equipmentTable, linksTable, marksTable, tableSections, toCsv, toMarkdown, toTsv, typesTable } from "../src/tables.js";
import { markSizesLabel, markSizesOrder } from "../src/panels/markSizes.js";

/** Округление для вывода: метры и квадратные метры — два знака, не больше. */
function round(value, digits = 2) {
  const number = Number(value);
  if (value === null || value === undefined || !Number.isFinite(number)) return null;
  const factor = 10 ** digits;
  return Math.round(number * factor) / factor;
}

/**
 * Открыть файл объекта. Отдаёт то же, что страница получает из окна загрузки:
 * объект, картинки планов и отметку участника.
 *
 * `unpackProject` сам прогоняет миграции формата — значит объект прежней
 * разметки читается так же, как его прочитала бы страница, и ни одно поле не
 * выводится здесь заново (G68).
 */
export async function openObject(file) {
  const bytes = readFileSync(file);
  const { project, images, member } = await unpackProject(new Blob([bytes]));
  return { file, bytesInFile: bytes.length, project, images, member };
}

/**
 * Какая схема имелась в виду. `query` — номер в списке (1, 2, …), часть имени
 * или `all`. Пусто — первая схема: у объекта с одной схемой спрашивать нечего.
 *
 * Порядок берётся у `schemesInOrder`: номер в этой команде и номер в списке
 * схем на странице обязаны значить одно и то же.
 */
export function pickSchemes(project, query) {
  const all = model.schemesInOrder(project);
  if (!query) return all.slice(0, 1);
  if (String(query).toLowerCase() === "all" || query === "*") return all;
  const index = Number(query);
  if (Number.isInteger(index) && index >= 1 && index <= all.length) return [all[index - 1]];
  const needle = String(query).toLowerCase();
  const found = all.filter((scheme) => String(scheme.name || "").toLowerCase().includes(needle));
  if (found.length === 0) throw new Error("схема не найдена: " + query);
  return found;
}

/** Помещение по части имени. Пусто — все помещения. */
export function pickRooms(project, query) {
  const all = model.roomsInOrder(project);
  if (!query) return all;
  const needle = String(query).toLowerCase();
  const found = all.filter((room) => String(room.name || "").toLowerCase().includes(needle));
  if (found.length === 0) throw new Error("помещение не найдено: " + query);
  return found;
}

// ——— сведения об объекте ————————————————————————————————————————————————

function schemeRecord(project, scheme, index, images) {
  const sizeM = model.planSizeMeters(project, scheme.id);
  const scale = model.planScaleOf(project, scheme.id);
  const origin = model.planOriginOf(project, scheme.id);
  const height = model.wallHeightShownMm(project, { schemeId: scheme.id });
  const image = images ? images.get(scheme.imageId) : null;
  const walls = model.wallsOnScheme(project, scheme.id);
  return {
    index: index + 1,
    id: scheme.id,
    name: scheme.name,
    floor: model.schemeFloorOf(project, scheme.id),
    planPx: { width: model.schemeWidthPx(scheme), height: model.schemeHeightPx(scheme) },
    planM: sizeM ? { width: round(sizeM.width), height: round(sizeM.height) } : null,
    pixelsPerMeter: round(model.planPixelsPerMeter(project, scheme.id), 1) || null,
    // Калибровка: что человек сказал отрезком, а не выведенное из него число.
    calibration: scale ? { meters: scale.meters, setAt: scale.setAt || null } : null,
    // Привязка чертежа к подложке (ADR 008): без неё миллиметры не от чего
    // считать. Точка нуля чертежа — **доля** плана, а не пиксели и не
    // миллиметры (ADR 002), поэтому ключ называется долей.
    originShare: origin ? { x: origin.at.x, y: origin.at.y, turnDeg: origin.turn } : null,
    // Привязка этажей — та вещь, по которой объём сшивает стопку (лестница, выход, лифт).
    floorAnchorMm: model.schemeAnchorOf(project, scheme.id),
    wallHeightMm: height.mm,
    wallHeightKnown: height.known,
    imageBytes: image ? image.size : null,
    imageType: image ? image.type || null : null,
    counts: {
      marks: model.listedMarks(project.marks.filter((mark) => mark.schemeId === scheme.id)).length,
      comments: project.marks.filter((mark) => mark.schemeId === scheme.id && model.markIsComment(mark)).length,
      rooms: model.outlinesInOrder(project, scheme.id).length,
      walls: walls.length,
      openings: walls.reduce((sum, wall) => sum + model.openingsInWall(project, wall.id).length, 0),
      objects: model.schemeObjectsOnScheme(project, scheme.id).length,
    },
  };
}

/** Сведения об объекте и его схемах — первое, что спрашивают у файла. */
export function objectInfo(project, { images = null, file = null, bytesInFile = null } = {}) {
  const site = model.projectSite(project);
  const coords = model.projectCoords(project);
  const schemes = model.schemesInOrder(project);
  return {
    file,
    bytesInFile,
    object: {
      id: project.id,
      name: project.name,
      formatVersion: model.projectFormatVersion(project),
      createdAt: project.createdAt || null,
      updatedAt: project.updatedAt || null,
      address: site.address || "",
      coords: coords ? { lat: coords.lat, lon: coords.lon } : null,
      // Градусы от севера по часовой (таск 188): 90° — верх чертежа на восток.
      // Ничего не рисует, кроме солнца и месяца в объёме.
      topAzimuthDeg: site.topAzimuthDeg,
      topRhumb: model.azimuthRhumb(site.topAzimuthDeg),
      stamp: model.projectStamp(project),
      gridStepMm: model.gridStepOf(project),
    },
    counts: {
      schemes: schemes.length,
      marks: model.listedMarks(project.marks).length,
      comments: project.marks.filter((mark) => model.markIsComment(mark)).length,
      types: model.typesInOrder(project).reduce((sum, group) => sum + group.types.length, 0),
      categories: model.typesInOrder(project).length,
      rooms: model.roomsInOrder(project).length,
      outlines: (project.outlines || []).length,
      groups: (project.groups || []).length,
      walls: (project.walls || []).length,
      openings: (project.openings || []).length,
      objects: (project.schemeObjects || []).length,
      equipment: model.equipmentInOrder(project).length,
      placements: model.placementsInOrder(project).length,
      images: images ? images.size : null,
    },
    schemes: schemes.map((scheme, index) => schemeRecord(project, scheme, index, images)),
  };
}

// ——— метки ——————————————————————————————————————————————————————————————

/**
 * Запись метки: всё, что о ней знает объект, одной строкой.
 *
 * Размеры отдаются **и ключами файла, и подписями**: ключи в файле врут, а
 * подписи нет (таск 158) — `width` это «Высота», `depth` это «Ширина», а у
 * вещи лицом вниз эти двое меняются именами. Поэтому рядом с `sizesMm` стоит
 * `sizesLabelled`, где имя оси взято у страницы (`markSizesLabel` по посадке
 * `markAxisSeat`), и в документацию надо брать его, а не ключ файла.
 *
 * Числа — **действующие**: своё число метки, унаследованное от группы или
 * умолчание типа; откуда взято каждое, говорит `sizesFrom` (`own`, `group`,
 * `type`, `null`). Своего вывода здесь нет — это `model.markSizes`.
 */
function markRecord(project, mark) {
  const type = model.findType(project, mark.typeId);
  const category = type ? model.findCategory(project, type.categoryId) : null;
  const room = mark.roomId ? model.findRoom(project, mark.roomId) : null;
  const scheme = model.findScheme(project, mark.schemeId);
  const sizes = model.markSizes(project, mark);
  const seat = model.markAxisSeat(project, mark);
  const binding = model.markWall(mark);
  const style = model.styleOf(project, mark.typeId);
  const channels = model.markControlsByChannel(project, mark.id);
  return {
    id: mark.id,
    label: model.labelOf(project, mark.id),
    typeCode: type ? type.code : "",
    typeName: type ? type.name : "",
    category: category ? category.name : "",
    kind: mark.kind,
    scheme: scheme ? scheme.name : "",
    floor: model.schemeFloorOf(project, mark.schemeId),
    room: room ? room.name : "",
    location: mark.location || "",
    original: mark.original || "",
    comment: model.markIsComment(mark) ? model.markCommentText(mark) : "",
    points: mark.points.length,
    // Длина линейной метки — метры по калибровке плана; у точечной её нет.
    lengthM: round(model.markLengthMeters(project, mark.id)),
    sizesMm: {
      length: sizes.length,
      depth: sizes.depth,
      width: sizes.width,
      heightAboveFloor: sizes.heightAboveFloor,
    },
    sizesFrom: {
      length: sizes.lengthFrom,
      depth: sizes.depthFrom,
      width: sizes.widthFrom,
      heightAboveFloor: sizes.heightAboveFloorFrom,
    },
    // Те же числа под **честными** подписями: имя оси берёт `markSizesLabel`
    // по посадке, и в документацию надо брать эту пару, а не ключи файла.
    sizesLabelled: Object.fromEntries(
      markSizesOrder(seat).map((field) => [markSizesLabel(field, seat), sizes[field]]),
    ),
    seat,
    group: mark.groupId ? model.blockLabel(project, model.findGroup(project, mark.groupId).markIds) : "",
    wall: binding
      ? {
          name: model.wallName(project, binding.wallId),
          side: model.markWallSide(project, mark),
          atMm: binding.atMm,
          toMm: binding.toMm,
          manual: model.markWallManual(mark),
        }
      : null,
    // Связи: что метка включает по каналам и кто включает её.
    channels: channels.map((item) => ({
      channel: item.channel,
      label: model.channelLabel(item.channel),
      marks: item.marks.map((linked) => model.labelOf(project, linked.id)),
    })),
    controlledBy: model.markControlledBy(project, mark.id).map((item) => model.labelOf(project, item.id)),
    equipment: model.placementsAt(project, mark.id).map((placement) => {
      const found = model.findEquipment(project, placement.equipmentId);
      return found ? found.name : "";
    }),
    color: style.color,
    shape: mark.kind === "line" ? null : style.shape,
    lineStyle: mark.kind === "line" ? style.lineStyle : null,
  };
}

/**
 * Метки объекта. `filter` — сужение по схеме и помещению; пусто — все метки.
 *
 * Порядок — те же два ключа, по которым строки встают в таблице страницы
 * (`tables.tableTypeOrder`): порядок типа в справочнике, внутри — номер.
 * Порядок справочника спрашивается у модели (`typesInOrder`), своей сортировки
 * типов здесь нет.
 *
 * Строка на метку, а не на блок: блок «Р1 Р2 Р3» — три позиции, и сворачивает
 * их только таблица (`--format csv`), а не этот список.
 */
export function objectMarks(project, { filter = null } = {}) {
  const order = new Map();
  let at = 0;
  for (const group of model.typesInOrder(project)) {
    for (const type of group.types) order.set(type.id, (at += 1));
  }
  const marks = model.listedMarks(project.marks).filter((mark) => {
    if (!filter) return true;
    if (filter.schemeId && mark.schemeId !== filter.schemeId) return false;
    if (filter.roomId && mark.roomId !== filter.roomId) return false;
    return true;
  });
  return marks
    .slice()
    .sort((first, second) => {
      const byType = (order.get(first.typeId) || 9999) - (order.get(second.typeId) || 9999);
      return byType !== 0 ? byType : (first.number || 0) - (second.number || 0);
    })
    .map((mark) => markRecord(project, mark));
}

// ——— справочник типов ———————————————————————————————————————————————————

/** Справочник типов: по категориям, в порядке страницы. */
export function objectTypes(project) {
  const used = new Map();
  for (const mark of model.listedMarks(project.marks)) {
    used.set(mark.typeId, (used.get(mark.typeId) || 0) + 1);
  }
  const out = [];
  for (const group of model.typesInOrder(project)) {
    for (const type of group.types) {
      const style = model.styleOf(project, type.id);
      const sizes = model.typeSizes(type);
      out.push({
        id: type.id,
        code: type.code,
        name: type.name,
        category: group.category.name,
        categoryColor: group.category.color,
        kind: model.typeKindOf(project, type.id),
        color: style.color,
        shape: style.shape,
        lineStyle: style.lineStyle,
        blockMode: type.blockMode || "each",
        channels: model.typeChannels(project, type.id),
        // Изображение вещи у типа — имя вида из встроенного набора, не файл.
        view: model.typeObjectView(type),
        sizesMm: sizes,
        seat: model.typeAxisSeat(type),
        marks: used.get(type.id) || 0,
      });
    }
  }
  return out;
}

// ——— помещения ——————————————————————————————————————————————————————————

/**
 * Площадь контура в квадратных метрах.
 *
 * **Это единственный счёт, которого у страницы нет** (площадь помещения она не
 * показывает нигде, кроме обводки по стенам). Поэтому он один, лежит здесь и
 * собран из дверей модели: доли площади (`outlineArea`), размер плана
 * (`schemeWidthPx`/`schemeHeightPx`) и пикселей на метр (`planPixelsPerMeter`).
 * Без калибровки — `null`: придуманной площади наружу не выходит.
 */
export function outlineAreaM2(project, outline) {
  const perMeter = model.planPixelsPerMeter(project, outline.schemeId);
  if (!(perMeter > 0)) return null;
  const scheme = model.findScheme(project, outline.schemeId);
  const areaPx = model.outlineArea(outline.points) * model.schemeWidthPx(scheme) * model.schemeHeightPx(scheme);
  return areaPx / (perMeter * perMeter);
}

/** Периметр контура в метрах — `planLengthMeters` по замкнутой ломаной. */
export function outlinePerimeterM(project, outline) {
  return model.planLengthMeters(project, outline.schemeId, outline.points, true);
}

/** Помещения: площадь, периметр, высота стен и сколько в них чего стоит. */
export function objectRooms(project, { schemeId = null } = {}) {
  const outlines = (project.outlines || []).filter((outline) => !schemeId || outline.schemeId === schemeId);
  return model.roomsInOrder(project).map((room) => {
    const mine = outlines.filter((outline) => outline.roomId === room.id);
    const marks = model
      .listedMarks(project.marks)
      .filter((mark) => mark.roomId === room.id && (!schemeId || mark.schemeId === schemeId));
    const byCategory = new Map();
    for (const mark of marks) {
      const type = model.findType(project, mark.typeId);
      const category = type ? model.findCategory(project, type.categoryId) : null;
      const key = category ? category.name : "";
      byCategory.set(key, (byCategory.get(key) || 0) + 1);
    }
    const areas = mine.map((outline) => outlineAreaM2(project, outline)).filter((value) => value !== null);
    // Высоту спрашиваем **со схемой**: без неё вывод незаданной высоты не знает,
    // над чем подниматься (`wallHeightShownMm` смотрит самое высокое на схеме).
    const height = model.wallHeightShownMm(project, {
      schemeId: mine.length > 0 ? mine[0].schemeId : schemeId,
      roomId: room.id,
    });
    return {
      id: room.id,
      name: room.name,
      color: room.color || null,
      // Контур принадлежит схеме: у комнаты, обведённой на двух этажах, их два.
      outlines: mine.map((outline) => {
        const scheme = model.findScheme(project, outline.schemeId);
        return {
          scheme: scheme ? scheme.name : "",
          floor: model.schemeFloorOf(project, outline.schemeId),
          points: outline.points.length,
          areaM2: round(outlineAreaM2(project, outline)),
          perimeterM: round(outlinePerimeterM(project, outline)),
        };
      }),
      // Сумма по контурам, а не первый из них: у комнаты бывает два обвода —
      // свой на каждом этаже или вырез отдельным контуром, — и площадь с
      // периметром обязаны считать все.
      areaM2: areas.length > 0 ? round(areas.reduce((sum, value) => sum + value, 0)) : null,
      perimeterM: (() => {
        const list = mine.map((outline) => outlinePerimeterM(project, outline)).filter((value) => value !== null);
        return list.length > 0 ? round(list.reduce((sum, value) => sum + value, 0)) : null;
      })(),
      wallHeightMm: height.mm,
      wallHeightKnown: height.known,
      hasFloor: model.roomHasFloor(project, room.id),
      marks: marks.length,
      marksByCategory: Object.fromEntries(byCategory),
    };
  });
}

// ——— чертёж ——————————————————————————————————————————————————————————————

/** Чертёж схемы: стены, проёмы и вещи каталога — в миллиметрах чертежа. */
export function objectDrawing(project, { schemeId } = {}) {
  const walls = model.wallsOnScheme(project, schemeId);
  const bounds = model.drawingBoundsMm(project, schemeId);
  return {
    schemeId,
    boundsMm: bounds,
    walls: walls.map((wall) => ({
      id: wall.id,
      name: model.wallName(project, wall.id),
      aMm: wall.aMm,
      bMm: wall.bMm,
      lengthMm: model.wallLengthMm(wall),
      thicknessMm: wall.thicknessMm,
      heightMm: wall.heightMm === undefined ? null : wall.heightMm,
      openings: model.openingsInWall(project, wall.id).length,
    })),
    openings: walls.flatMap((wall) =>
      model.openingsInWall(project, wall.id).map((opening) => ({
        id: opening.id,
        wall: model.wallName(project, wall.id),
        kind: opening.kind,
        title: model.openingTitle(opening),
        atMm: opening.atMm,
        widthMm: opening.widthMm,
        heightMm: opening.heightMm,
        heightAboveFloorMm: opening.heightAboveFloorMm,
        glazed: model.openingGlazed(opening),
        leaves: model.openingLeavesOf(opening.kind),
        hinge: opening.hinge || null,
        swing: opening.swing || null,
      })),
    ),
    objects: model.schemeObjectsOnScheme(project, schemeId).map((object) => ({
      id: object.id,
      key: model.schemeObjectKeyOf(project, object),
      name: model.schemeObjectNameOf(project, object),
      mount: model.schemeObjectMountOf(project, object),
      shape: object.shape,
      atMm: object.atMm || null,
      widthMm: object.widthMm === undefined ? null : object.widthMm,
      depthMm: object.depthMm === undefined ? null : object.depthMm,
      heightMm: object.heightMm === undefined ? null : object.heightMm,
      heightAboveFloorMm: object.heightAboveFloorMm === undefined ? null : object.heightAboveFloorMm,
      topMm: model.schemeObjectTopMm(object),
      turnDeg: model.schemeObjectTurnDeg(object.turnDeg),
    })),
  };
}

// ——— развёртки стен данными ——————————————————————————————————————————————

/**
 * Развёртки стен: что стоит на каждой стене и на каком месте.
 *
 * Считает это `model.wallElevation` — та же функция, по которой развёртка
 * рисуется на экране и на листе. Поэтому числа здесь и на картинке одни: это
 * та же развёртка, только словами, и браузер для неё не нужен.
 */
export function objectWalls(project, { schemeId, roomId = null } = {}) {
  const plan = model.elevationPlan(project, schemeId);
  const rooms = plan.rooms.filter((room) => !roomId || room.roomId === roomId);
  const sideRecord = (side) => {
    const elevation = model.wallElevation(project, side.wallId, side.side);
    if (!elevation) return null;
    return {
      wall: elevation.name,
      side: elevation.side,
      room: elevation.roomName,
      lengthMm: elevation.lengthMm,
      thicknessMm: elevation.thicknessMm,
      heightMm: elevation.heightMm,
      heightShownMm: elevation.heightShownMm,
      heightKnown: elevation.heightKnown,
      openings: elevation.openings.map((opening) => ({
        kind: opening.kind,
        fromMm: opening.fromMm,
        toMm: opening.toMm,
        floorMm: opening.floorMm,
        topMm: opening.topMm,
        glazed: opening.glazed,
      })),
      marks: elevation.marks.map((mark) => ({
        label: mark.label,
        fromMm: mark.fromMm,
        toMm: mark.toMm,
        heightMm: mark.heightMm,
        heightKnown: mark.heightFrom !== null,
        sizeMm: mark.sizeMm,
        group: mark.groupLabel || "",
      })),
      objects: (elevation.objects || []).map((object) => ({
        name: object.name,
        fromMm: object.fromMm,
        toMm: object.toMm,
        floorMm: object.floorMm,
        topMm: object.topMm,
      })),
      crossings: (elevation.crossings || []).length,
    };
  };
  return {
    schemeId,
    rooms: rooms.map((room) => ({
      room: room.name,
      sides: room.sides.map(sideRecord).filter(Boolean),
    })),
    // Стороны вне контуров: стена, у которой с этой стороны нет обведённой
    // комнаты, но есть метки, — лист для неё всё равно нужен.
    loose: plan.loose.map(sideRecord).filter(Boolean),
  };
}

// ——— сводки для документации ————————————————————————————————————————————

/**
 * Сводки: сколько чего по помещениям, по типам и по этажам, сколько метров
 * линейных меток и какое оборудование расставлено.
 *
 * Итоги по типам — это `totals` таблицы меток страницы, а не свой пересчёт:
 * число в документации и число в выгруженном CSV обязаны совпадать.
 */
export function objectSummary(project, { filter = null } = {}) {
  const table = marksTable(project, filter, "category");
  const byType = table.totals
    .filter((row) => row.level === 2)
    .map((row) => ({ category: row.category, type: row.title, marks: row.count }));

  const byRoom = objectRooms(project).map((room) => ({
    room: room.name,
    areaM2: room.areaM2,
    perimeterM: room.perimeterM,
    wallHeightMm: room.wallHeightMm,
    marks: room.marks,
  }));

  const byFloor = model.schemesInOrder(project).map((scheme, index) => {
    const record = schemeRecord(project, scheme, index, null);
    return {
      scheme: scheme.name,
      floor: record.floor,
      planM: record.planM,
      rooms: record.counts.rooms,
      marks: record.counts.marks,
      walls: record.counts.walls,
      openings: record.counts.openings,
      objects: record.counts.objects,
    };
  });

  // Длины линейных меток — метры по калибровке плана, свёрнутые по типу: это
  // ответ на «сколько метров ленты заказывать».
  const lengths = new Map();
  for (const mark of model.listedMarks(project.marks)) {
    const meters = model.markLengthMeters(project, mark.id);
    if (meters === null) continue;
    const type = model.findType(project, mark.typeId);
    const key = type ? type.id : "";
    const found = lengths.get(key) || { code: type ? type.code : "", type: type ? type.name : "", marks: 0, totalM: 0 };
    found.marks += 1;
    found.totalM += meters;
    lengths.set(key, found);
  }

  const equipment = equipmentTable(project, filter).totals
    .filter((row) => row.level === 2)
    .map((row) => ({ vendor: row.category, equipment: row.title, count: row.count }));

  return {
    object: project.name,
    marks: table.totalCount,
    byRoom,
    byType,
    byFloor,
    lengths: [...lengths.values()].map((item) => ({ ...item, totalM: round(item.totalM) })),
    equipment,
  };
}

// ——— таблицы ————————————————————————————————————————————————————————————

/**
 * Простая таблица в том виде, который понимают `toCsv`, `toMarkdown` и
 * `toTsv` страницы. Свой CSV здесь не пишется: кавычки, BOM, точка с запятой
 * и переводы строк — забота `tables.js`, и второго их написания в сборке быть
 * не должно.
 */
function plainTable(title, columns, rows, note = "") {
  return {
    kind: "tool",
    title,
    room: "",
    note,
    columns,
    groups: [{ id: "all", title: "", color: null, level: 1, rows: rows.map((cells) => ({ cells })) }],
    totals: [],
    totalLabel: "",
    totalCount: 0,
    groupColumn: "",
  };
}

const EMPTY = (value) => (value === null || value === undefined ? "" : value);

// Метры в таблице пишутся **запятой** — тем же `formatMeters`, которым их
// пишет страница: в чертеже десятичный разделитель запятая, и две записи
// одного числа в документации читались бы как два числа.
const METERS = (value) => (value === null || value === undefined ? "" : model.formatMeters(value));

/**
 * Таблицы команды. Четыре — **собственные таблицы страницы** (метки, типы,
 * связи, оборудование): их состав, порядок и итоги уже решены, и трогать их
 * здесь нельзя. Остальные склеиваются из записей и печатаются тем же
 * `toCsv`/`toMarkdown`.
 */
export function commandTables(command, data, project, options = {}) {
  switch (command) {
    case "marks":
      return [marksTable(project, options.filter || null, options.groupBy || "category", { byRoom: options.byRoom === true })];
    case "types":
      return [typesTable(project)];
    case "links":
      return [linksTable(project, options.filter || null)];
    case "equipment":
      return [equipmentTable(project, options.filter || null)];
    case "info":
      return [
        plainTable(
          data.object.name,
          ["Поле", "Значение"],
          [
            ["Объект", data.object.name],
            ["Версия формата", data.object.formatVersion],
            ["Адрес", data.object.address],
            ["Координаты", data.object.coords ? data.object.coords.lat + ", " + data.object.coords.lon : ""],
            ["Верх чертежа, ° от севера", data.object.topAzimuthDeg],
            ["Схем", data.counts.schemes],
            ["Меток", data.counts.marks],
            ["Типов", data.counts.types],
            ["Помещений", data.counts.rooms],
            ["Стен", data.counts.walls],
            ["Проёмов", data.counts.openings],
            ["Вещей чертежа", data.counts.objects],
            ["Оборудования", data.counts.equipment],
          ],
        ),
        plainTable(
          "Схемы",
          ["№", "Схема", "Этаж", "План, px", "План, м", "px/м", "Высота стен, мм", "Меток", "Стен", "Проёмов", "Вещей"],
          data.schemes.map((scheme) => [
            scheme.index,
            scheme.name,
            EMPTY(scheme.floor),
            scheme.planPx.width + " × " + scheme.planPx.height,
            scheme.planM ? METERS(scheme.planM.width) + " × " + METERS(scheme.planM.height) : "",
            EMPTY(scheme.pixelsPerMeter),
            scheme.wallHeightMm + (scheme.wallHeightKnown ? "" : " (умолчание)"),
            scheme.counts.marks,
            scheme.counts.walls,
            scheme.counts.openings,
            scheme.counts.objects,
          ]),
        ),
      ];
    case "rooms":
      return [
        plainTable(
          "Помещения",
          ["Помещение", "Площадь, м²", "Периметр, м", "Высота стен, мм", "Меток", "По категориям"],
          data.map((room) => [
            room.name,
            METERS(room.areaM2),
            METERS(room.perimeterM),
            room.wallHeightMm + (room.wallHeightKnown ? "" : " (умолчание)"),
            room.marks,
            Object.entries(room.marksByCategory)
              .map(([name, count]) => name + ": " + count)
              .join(", "),
          ]),
        ),
      ];
    case "drawing":
      return [
        plainTable(
          "Стены",
          ["Стена", "Длина, мм", "Толщина, мм", "Высота, мм", "Проёмов"],
          data.walls.map((wall) => [wall.name, wall.lengthMm, wall.thicknessMm, EMPTY(wall.heightMm), wall.openings]),
        ),
        plainTable(
          "Проёмы",
          ["Стена", "Вид", "Отступ, мм", "Ширина, мм", "Высота, мм", "От пола, мм", "Створок", "Остеклён"],
          data.openings.map((opening) => [
            opening.wall,
            opening.title,
            opening.atMm,
            opening.widthMm,
            opening.heightMm,
            opening.heightAboveFloorMm,
            opening.leaves,
            opening.glazed ? "да" : "",
          ]),
        ),
        plainTable(
          "Вещи чертежа",
          ["Вещь", "Установка", "Ширина, мм", "Глубина, мм", "Высота, мм", "От пола, мм", "Поворот, °", "Место, мм"],
          data.objects.map((object) => [
            object.name,
            object.mount,
            EMPTY(object.widthMm),
            EMPTY(object.depthMm),
            EMPTY(object.heightMm),
            EMPTY(object.heightAboveFloorMm),
            object.turnDeg,
            object.atMm ? object.atMm.x + ", " + object.atMm.y : "",
          ]),
        ),
      ];
    case "walls": {
      const rows = [];
      const add = (room, side) =>
        rows.push([
          room,
          side.wall,
          side.side === "left" ? "левая" : "правая",
          side.lengthMm,
          side.heightShownMm + (side.heightKnown ? "" : " (умолчание)"),
          side.openings.length,
          side.marks.length,
          side.marks.map((mark) => mark.label + (mark.heightMm === null ? "" : " на " + mark.heightMm)).join(", "),
        ]);
      for (const room of data.rooms) for (const side of room.sides) add(room.room, side);
      for (const side of data.loose) add("", side);
      return [
        plainTable(
          "Развёртки стен",
          ["Помещение", "Стена", "Сторона", "Длина, мм", "Высота, мм", "Проёмов", "Меток", "Метки"],
          rows,
        ),
      ];
    }
    case "summary":
      return [
        plainTable(
          "По помещениям",
          ["Помещение", "Площадь, м²", "Периметр, м", "Высота стен, мм", "Меток"],
          data.byRoom.map((room) => [room.room, METERS(room.areaM2), METERS(room.perimeterM), room.wallHeightMm, room.marks]),
        ),
        plainTable(
          "По типам",
          ["Категория", "Тип", "Меток"],
          data.byType.map((row) => [row.category, row.type, row.marks]),
        ),
        plainTable(
          "По этажам",
          ["Схема", "Этаж", "Помещений", "Меток", "Стен", "Проёмов", "Вещей"],
          data.byFloor.map((row) => [
            row.scheme,
            EMPTY(row.floor),
            row.rooms,
            row.marks,
            row.walls,
            row.openings,
            row.objects,
          ]),
        ),
        plainTable(
          "Линейные метки",
          ["Код", "Тип", "Меток", "Всего, м"],
          data.lengths.map((row) => [row.code, row.type, row.marks, METERS(row.totalM)]),
        ),
        plainTable(
          "Оборудование",
          ["Производитель", "Оборудование", "Штук"],
          data.equipment.map((row) => [row.vendor, row.equipment, row.count]),
        ),
      ];
    default:
      throw new Error("у команды нет таблицы: " + command);
  }
}

/**
 * Записи из таблицы страницы: колонка становится ключом.
 *
 * Так JSON связей и оборудования выходит **из самой таблицы**, а не из второго
 * списка тех же полей: поправили колонки на странице — поправился и этот вывод.
 */
export function tableRecords(table) {
  const out = [];
  for (const group of tableSections(table)) {
    for (const row of group.rows) {
      const record = {};
      table.columns.forEach((column, index) => {
        record[column] = row.cells[index] === undefined ? "" : row.cells[index];
      });
      if (group.title) record["Разбивка"] = group.title;
      out.push(record);
    }
  }
  return out;
}

/** Печать таблиц в выбранный вид. Писать форматы здесь нечем — зовётся `tables.js`. */
export function printTables(tables, format) {
  if (format === "csv") return tables.map(toCsv).join("\r\n");
  if (format === "md") return tables.map(toMarkdown).join("\n");
  if (format === "tsv") return tables.map(toTsv).join("\n\n");
  throw new Error("неизвестный вид: " + format);
}
