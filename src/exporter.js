// Выгрузка на бумагу и в файлы: PNG схемы, PNG таблицы, zip всех схем, печать.
//
// Схема рисуется тем же `render.drawScheme`, что и холст: во `view` уходит
// `zoom = scale`, поэтому метки и подписи на выгруженной картинке выглядят
// ровно так, как их видел инженер на экране, только в большем разрешении.
// Своего рисования меток здесь нет и быть не должно.
//
// Zip берётся из `projectFile.writeZip` — второй реализации zip в сборке нет.
import { findGroup, findRoom, outlinesInOrder, planPixelsPerMeter, projectStamp, roomsInOrder, schemesInOrder } from "./model.js";
import {
  drawFont,
  drawFontReady,
  drawScheme,
  labelBox,
  labelFontSize,
  markRadius,
  outlineLabelBox,
  visibleMarks,
  visibleOutlines,
} from "./render.js";
import { monoContext } from "./mono.js";
import { pdfDocument, pdfImage } from "./pdf.js";
import { projectFileName, writeZip } from "./projectFile.js";
import { pngWithDpi } from "./pngDpi.js";
import { tableSections, tableRowCount } from "./tables.js";
import {
  GOST_TABLE_ROW_MM,
  drawGostFrame,
  drawGostStamp,
  gostDpi,
  gostField,
  gostPaginate,
  gostPixelsPerMm,
  gostScaleDenominator,
  gostScaleText,
  gostSheetLayout,
  gostSheetSize,
  gostStampValues,
} from "./gostSheet.js";
import { strings, text } from "./strings.js";

export const EXPORT_SCALES = [1, 2, 4];
// Разрешение печати, по которому пиксели пересчитываются в миллиметры.
export const EXPORT_DPI = 300;
// Предел стороны холста в браузерах: за ним toBlob молча отдаёт пустое.
const EXPORT_MAX_SIDE = 16384;
const EXPORT_MM_PER_INCH = 25.4;

// ——— размеры ——————————————————————————————————————————————————————————

export function exportSize(width, height, scale) {
  const factor = scale > 0 ? scale : 1;
  const pixelWidth = Math.round(Math.max(1, width) * factor);
  const pixelHeight = Math.round(Math.max(1, height) * factor);
  return {
    width: pixelWidth,
    height: pixelHeight,
    mmWidth: Math.round((pixelWidth / EXPORT_DPI) * EXPORT_MM_PER_INCH),
    mmHeight: Math.round((pixelHeight / EXPORT_DPI) * EXPORT_MM_PER_INCH),
  };
}

// «2560 × 3956 px · 217 × 335 мм при 300 dpi» — чтобы было видно, что
// получится при печати, до того как файл выгружен.
export function exportSizeText(width, height, scale) {
  return text("exportPanel.size", exportSize(width, height, scale));
}

// ——— холст ————————————————————————————————————————————————————————————

function exportCanvas(width, height) {
  const side = Math.max(width, height);
  if (side > EXPORT_MAX_SIDE) throw new Error(strings.exportPanel.tooBig);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  return canvas;
}

// Холст листа: настоящий или чёрно-белая подставка. Признак приходит из
// диалога выгрузки и дальше листа не живёт — в объект он не попадает.
function monoOf(ctx, mono) {
  return mono === true ? monoContext(ctx) : ctx;
}

/**
 * PNG из холста — **с записанным разрешением**.
 *
 * `canvas.toBlob` пишет только `IHDR`, `IDAT` и `IEND`: физического размера в
 * файле нет. Программа печати тогда предполагает своё разрешение, получает
 * лист вчетверо больше страницы и ужимает его «по размеру листа» — линейка на
 * отпечатке показывает что угодно, кроме выверенных миллиметров. Поэтому в
 * файл дописывается `pHYs` (`pngDpi.js`), и делается это **здесь**: через эту
 * воронку проходят все PNG сборки, и второго места, где картинка становится
 * файлом, нет.
 *
 * `dpi` по умолчанию — тот же `EXPORT_DPI`, по которому прежние выгрузки
 * считают подпись в миллиметрах: обещание физического размера они давали и
 * раньше, теперь его несёт и файл.
 */
async function exportBlob(canvas, dpi) {
  const blob = await new Promise((resolve, reject) => {
    if (typeof canvas.toBlob !== "function") {
      reject(new Error(strings.exportPanel.failed));
      return;
    }
    canvas.toBlob((data) => {
      if (data) resolve(data);
      else reject(new Error(strings.exportPanel.failed));
    }, "image/png");
  });
  const bytes = pngWithDpi(new Uint8Array(await blob.arrayBuffer()), dpi > 0 ? dpi : EXPORT_DPI);
  return new Blob([bytes], { type: "image/png" });
}

/**
 * Готовый холст — **в файл или в страницу документа**, и это единственная
 * развилка между PNG и PDF во всей выгрузке.
 *
 * Рисование одно на оба вида: лист считается и рисуется тем же кодом, тем же
 * шрифтом и с той же чёрно-белой подставкой, а здесь только решается, чем он
 * станет. Второго пути отрисовки бумаги в сборке нет и быть не должно — он
 * разошёлся бы с первым (G169), и разошёлся бы на распечатке.
 *
 * `mm` — настоящий размер бумаги. Лист по ГОСТ передаёт размер своего формата;
 * прежние выгрузки размера бумаги не имеют вовсе, и для них он выводится из
 * пикселей по тому же `EXPORT_DPI`, по которому окно обещает миллиметры в
 * подписи «217 × 335 мм при 300 dpi». Обратно считать миллиметры у листа по
 * ГОСТ нельзя: холст округляется до целой точки (A4 при 300 dpi — 2480 px
 * вместо 2480,31), и страница вышла бы 209,97 мм вместо 210.
 */
async function exportOut(canvas, dpi, options, mm) {
  if (!options || options.pdf !== true) return exportBlob(canvas, dpi);
  return exportPage(canvas, mm || exportPaperMm(canvas, dpi));
}

// Размер бумаги, выведенный из пикселей и разрешения: тот же расчёт, что в
// подписи диалога, только без округления до целых миллиметров — страницу
// документа округлять незачем.
function exportPaperMm(canvas, dpi) {
  const perInch = dpi > 0 ? dpi : EXPORT_DPI;
  return {
    width: (canvas.width / perInch) * EXPORT_MM_PER_INCH,
    height: (canvas.height / perInch) * EXPORT_MM_PER_INCH,
  };
}

// Страница документа из холста: пиксели берутся у настоящего холста, а не у
// чёрно-белой подставки (`monoOf` оборачивает только кисть, а рисунок к этому
// моменту уже лежит в холсте).
async function exportPage(canvas, mm) {
  const pixels = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height);
  return {
    widthMm: mm.width,
    heightMm: mm.height,
    image: await pdfImage(pixels.data, canvas.width, canvas.height),
  };
}

/**
 * Страницы — в один файл PDF. Это главное, чего нет у PNG: таблица на три
 * листа и объект на двадцать схем уезжают заказчику одним документом, а не
 * архивом, который надо распаковывать и открывать по одной картинке.
 */
export function exportPdf(pages, meta = {}) {
  const bytes = pdfDocument(pages, { ...meta, producer: strings.app.title });
  return new Blob([bytes], { type: "application/pdf" });
}

// Область выгрузки в пикселях плана: вся схема или прямоугольник, который
// панель сняла с экрана («как вижу»). Прямоугольник обрезается планом —
// белые поля вокруг схемы на бумаге не нужны.
function exportArea(scheme, area) {
  const width = scheme && scheme.width > 0 ? scheme.width : 1000;
  const height = scheme && scheme.height > 0 ? scheme.height : 1000;
  if (!area || area === "all") return { x: 0, y: 0, width, height };
  const x = Math.max(0, Math.min(width, area.x || 0));
  const y = Math.max(0, Math.min(height, area.y || 0));
  return {
    x,
    y,
    width: Math.max(1, Math.min(width - x, area.width || width)),
    height: Math.max(1, Math.min(height - y, area.height || height)),
  };
}

// Поле вокруг контура — «чуть вокруг»: видно стену и кусок за ней, а не
// половина квартиры (слова заказчика: «не такой большой запас, а то видно
// слишком много»).
//
// Мера берётся от **меньшей** стороны комнаты, а не от большей: у коридора
// 223 × 1509 процент от длины давал поле шире самого коридора, и лист выходил
// втрое шире нужного. Снизу и сверху поле подпирают доли плана, а не комнаты:
// толщина стены — свойство плана, и на чулане поле не должно схлопнуться в
// пару точек, а на зале — разрастись.
const EXPORT_ROOM_PAD = 0.03;
const EXPORT_ROOM_PAD_MIN = 0.008;
const EXPORT_ROOM_PAD_MAX = 0.04;

/**
 * Габариты помещения на схеме в пикселях плана — рамка по контурам комнаты
 * плюс поля. `null`, когда контура этой комнаты на схеме нет.
 *
 * Здесь только кадр. Что на нём видно — решает фильтр листа
 * (`exportRoomFilter`): метки, контур и название — этой комнаты, остальное
 * остаётся общему листу.
 */
export function exportRoomArea(project, scheme, roomId) {
  if (!project || !scheme || !roomId) return null;
  const outlines = outlinesInOrder(project, scheme.id).filter((outline) => outline.roomId === roomId);
  if (outlines.length === 0) return null;
  const width = scheme.width > 0 ? scheme.width : 1000;
  const height = scheme.height > 0 ? scheme.height : 1000;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const outline of outlines) {
    for (const point of outline.points || []) {
      minX = Math.min(minX, point.x);
      minY = Math.min(minY, point.y);
      maxX = Math.max(maxX, point.x);
      maxY = Math.max(maxY, point.y);
    }
  }
  if (!Number.isFinite(minX) || !Number.isFinite(maxX)) return null;
  const box = { x: minX * width, y: minY * height, width: (maxX - minX) * width, height: (maxY - minY) * height };
  const side = Math.max(width, height);
  const pad = Math.min(
    side * EXPORT_ROOM_PAD_MAX,
    Math.max(side * EXPORT_ROOM_PAD_MIN, Math.min(box.width, box.height) * EXPORT_ROOM_PAD),
  );
  return { x: box.x - pad, y: box.y - pad, width: box.width + pad * 2, height: box.height + pad * 2 };
}

/**
 * Фильтр листа комнаты: к тому, что выбрано на экране, добавляется помещение.
 *
 * Лист про эту комнату — значит, на нём её метки, её контур и её название.
 * Слова заказчика: «оставляй только её метки и обозначения комнаты только
 * текущей». Раньше в кадре оставались и соседи: довод был, что розетка у общей
 * стены помогает, — но лист печатают ради одной комнаты, и чужое на нём шум.
 *
 * Контуры соседей уходят вместе с их метками, а не только их названия: стены
 * нарисованы на самом плане, а контур — наша разметка поверх него, с заливкой
 * цветом комнаты. Полоса чужого цвета у обреза — это и есть «видно слишком
 * много»; кому нужна вся картина, у того в том же архиве лежит общий лист.
 *
 * Тем же фильтром отсекается легенда: на листе комнаты она перечисляет типы,
 * которые на нём есть, а не весь справочник схемы.
 */
export function exportRoomFilter(filter, roomId) {
  if (!roomId) return filter || null;
  return { ...(filter || {}), roomId };
}

// Имя помещения для заголовка листа схемы: комната названа там же, где и на
// таблице, иначе лист по комнате не отличить от листа по всей схеме.
export function exportRoomName(project, roomId) {
  const room = roomId ? findRoom(project, roomId) : null;
  return room ? room.name : "";
}

/**
 * Листы помещений одной схемы: по листу на каждую комнату, у которой на этой
 * схеме нарисован контур. Возвращает `{sheets, missing}`.
 *
 * `sheets` — `{roomId, name, area}` в порядке справочника помещений: так листы
 * в архиве идут тем же порядком, что комнаты в таблице.
 *
 * `missing` — имена комнат, у которых **на этой схеме есть метки, а контура
 * нет**: листа для них не будет, и человеку об этом говорят. Комната, которой
 * на схеме нет вовсе (спальня на втором этаже, когда выгружается первый), в
 * `missing` не идёт — иначе список превратился бы в перечень всех комнат
 * объекта на каждом этаже.
 */
export function exportRoomSheets(project, scheme, filter) {
  const sheets = [];
  const missing = [];
  if (!project || !scheme) return { sheets, missing };
  const marked = new Set(visibleMarks(project, scheme, filter || null).map((mark) => mark.roomId).filter(Boolean));
  for (const room of roomsInOrder(project)) {
    const area = exportRoomArea(project, scheme, room.id);
    if (area) sheets.push({ roomId: room.id, name: room.name, area });
    else if (marked.has(room.id)) missing.push(room.name);
  }
  return { sheets, missing };
}

// ——— поля под подписи ——————————————————————————————————————————————————

// Запас вокруг рамки, чтобы подпись не липла к обрезу (в пикселях плана).
const EXPORT_FIT_PAD = 6;
// Насколько лист может вырасти на сторону — доля стороны кадра. Подпись,
// оттащенную мышью на полплана, догонять белым полем незачем: о ней лучше
// предупредить.
const EXPORT_FIT_MAX = 0.25;
// ...но не меньше доли плана: у листа комнаты четверть его стороны мала, а
// подпись метки — величина плана, а не кадра.
const EXPORT_FIT_PLAN = 0.05;

function exportPlanSize(scheme) {
  return {
    width: scheme && scheme.width > 0 ? scheme.width : 1000,
    height: scheme && scheme.height > 0 ? scheme.height : 1000,
  };
}

// Цели подписей: метка без группы — своя подпись, блок — одна на всех.
// Правило то же, что у холста; для блока берётся сама группа, поэтому подпись
// считается по всем её меткам — рамка выходит не уже настоящей.
function exportLabelTargets(project, scheme, filter) {
  const targets = [];
  const seen = new Set();
  for (const mark of visibleMarks(project, scheme, filter)) {
    if (!mark.groupId) {
      targets.push(mark);
      continue;
    }
    if (seen.has(mark.groupId)) continue;
    seen.add(mark.groupId);
    targets.push(findGroup(project, mark.groupId) || mark);
  }
  return targets;
}

function exportUnion(box, rect) {
  const right = Math.max(box.x + box.width, rect.x + rect.width);
  const bottom = Math.max(box.y + box.height, rect.y + rect.height);
  box.x = Math.min(box.x, rect.x);
  box.y = Math.min(box.y, rect.y);
  box.width = right - box.x;
  box.height = bottom - box.y;
}

/**
 * Кадр листа с полями под подписи.
 *
 * Холст, равный площади плана, срезал подписи меток у стен — а у стен их
 * больше всего: розетки и выключатели стоят по периметру. Поэтому кадр растёт
 * ровно настолько, чтобы поместились метки и подписи, попавшие в него: у края
 * плана появляется белое поле, в середине не меняется ничего.
 *
 * Рамка подписи считается симметрично вокруг её точки: подпись бывает повёрнута
 * на 90°, и «шире, чем выше» — не то, на что можно опираться.
 *
 * Возвращает `{area, missed}`; `missed` — подписи, которые не влезли и в
 * выросший кадр (оттащены далеко): о них панель предупреждает до выгрузки,
 * потому что молча потерянное обозначение хуже белого поля.
 */
export function exportFitArea(project, scheme, options = {}) {
  const base = exportArea(scheme, options.area);
  if (!project || !scheme || options.fit === false) return { area: base, missed: [] };

  const plan = exportPlanSize(scheme);
  const sizes = project.view || {};
  const view = { zoom: 1, offsetX: 0, offsetY: 0, markSize: sizes.markSize, labelSize: sizes.labelSize };
  const filter = options.filter || null;
  const radius = markRadius(view);
  const inBase = (point) =>
    point.x >= base.x - 1 &&
    point.x <= base.x + base.width + 1 &&
    point.y >= base.y - 1 &&
    point.y <= base.y + base.height + 1;
  const planPoints = (target) => {
    const marks = target.markIds
      ? target.markIds.map((id) => (project.marks || []).find((mark) => mark.id === id)).filter(Boolean)
      : [target];
    const points = [];
    for (const mark of marks) {
      for (const point of mark.points || []) points.push({ x: point.x * plan.width, y: point.y * plan.height });
    }
    return points;
  };

  const rects = [];
  for (const mark of visibleMarks(project, scheme, filter)) {
    for (const point of planPoints(mark)) {
      if (!inBase(point)) continue;
      rects.push({ text: "", x: point.x - radius, y: point.y - radius, width: radius * 2, height: radius * 2 });
    }
  }
  for (const target of exportLabelTargets(project, scheme, filter)) {
    if (!planPoints(target).some(inBase)) continue;
    const box = labelBox(project, scheme, target, view, filter);
    if (!box.text) continue;
    // Подложка-обводка подписи шире самих букв — её тоже нельзя срезать.
    const halo = Math.max(2, box.font * 0.3);
    const reach = box.width + box.height / 2 + halo + EXPORT_FIT_PAD;
    rects.push({ text: box.text, x: box.x - reach, y: box.y - reach, width: reach * 2, height: reach * 2 });
  }

  // Подпись комнаты считается так же: её тоже таскают руками, и срезать её
  // обрезом листа нельзя. Контур, целиком лежащий вне кадра, в счёт не идёт.
  for (const outline of visibleOutlines(project, scheme, filter)) {
    const points = (outline.points || []).map((point) => ({ x: point.x * plan.width, y: point.y * plan.height }));
    if (!points.some(inBase)) continue;
    const box = outlineLabelBox(project, scheme, outline, view);
    if (!box || !box.text) continue;
    const halo = Math.max(2, box.font * 0.3);
    const reach = box.width + box.height / 2 + halo + EXPORT_FIT_PAD;
    rects.push({ text: box.text, x: box.x - reach, y: box.y - reach, width: reach * 2, height: reach * 2 });
  }

  const area = { ...base };
  for (const rect of rects) exportUnion(area, rect);

  // Потолок роста: иначе одна оттащенная подпись раздувает лист вдвое. У
  // маленького кадра (лист комнаты) доля от его же стороны — это несколько
  // точек, и подпись у стены срезалась бы ровно там, ради чего лист и печатают.
  // Поэтому потолок подпирает доля плана: на общем листе она меньше четверти
  // кадра и ничего не меняет, на листе чулана — спасает подпись.
  const limitX = Math.max(base.width * EXPORT_FIT_MAX, plan.width * EXPORT_FIT_PLAN);
  const limitY = Math.max(base.height * EXPORT_FIT_MAX, plan.height * EXPORT_FIT_PLAN);
  const left = Math.min(base.x - area.x, limitX);
  const top = Math.min(base.y - area.y, limitY);
  const right = Math.min(area.x + area.width - (base.x + base.width), limitX);
  const bottom = Math.min(area.y + area.height - (base.y + base.height), limitY);
  const capped = {
    x: base.x - left,
    y: base.y - top,
    width: base.width + left + right,
    height: base.height + top + bottom,
  };

  const missed = [];
  for (const rect of rects) {
    if (!rect.text) continue;
    const fits =
      rect.x >= capped.x &&
      rect.y >= capped.y &&
      rect.x + rect.width <= capped.x + capped.width &&
      rect.y + rect.height <= capped.y + capped.height;
    if (!fits && !missed.includes(rect.text)) missed.push(rect.text);
  }
  return { area: capped, missed };
}

/**
 * PNG схемы с метками. `area` — «all» или прямоугольник в пикселях плана,
 * `scale` — множитель, `legend` — рисовать ли легенду в углу, `outlines` —
 * печатать ли контуры помещений (по умолчанию да, бледной линией), `links` —
 * рисовать ли связи меток (по умолчанию нет: это разбор, а не чертёж),
 * `mono` — чёрно-белый лист (G170), `filter` — тот же фильтр, что на экране:
 * скрытое им не попадает ни в картинку, ни в легенду.
 */
export async function schemePng(project, scheme, image, options = {}) {
  // Файл чертёжного шрифта мог ещё не дойти: холст в этом случае молча рисует
  // запасным, и в PNG уехал бы не тот шрифт. На бумаге это не поправить.
  await drawFontReady();
  const scale = options.scale > 0 ? options.scale : 1;
  // Кадр берётся с полями под подписи — тем же расчётом, что показал размер
  // в диалоге, иначе на бумаге окажется не то, что обещали миллиметры.
  const { area } = exportFitArea(project, scheme, {
    area: options.area,
    filter: options.filter,
    fit: options.fit,
  });
  const canvas = exportCanvas(area.width * scale, area.height * scale);
  // Чёрно-белый лист — подставка под холст, а не второй путь рисования
  // (`mono.js`): рисует всё тот же `drawScheme`, а краска перекрашивается на
  // входе в холст. Без отметки холст остаётся настоящим, и обычная выгрузка не
  // меняется ни на пиксель.
  const ctx = monoOf(canvas.getContext("2d"), options.mono);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const sizes = project && project.view ? project.view : {};
  const view = {
    zoom: scale,
    offsetX: -area.x * scale,
    offsetY: -area.y * scale,
    markSize: sizes.markSize,
    labelSize: sizes.labelSize,
  };
  drawScheme(ctx, {
    project,
    scheme,
    image,
    filter: options.filter || null,
    view,
    legend: options.legend ? { x: 16 * scale, y: 16 * scale } : null,
    // Контуры помещений на бумаге — бледной линией: на листе главное метки,
    // а обводка комнаты подсказывает, где они стоят. Галочка в диалоге её снимает.
    outlines: options.outlines === false ? false : "pale",
    // Связи — наоборот, по отметке и только по ней: умолчание «нет», лист
    // остаётся чертежом. `true` значит «посчитай сам»: холста здесь нет, и
    // передавать готовый кадр неоткуда.
    links: options.links === true,
    // Чертёж уходит на бумагу вместе с метками и гаснет тем же выключателем,
    // что на экране (таск 127): лист обязан показывать то, что человек на
    // экране проверил.
    drawing: options.drawing !== false,
  });
  return exportOut(canvas, EXPORT_DPI, options);
}

// ——— таблица картинкой ————————————————————————————————————————————————

const EXPORT_TABLE = {
  font: 14,
  titleFont: 22,
  roomFont: 17,
  groupFont: 16,
  rowHeight: 26,
  padding: 24,
  gap: 12,
  stripe: 4,
  cellGap: 18,
  maxColumn: 420,
  ink: "#1f2328",
  muted: "#57606a",
  line: "#d0d7de",
};

// Проба для measureText — одна на модуль: при выгрузке 4× замеров десятки,
// и каждый свой <canvas> ничем не лучше одного общего.
let exportProbeCtx = null;

function exportProbe() {
  if (!exportProbeCtx) exportProbeCtx = document.createElement("canvas").getContext("2d");
  return exportProbeCtx;
}

function exportMeasure(ctx, table) {
  const widths = table.columns.map((column) => {
    ctx.font = drawFont(EXPORT_TABLE.font, 600);
    return ctx.measureText(String(column)).width;
  });
  ctx.font = drawFont(EXPORT_TABLE.font);
  for (const section of tableSections(table)) {
    for (const row of section.rows) {
      row.cells.forEach((cell, index) => {
        const value = String(cell == null ? "" : cell);
        const width = ctx.measureText(value).width;
        if (width > widths[index]) widths[index] = width;
      });
    }
  }
  return widths.map((width) => Math.min(EXPORT_TABLE.maxColumn, Math.ceil(width) + EXPORT_TABLE.cellGap));
}

function exportClip(ctx, value, limit) {
  const cell = value == null ? "" : String(value);
  if (ctx.measureText(cell).width <= limit) return cell;
  let cut = cell;
  while (cut.length > 1 && ctx.measureText(cut + "…").width > limit) cut = cut.slice(0, -1);
  return cut + "…";
}

// Раскладка таблицы в единицах вёрстки: ширины колонок по самому длинному
// значению, высота — по числу строк и заголовков групп.
function exportTableLayout(table, options = {}) {
  const widths = exportMeasure(exportProbe(), table);
  const sections = tableSections(table);
  const title = options.title || table.title || "";
  const room = options.room != null ? options.room : table.room || "";
  const note = options.note != null ? options.note : table.note || "";
  const subtitle = options.subtitle || "";

  const bodyWidth = widths.reduce((sum, width) => sum + width, 0) + EXPORT_TABLE.stripe + EXPORT_TABLE.gap;
  const width = bodyWidth + EXPORT_TABLE.padding * 2;
  let height = EXPORT_TABLE.padding;
  if (title) height += EXPORT_TABLE.titleFont * 1.6;
  if (room) height += EXPORT_TABLE.roomFont * 1.6;
  if (note) height += EXPORT_TABLE.font * 1.6;
  if (subtitle) height += EXPORT_TABLE.font * 1.6;
  height += EXPORT_TABLE.rowHeight; // строка названий колонок
  for (const section of sections) {
    if (section.title) height += EXPORT_TABLE.rowHeight + EXPORT_TABLE.gap;
    height += section.rows.length * EXPORT_TABLE.rowHeight + EXPORT_TABLE.gap;
  }
  const totals = table && Array.isArray(table.totals) ? table.totals : [];
  if (totals.length > 0) height += EXPORT_TABLE.rowHeight * (totals.length + 2) + EXPORT_TABLE.gap * 2;
  height += EXPORT_TABLE.padding;
  return { width, height, bodyWidth, widths, sections, title, room, note, subtitle, totals };
}

// Размер будущей картинки таблицы — чтобы множитель рядом с кнопкой показывал
// пиксели и миллиметры до того, как файл собран.
export function exportTableSizeText(table, scale) {
  const layout = exportTableLayout(table, {});
  return exportSizeText(layout.width, layout.height, scale);
}

/**
 * Таблица картинкой в большом разрешении: заголовок объекта, заголовки групп
 * цветом категории, цветная полоса слева у строк — как на рукописном листе.
 *
 * `options.mono` — тот же чёрно-белый лист, что у схемы (G171): заказчик
 * ответил «да, и таблицы тоже». Цвета на листе два — заголовок разбивки и
 * полоска категории у строки.
 */
export async function tablePng(table, options = {}) {
  // Ждать обязательно до раскладки: ширины колонок меряются `measureText`, и
  // посчитанные запасным шрифтом они не сойдутся с тем, чем лист нарисуется.
  await drawFontReady();
  const scale = options.scale > 0 ? options.scale : 1;
  const layout = exportTableLayout(table, options);
  const { widths, sections, title, room, note, subtitle, bodyWidth, totals } = layout;
  const layoutWidth = layout.width;
  const layoutHeight = layout.height;

  const canvas = exportCanvas(layoutWidth * scale, layoutHeight * scale);
  const ctx = monoOf(canvas.getContext("2d"), options.mono);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.scale(scale, scale);
  ctx.textBaseline = "middle";
  ctx.textAlign = "left";

  const left = EXPORT_TABLE.padding;
  let y = EXPORT_TABLE.padding;

  if (title) {
    ctx.fillStyle = EXPORT_TABLE.ink;
    ctx.font = drawFont(EXPORT_TABLE.titleFont, 600);
    ctx.fillText(title, left, y + EXPORT_TABLE.titleFont * 0.8);
    y += EXPORT_TABLE.titleFont * 1.6;
  }
  // Комната — сразу под именем объекта и тем же весом, что заголовок: лист по
  // одной комнате должен и на бумаге читаться как лист по комнате.
  if (room) {
    ctx.fillStyle = EXPORT_TABLE.ink;
    ctx.font = drawFont(EXPORT_TABLE.roomFont, 600);
    ctx.fillText(room, left, y + EXPORT_TABLE.roomFont * 0.8);
    y += EXPORT_TABLE.roomFont * 1.6;
  }
  // Лист, сужённый фильтром, признаётся в этом на бумаге — иначе неполная
  // таблица неотличима от полной.
  if (note) {
    ctx.fillStyle = EXPORT_TABLE.ink;
    ctx.font = drawFont(EXPORT_TABLE.font, 600);
    ctx.fillText(note, left, y + EXPORT_TABLE.font * 0.8);
    y += EXPORT_TABLE.font * 1.6;
  }
  if (subtitle) {
    ctx.fillStyle = EXPORT_TABLE.muted;
    ctx.font = drawFont(EXPORT_TABLE.font);
    ctx.fillText(subtitle, left, y + EXPORT_TABLE.font * 0.8);
    y += EXPORT_TABLE.font * 1.6;
  }

  // Цвет строки на бумаге показывает полоса слева, а не квадратик в ячейке:
  // колонки с кодом краски в листах больше нет, и рисовать его негде.
  const drawCells = (cells, textLeft, bold) => {
    ctx.font = drawFont(EXPORT_TABLE.font, bold ? 600 : 0);
    let x = textLeft;
    cells.forEach((cell, index) => {
      const limit = widths[index] - EXPORT_TABLE.cellGap;
      ctx.fillText(exportClip(ctx, cell, limit), x, y + EXPORT_TABLE.rowHeight / 2);
      x += widths[index];
    });
  };

  ctx.fillStyle = EXPORT_TABLE.muted;
  drawCells(table.columns, left + EXPORT_TABLE.stripe + EXPORT_TABLE.gap, true);
  y += EXPORT_TABLE.rowHeight;
  ctx.strokeStyle = EXPORT_TABLE.line;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(left, y);
  ctx.lineTo(left + bodyWidth, y);
  ctx.stroke();

  for (const section of sections) {
    const color = section.color || EXPORT_TABLE.ink;
    if (section.title) {
      // Уровень заголовка: помещение — крупнее и с жирной чертой, разбивка
      // внутри него — мельче и тоньше. Вложенность на бумаге видна размером,
      // а не отступом: отступ увёл бы строки от колонок.
      const level = section.level || 1;
      y += EXPORT_TABLE.gap;
      ctx.fillStyle = color;
      const groupFont = level === 2 ? EXPORT_TABLE.groupFont - 2 : EXPORT_TABLE.groupFont;
      ctx.font = drawFont(groupFont, 600);
      ctx.fillText(section.title, left, y + EXPORT_TABLE.rowHeight / 2);
      const lineY = y + EXPORT_TABLE.rowHeight - 2;
      ctx.strokeStyle = color;
      ctx.lineWidth = level === 2 ? 1 : 2;
      ctx.beginPath();
      ctx.moveTo(left, lineY);
      ctx.lineTo(left + bodyWidth, lineY);
      ctx.stroke();
      y += EXPORT_TABLE.rowHeight;
    }
    for (const row of section.rows) {
      // Полоска категории рисуется всегда, и на чёрно-белом листе тоже —
      // тушью. Исполнитель G171 сперва убрал её там (тушью все полоски
      // одинаковы и говорят только «тут строка»), но заказчик решил иначе:
      // «полоску если убрал сейчас, то верни». В листе с разбивкой по
      // помещениям под одним заголовком стоят строки разных категорий, и
      // полоска — единственный значок категории у строки; без цвета она
      // перестаёт называть категорию, но продолжает делить лист на строки.
      ctx.fillStyle = row.color || section.color || EXPORT_TABLE.line;
      ctx.fillRect(left, y + 4, EXPORT_TABLE.stripe, EXPORT_TABLE.rowHeight - 8);
      ctx.fillStyle = EXPORT_TABLE.ink;
      drawCells(row.cells, left + EXPORT_TABLE.stripe + EXPORT_TABLE.gap, false);
      y += EXPORT_TABLE.rowHeight;
    }
    y += EXPORT_TABLE.gap;
  }

  // Подвал «сколько чего»: по нему заказывают оборудование, поэтому он стоит
  // под таблицей на том же листе, а не отдельным файлом.
  if (totals.length > 0) {
    y += EXPORT_TABLE.gap;
    ctx.fillStyle = EXPORT_TABLE.ink;
    ctx.font = drawFont(EXPORT_TABLE.groupFont, 600);
    ctx.fillText(strings.tables.totals, left, y + EXPORT_TABLE.rowHeight / 2);
    const lineY = y + EXPORT_TABLE.rowHeight - 2;
    ctx.strokeStyle = EXPORT_TABLE.ink;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(left, lineY);
    ctx.lineTo(left + bodyWidth, lineY);
    ctx.stroke();
    y += EXPORT_TABLE.rowHeight;

    const line = (label, value, bold, color, indent) => {
      ctx.font = drawFont(EXPORT_TABLE.font, bold ? 600 : 0);
      ctx.fillStyle = color || EXPORT_TABLE.ink;
      ctx.textAlign = "left";
      ctx.fillText(label, left + indent, y + EXPORT_TABLE.rowHeight / 2);
      ctx.textAlign = "right";
      ctx.fillText(String(value), left + bodyWidth, y + EXPORT_TABLE.rowHeight / 2);
      ctx.textAlign = "left";
      y += EXPORT_TABLE.rowHeight;
    };
    for (const row of totals) {
      const sub = row.level === 2;
      line(row.title, row.count, !sub, sub ? EXPORT_TABLE.muted : row.color || EXPORT_TABLE.ink, sub ? EXPORT_TABLE.gap : 0);
    }
    line(table.totalLabel || strings.tables.totalAll, table.totalCount, true, EXPORT_TABLE.ink, 0);
  }

  return exportOut(canvas, EXPORT_DPI, options);
}

// ——— все схемы разом ——————————————————————————————————————————————————

// Картинка для рисования: Blob декодируется, готовый ImageBitmap или <img>
// берётся как есть.
async function exportImageOf(source) {
  if (!source) return null;
  if (typeof Blob !== "undefined" && source instanceof Blob) {
    if (typeof createImageBitmap === "function") return createImageBitmap(source);
    return null;
  }
  return source;
}

// Хвост «-ГГГГ-ММ-ДД.zip», который ставит projectFileName.
const EXPORT_DATED_TAIL = /-\d{4}-\d{2}-\d{2}\.zip$/;

/**
 * Имя файла с датой во всей сборке собирает `projectFile.projectFileName`:
 * там же чистятся запрещённые символы и обрезается длина. Здесь у готового
 * имени меняется расширение, а к имени объекта приписывается то, что отличит
 * выгрузку: `part` — схема или слово-пометка («схемы»).
 *
 * Без такой пометки архив схем назывался бы «<Объект>-<дата>.zip» — ровно тем
 * же именем, что и файл проекта, и в папке загрузок один молча затирал бы
 * другой. Файл проекта открывается назад в сервисе, архив схем — картинки
 * монтажнику, и по имени это должно быть видно сразу.
 */
export function exportFileName(project, part, extension) {
  const base = (project && project.name) || "";
  const suffix = typeof part === "string" ? part : part ? part.name : "";
  return projectFileName({ name: suffix ? base + " — " + suffix : base }).replace(/zip$/, extension);
}

// Имя записи внутри архива: та же чистка, но без даты — дата стоит на самом архиве.
function exportEntryName(value) {
  return projectFileName({ name: value }).replace(EXPORT_DATED_TAIL, "");
}

/**
 * Имя листа в архиве: «01-1 этаж.png» у схемы и «01.01-1 этаж — Кухня.png» у
 * её помещения. Номер продолжает прежнюю логику общих листов, а точка делает
 * лист комнаты подлистом своего этажа: в папке загрузок комнаты встают сразу
 * за своим планом («-» раньше «.» в сортировке) и в порядке справочника.
 * Два знака у номера комнаты — чтобы десятая не встала перед второй.
 */
export function exportSheetName(scheme, index, room, at) {
  const number = String(index + 1).padStart(2, "0");
  const name = (scheme && scheme.name) || "";
  if (!room) return number + "-" + exportEntryName(name) + ".png";
  return number + "." + String(at + 1).padStart(2, "0") + "-" + exportEntryName(name + " — " + room) + ".png";
}

/**
 * Сколько листов даст архив и о чём придётся сказать: `{schemes, rooms, total,
 * missing}`. Считается без рисования — панель показывает это до выгрузки, а
 * два десятка листов в высоком разрешении человек должен увидеть числом, а не
 * почувствовать ожиданием.
 */
export function allSchemesPlan(project, options = {}) {
  const schemes = schemesInOrder(project);
  const missing = [];
  let rooms = 0;
  if (options.rooms === true) {
    for (const scheme of schemes) {
      const plan = exportRoomSheets(project, scheme, options.filter);
      rooms += plan.sheets.length;
      for (const name of plan.missing) if (!missing.includes(name)) missing.push(name);
    }
  }
  return { schemes: schemes.length, rooms, total: schemes.length + rooms, missing };
}

/**
 * Zip с картинками всех схем объекта. `images` — Map «imageId → Blob»
 * (или ImageBitmap). Zip пишется общим `writeZip`: PNG уже сжат, поэтому
 * хранится как есть.
 *
 * `options.rooms` — положить рядом с общим листом схемы ещё по листу на
 * помещение: лист режется по контуру комнаты с полями. Монтажник идёт по
 * квартире комнатами, и лист на комнату ему полезнее общего плана, где нужное —
 * четверть листа; связь с квартирой при этом не теряется, потому что общие
 * листы лежат в том же архиве.
 *
 * Множитель у всех листов один — тот, что выбран в диалоге. Подгонять каждую
 * комнату под свой лист нельзя: листы читают рядом, и тогда два одинаковых
 * стола на соседних листах были бы разной ширины. Поэтому у маленькой комнаты
 * не мельче рисунок, а меньше лист.
 *
 * На листе комнаты — только её метки, её контур и её название
 * (`exportRoomFilter`): лист печатают ради одной комнаты, и чужое на нём шум.
 * Вся картина целиком лежит рядом, общим листом.
 *
 * `options.mono` и `options.gost` уходят каждому листу как есть: вид листа
 * один на весь архив — выгружают его целиком, а не лист цветной, лист нет.
 */
export async function allSchemesZip(project, images, options = {}) {
  const sheets = await allSchemesSheets(project, images, options);
  return writeZip(
    sheets.map(({ name, data }) => ({ name, data, compress: false })),
    { compress: false },
  );
}

/**
 * Весь объект **одним документом PDF**: те же листы в том же порядке, что в
 * архиве, но страницами одного файла.
 *
 * Это то, ради чего PDF и понадобился: архив из двадцати картинок получатель
 * распаковывает и открывает по одной, а документ листает. Нумерация «Лист N из
 * M» и состав листов считаются тем же обходом, что у архива, — разойдись они,
 * и номер на бумаге перестал бы отвечать числу страниц.
 */
export async function allSchemesPdf(project, images, options = {}) {
  const sheets = await allSchemesSheets(project, images, { ...options, pdf: true });
  return exportPdf(
    sheets.map((sheet) => sheet.data),
    { title: (project && project.name) || "" },
  );
}

/**
 * Обход листов объекта — один на архив и на документ: `[{name, data}]` в
 * порядке листов. `data` — PNG или страница PDF, смотря по `options.pdf`.
 *
 * Обход общий нарочно. Разведи архив и документ по двум циклам, и они начнут
 * расходиться составом листов и нумерацией — а человек будет считать, что
 * получил то же самое в другом файле.
 */
async function allSchemesSheets(project, images, options = {}) {
  // Форма входа одна — Map «imageId → Blob», как у packProject: разбирать
  // четыре формы одного и того же было бы вторым правилом на тот же вход.
  if (images != null && !(images instanceof Map)) throw new Error(strings.errors.imagesNotMap);
  const map = images || new Map();
  const schemes = schemesInOrder(project);
  const files = [];
  const onProgress = typeof options.onProgress === "function" ? options.onProgress : null;
  const total = allSchemesPlan(project, options).total;
  let done = 0;
  const put = (name, data) => {
    files.push({ name, data });
    done += 1;
    if (onProgress) onProgress({ done, total, name });
  };
  // Лист по ГОСТ или прежняя картинка — выбор один на весь архив. Нумерация
  // «Лист N из M» идёт по всему архиву: листы одного объекта и считаются вместе,
  // иначе каждый этаж объявлял бы себя единственным.
  const draw = (scheme, extra) =>
    options.gost === true
      ? gostSchemePng(project, scheme, extra.image, { ...options, ...extra, sheet: done + 1, sheets: total })
      : schemePng(project, scheme, extra.image, { ...options, ...extra });
  for (let index = 0; index < schemes.length; index += 1) {
    const scheme = schemes[index];
    const image = await exportImageOf(map.get(scheme.imageId));
    const whole = await draw(scheme, { image, area: "all" });
    put(exportSheetName(scheme, index), whole);
    if (options.rooms !== true) continue;
    const { sheets } = exportRoomSheets(project, scheme, options.filter);
    for (let at = 0; at < sheets.length; at += 1) {
      const sheet = sheets[at];
      const page = await draw(scheme, {
        image,
        area: sheet.area,
        filter: exportRoomFilter(options.filter, sheet.roomId),
        building: sheet.name,
      });
      put(exportSheetName(scheme, index, sheet.name, at), page);
    }
  }
  return files;
}

// ——— печать ———————————————————————————————————————————————————————————

function exportNode(tag, className, textValue) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (textValue != null) node.textContent = String(textValue);
  return node;
}

/**
 * Готовая раскладка таблицы: заголовок объекта, заголовки групп цветом
 * категории, колонки шапкой. Один и тот же узел идёт и в предпросмотр
 * диалога, и в печать — печатается ровно то, что видно.
 */
export function exportTableNode(table, options = {}) {
  // Чёрно-белый лист (G171) и здесь: предпросмотр в диалоге и печать браузером
  // — один и тот же узел, и отметка обязана быть видна **до** печати. Цвет
  // категории в чёрно-белом становится тушью, а не пропадает: заказчик просил
  // вернуть полоску («полоску если убрал сейчас, то верни»), и она делит лист
  // на строки даже там, где уже не называет категорию.
  const mono = options.mono === true;
  const doc = exportNode("div", mono ? "print-doc print-doc--mono" : "print-doc");
  const head = exportNode("header", "print-doc__head");
  head.append(exportNode("h1", "print-doc__title", options.title || table.title || ""));
  const room = options.room != null ? options.room : table.room || "";
  if (room) head.append(exportNode("p", "print-doc__room", room));
  const note = options.note != null ? options.note : table.note || "";
  if (note) head.append(exportNode("p", "print-doc__note", note));
  const subtitle = options.subtitle || text("exportPanel.rows", { count: tableRowCount(table) });
  head.append(exportNode("p", "print-doc__sub", subtitle));
  doc.append(head);

  for (const section of tableSections(table)) {
    const level = section.level || 1;
    const block = exportNode("section", level === 2 ? "print-doc__group print-doc__group--sub" : "print-doc__group");
    if (section.color) block.style.setProperty("--print-color", mono ? "#000000" : section.color);
    if (section.title) {
      block.append(exportNode(level === 2 ? "h3" : "h2", "print-doc__group-title", section.title));
    }
    // Заголовок помещения строк не несёт: пустая шапка таблицы под ним
    // читалась бы как потерянные строки.
    if (section.rows.length === 0) {
      doc.append(block);
      continue;
    }
    const tableNode = exportNode("table", "print-doc__table");
    const thead = exportNode("thead");
    const headRow = exportNode("tr");
    for (const column of table.columns) headRow.append(exportNode("th", null, column));
    thead.append(headRow);
    tableNode.append(thead);
    const tbody = exportNode("tbody");
    for (const row of section.rows) {
      // Строка с потерянной ссылкой помечена и на вид: на бумаге она не должна
      // читаться как обычная связь.
      const tr = exportNode("tr", row.problem ? "print-doc__row print-doc__row--problem" : "print-doc__row");
      if (row.color) tr.style.setProperty("--print-row-color", mono ? "#000000" : row.color);
      row.cells.forEach((cell, index) => {
        tr.append(exportNode("td", index === 0 ? "print-doc__label" : null, cell));
      });
      tbody.append(tr);
    }
    tableNode.append(tbody);
    block.append(tableNode);
    doc.append(block);
  }

  const totals = Array.isArray(table.totals) ? table.totals : [];
  if (totals.length > 0) {
    const block = exportNode("section", "print-doc__group print-doc__totals");
    block.append(exportNode("h2", "print-doc__group-title", strings.tables.totals));
    const totalsTable = exportNode("table", "print-doc__table");
    const body = exportNode("tbody");
    const line = (title, count, className, color) => {
      const tr = exportNode("tr", className);
      if (color) tr.style.setProperty("--print-row-color", mono ? "#000000" : color);
      tr.append(exportNode("td", null, title));
      tr.append(exportNode("td", "print-doc__count", count));
      body.append(tr);
    };
    for (const row of totals) {
      line(
        row.title,
        row.count,
        row.level === 2 ? "print-doc__totals-row print-doc__totals-row--sub" : "print-doc__totals-row",
        row.level === 2 ? null : row.color,
      );
    }
    line(
      table.totalLabel || strings.tables.totalAll,
      table.totalCount,
      "print-doc__totals-row print-doc__totals-row--all",
      null,
    );
    totalsTable.append(body);
    block.append(totalsTable);
    doc.append(block);
  }

  if (options.extra) doc.append(options.extra);
  return doc;
}

function exportPrintRoot() {
  let root = document.getElementById("print-root");
  if (!root) {
    root = exportNode("div", null);
    root.id = "print-root";
    document.body.append(root);
  }
  return root;
}

function exportPrintRun(root) {
  document.body.classList.add("printing");
  const restore = () => document.body.classList.remove("printing");
  const cleanup = () => {
    restore();
    root.replaceChildren();
    window.removeEventListener("afterprint", cleanup);
  };
  window.addEventListener("afterprint", cleanup);
  window.print();
  // Раскладку убирает только afterprint: в Safari window.print() не держит
  // поток, и уборка по таймеру вычистила бы лист из-под открытого диалога
  // печати — на бумагу ушла бы пустая страница. Таймер возвращает экран,
  // содержимое #print-root ждёт следующей печати (на экране оно скрыто).
  setTimeout(restore, 2000);
}

/**
 * Печать без второго окна: раскладка кладётся в #print-root, экран прячется
 * правилами print.css. `kind` — «table» (данные: `{table, title, subtitle,
 * extra, mono}`) или «scheme» (данные: `{blob, title}`).
 *
 * У схемы отметка «чёрно-белый» уже в самой картинке — печатается то, что
 * нарисовано. У таблицы раскладка собирается здесь и сейчас, поэтому отметку
 * надо передать: иначе галка в окне молчала бы ровно на той кнопке, которой в
 * этом окне пользуются чаще всего.
 */
export async function printView(kind, data = {}) {
  const root = exportPrintRoot();
  if (kind === "scheme") {
    const url = URL.createObjectURL(data.blob);
    const wrap = exportNode("div", "print-doc print-doc--scheme");
    if (data.title) wrap.append(exportNode("h1", "print-doc__title", data.title));
    const image = document.createElement("img");
    image.className = "print-doc__image";
    image.src = url;
    wrap.append(image);
    root.replaceChildren(wrap);
    await new Promise((resolve) => {
      image.addEventListener("load", resolve, { once: true });
      image.addEventListener("error", resolve, { once: true });
    });
    exportPrintRun(root);
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    return;
  }
  root.replaceChildren(
    exportTableNode(data.table, {
      title: data.title,
      subtitle: data.subtitle,
      extra: data.extra,
      mono: data.mono,
    }),
  );
  exportPrintRun(root);
}

// ——— скачивание ———————————————————————————————————————————————————————

export function exportDownload(blob, name) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export function exportText(value, name, type) {
  exportDownload(new Blob([value], { type: type || "text/plain;charset=utf-8" }), name);
}

// Буфер обмена доступен не везде (file:// без разрешения) — запасной путь
// через скрытое поле, иначе кнопка «Копировать» молча ничего не делает.
export async function exportCopy(value) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    try {
      await navigator.clipboard.writeText(value);
      return true;
    } catch (error) {
      // падаем в запасной путь ниже
    }
  }
  const area = document.createElement("textarea");
  area.value = value;
  area.setAttribute("readonly", "readonly");
  area.style.position = "fixed";
  area.style.opacity = "0";
  document.body.append(area);
  area.select();
  let ok = false;
  try {
    ok = document.execCommand("copy");
  } catch (error) {
    ok = false;
  }
  area.remove();
  return ok;
}

// ——— лист по ГОСТ —————————————————————————————————————————————————————
//
// Новый вид выгрузки рядом с прежними: тот же план и та же таблица, но на
// бумаге с рамкой и основной надписью. Геометрия листа живёт в `gostSheet.js`
// и считается в миллиметрах; здесь — холст, план и строки таблицы.

// Чертёжный шрифт грузится до первой отрисовки: canvas не ждёт `@font-face`
// сам, и первый лист вышел бы системным шрифтом, а второй — чертёжным.
// Ждёт его `render.drawFontReady` — то же обещание, что у холста и у прежних
// выгрузок; второго ожидания со своим именем семейства в сборке нет.

// Дата в штампе — календарный день того, кто выгружает, в чертёжном виде
// «08.10.26». UTC здесь соврал бы на вечерней выгрузке так же, как в имени
// файла проекта.
function gostDate(date) {
  const at = date instanceof Date ? date : new Date();
  const pad = (value) => String(value).padStart(2, "0");
  return pad(at.getDate()) + "." + pad(at.getMonth() + 1) + "." + String(at.getFullYear()).slice(-2);
}

/**
 * Раскладка листа схемы: формат, поле чертежа, вписанный план и **настоящий
 * масштаб**.
 *
 * Кадр берётся тем же `exportFitArea`, что и у прежней выгрузки: на листе по
 * ГОСТ подписи у стен обязаны быть целы ровно так же. Масштаб считается из
 * `fit.scale` — из той самой величины, которой план вписан в поле, а не второй
 * формулой: два расчёта разошлись бы в последнем знаке, и линейка это поймала
 * бы (G169).
 */
export function gostSchemeSheet(project, scheme, options = {}) {
  const { area, missed } = exportFitArea(project, scheme, {
    area: options.area,
    filter: options.filter,
    fit: options.fit,
  });
  const sizes = project && project.view ? project.view : {};
  const view = { zoom: 1, offsetX: 0, offsetY: 0, markSize: sizes.markSize, labelSize: sizes.labelSize };
  const layout = gostSheetLayout(
    { width: area.width, height: area.height },
    {
      form: "form3",
      format: options.format,
      orientation: options.orientation,
      textPx: labelFontSize(view),
    },
  );
  const perMeter = planPixelsPerMeter(project, scheme ? scheme.id : null);
  const denominator = gostScaleDenominator(layout.fit.scale, perMeter);
  return { ...layout, form: "form3", area, missed, denominator, scaleText: gostScaleText(denominator) };
}

// Подпись размера листа для диалога: формат, ориентация, пиксели и честные
// миллиметры бумаги — не пересчитанные из пикселей, а те, что у формата.
export function gostSheetSizeText(sheet, scale) {
  const dpi = gostDpi(scale);
  const mm = gostPixelsPerMm(dpi);
  return text("gost.size", {
    format: sheet.format,
    orientation:
      sheet.orientation === "landscape" ? strings.gost.orientationLandscape : strings.gost.orientationPortrait,
    width: Math.round(sheet.width * mm),
    height: Math.round(sheet.height * mm),
    mmWidth: sheet.width,
    mmHeight: sheet.height,
    dpi,
  });
}

/**
 * Лист схемы по ГОСТ: рамка, план в поле чертежа, основная надпись формы 3.
 *
 * План рисуется тем же `drawScheme`, что и холст, — своего рисования меток
 * здесь нет и быть не должно. Поле чертежа обрезает: подпись, вылезшая за
 * рамку, ушла бы в поле подшивки.
 */
export async function gostSchemePng(project, scheme, image, options = {}) {
  const plan = options.layout || gostSchemeSheet(project, scheme, options);
  const dpi = gostDpi(options.scale);
  const mm = gostPixelsPerMm(dpi);
  await drawFontReady();
  const canvas = exportCanvas(plan.sheet.width * mm, plan.sheet.height * mm);
  // Отметка «чёрно-белый» работает и здесь: рамка со штампом и так чёрные, а
  // план с метками проходит через ту же подставку, что и у прежнего листа.
  const ctx = monoOf(canvas.getContext("2d"), options.mono);
  drawGostFrame(ctx, plan.sheet, mm);

  const sizes = project && project.view ? project.view : {};
  const zoom = plan.fit.scale * mm;
  const view = {
    zoom,
    offsetX: plan.fit.x * mm - plan.area.x * zoom,
    offsetY: plan.fit.y * mm - plan.area.y * zoom,
    markSize: sizes.markSize,
    labelSize: sizes.labelSize,
  };
  const field = gostField(plan.sheet, plan.form);
  ctx.save();
  ctx.beginPath();
  ctx.rect(field.x * mm, field.y * mm, field.width * mm, field.height * mm);
  ctx.clip();
  drawScheme(ctx, {
    project,
    scheme,
    image,
    filter: options.filter || null,
    view,
    legend: options.legend ? { x: (field.x + 4) * mm, y: (field.y + 4) * mm } : null,
    outlines: options.outlines === false ? false : "pale",
    links: options.links === true,
    drawing: options.drawing !== false,
  });
  ctx.restore();

  drawGostStamp(
    ctx,
    plan.sheet,
    plan.form,
    gostStampValues(projectStamp(project), {
      object: (project && project.name) || "",
      building: options.building || "",
      drawing: (scheme && scheme.name) || "",
      scale: plan.scaleText,
      sheet: options.sheet || 1,
      sheets: options.sheets || 1,
      date: gostDate(options.date),
    }),
    mm,
  );
  // Разрешение листа — то самое, которым он нарисован: лист по ГОСТ выверен в
  // миллиметрах, и в файле это должно быть написано, а не подразумеваться.
  // Страница PDF берёт миллиметры у формата листа, а не у пикселей: формат —
  // это то, что написано на коробке бумаги.
  return exportOut(canvas, dpi, options, { width: plan.sheet.width, height: plan.sheet.height });
}

// ——— таблица листами по ГОСТ ———————————————————————————————————————————

// Метрика таблицы на бумаге, в миллиметрах. Шаг строки живёт в `gostSheet.js`
// (там же, где считается, сколько их влезет на лист); шрифт 3,5 мм — размер по
// ГОСТ 2.304, ближайший к этому шагу.
const GOST_TABLE = {
  row: GOST_TABLE_ROW_MM,
  font: 3.5,
  groupFont: 4,
  pad: 2,
};

// Строки будущих листов одним списком: заголовок разбивки, строка таблицы,
// подвал «Итого». Разбивка по листам идёт по этому списку, поэтому «Лист N из
// M» считается до рисования — как и число листов в архиве схем.
function gostTableLines(table) {
  const lines = [];
  for (const section of tableSections(table)) {
    if (section.title) lines.push({ kind: "group", title: section.title, color: section.color, level: section.level || 1 });
    for (const row of section.rows) lines.push({ kind: "row", cells: row.cells, color: row.color });
  }
  const totals = Array.isArray(table.totals) ? table.totals : [];
  if (totals.length > 0) {
    lines.push({ kind: "group", title: strings.tables.totals });
    for (const row of totals) lines.push({ kind: "total", title: row.title, count: row.count, level: row.level });
    lines.push({ kind: "total", title: table.totalLabel || strings.tables.totalAll, count: table.totalCount, bold: true });
  }
  return lines;
}

// Ширины колонок в миллиметрах: по самому длинному значению, а дальше все
// колонки тянутся (или ужимаются) к ширине рамки одной долей. Таблица на
// чертеже идёт во всю рамку: узкая полоска посреди листа читалась бы как
// обрыв, а отданный одной колонке остаток перекосил бы её на треть листа.
function gostTableColumns(table, widthMm) {
  const ctx = exportProbe();
  const probe = 100;
  const measure = (value, bold) => {
    ctx.font = drawFont(probe, bold ? 600 : null);
    return (ctx.measureText(String(value == null ? "" : value)).width / probe) * GOST_TABLE.font;
  };
  const widths = table.columns.map((column) => measure(column, true));
  for (const section of tableSections(table)) {
    for (const row of section.rows) {
      row.cells.forEach((cell, index) => {
        const width = measure(cell, false);
        if (width > widths[index]) widths[index] = width;
      });
    }
  }
  const padded = widths.map((width) => width + GOST_TABLE.pad * 2);
  const sum = padded.reduce((total, width) => total + width, 0);
  if (sum <= 0) return padded;
  return padded.map((width) => (width / sum) * widthMm);
}

/**
 * Разбивка таблицы на листы: первый по форме 5, последующие по форме 6.
 * Считать, сколько строк влезет, умеет `gostSheet.gostPaginate` — здесь только
 * строки таблицы. Формат таблицы руками не подбирается: подбор — про план, а
 * страница текста влезает в A4, который единственный и печатают.
 */
export function gostTablePages(table, options = {}) {
  const sheet = gostSheetSize(options.format === "auto" || !options.format ? "A4" : options.format, options.orientation);
  const lines = gostTableLines(table);
  const pages = gostPaginate(lines.length, sheet, { rowMm: GOST_TABLE.row }).map((page) => ({
    form: page.form,
    lines: lines.slice(page.from, page.to),
  }));
  return { sheet, pages };
}

function gostTableCell(ctx, value, limitPx) {
  const cell = value == null ? "" : String(value);
  if (ctx.measureText(cell).width <= limitPx) return cell;
  let cut = cell;
  while (cut.length > 1 && ctx.measureText(cut + "…").width > limitPx) cut = cut.slice(0, -1);
  return cut + "…";
}

/**
 * Один лист таблицы: рамка, шапка колонок, строки и основная надпись формы 5
 * (первый лист) или 6 (последующие). Шапка повторяется на каждом листе —
 * иначе второй лист таблицы читать нечем.
 */
export async function gostTablePng(table, page, plan, options = {}) {
  const dpi = gostDpi(options.scale);
  const mm = gostPixelsPerMm(dpi);
  await drawFontReady();
  const sheet = plan.sheet;
  const canvas = exportCanvas(sheet.width * mm, sheet.height * mm);
  // Отметка «чёрно-белый» и здесь та же: рамка со штампом и сетка таблицы и
  // так чёрные, перекрашиваются заголовок разбивки и полоска категории.
  const ctx = monoOf(canvas.getContext("2d"), options.mono);
  drawGostFrame(ctx, sheet, mm);

  const field = gostField(sheet, page.form);
  const widths = plan.columns;
  const bodyWidth = widths.reduce((total, width) => total + width, 0);
  ctx.strokeStyle = "#000000";
  ctx.fillStyle = "#1f2328";
  ctx.textBaseline = "middle";
  ctx.textAlign = "left";

  const line = (x1, y1, x2, y2, widthMm) => {
    ctx.lineWidth = Math.max(1, widthMm * mm);
    ctx.beginPath();
    ctx.moveTo(x1 * mm, y1 * mm);
    ctx.lineTo(x2 * mm, y2 * mm);
    ctx.stroke();
  };

  let y = field.y;
  const drawCells = (cells, bold) => {
    ctx.font = drawFont(GOST_TABLE.font * mm, bold ? 600 : null);
    let x = field.x;
    cells.forEach((cell, index) => {
      const limit = (widths[index] - GOST_TABLE.pad * 2) * mm;
      ctx.fillText(gostTableCell(ctx, cell, limit), (x + GOST_TABLE.pad) * mm, (y + GOST_TABLE.row / 2) * mm);
      x += widths[index];
    });
  };

  // Разделители колонок внутри одной строки: таблица на чертеже — сетка, а не
  // колонки текста. Через заголовки разбивки они не идут: там строка одна на
  // всю ширину, и черта поперёк неё читалась бы как пустая ячейка.
  const columnLines = (top) => {
    let x = field.x;
    for (const width of widths.slice(0, -1)) {
      x += width;
      line(x, top, x, top + GOST_TABLE.row, 0.3);
    }
    line(field.x, top, field.x, top + GOST_TABLE.row, 0.3);
    line(field.x + bodyWidth, top, field.x + bodyWidth, top + GOST_TABLE.row, 0.3);
  };

  // Шапка колонок: на каждом листе своя, и под ней основная линия.
  drawCells(table.columns, true);
  columnLines(y);
  line(field.x, y, field.x + bodyWidth, y, 0.3);
  line(field.x, y + GOST_TABLE.row, field.x + bodyWidth, y + GOST_TABLE.row, 0.7);
  y += GOST_TABLE.row;

  for (const item of page.lines) {
    if (item.kind === "group") {
      ctx.fillStyle = item.color || "#1f2328";
      ctx.font = drawFont((item.level === 2 ? GOST_TABLE.font : GOST_TABLE.groupFont) * mm, 600);
      ctx.fillText(item.title, (field.x + GOST_TABLE.pad) * mm, (y + GOST_TABLE.row / 2) * mm);
      ctx.strokeStyle = item.color || "#1f2328";
      line(field.x, y + GOST_TABLE.row, field.x + bodyWidth, y + GOST_TABLE.row, item.level === 2 ? 0.3 : 0.5);
      ctx.strokeStyle = "#000000";
      ctx.fillStyle = "#1f2328";
      y += GOST_TABLE.row;
      continue;
    }
    if (item.kind === "total") {
      ctx.font = drawFont(GOST_TABLE.font * mm, item.bold ? 600 : null);
      ctx.fillText(item.title, (field.x + GOST_TABLE.pad + (item.level === 2 ? GOST_TABLE.pad * 2 : 0)) * mm, (y + GOST_TABLE.row / 2) * mm);
      ctx.textAlign = "right";
      ctx.fillText(String(item.count), (field.x + bodyWidth - GOST_TABLE.pad) * mm, (y + GOST_TABLE.row / 2) * mm);
      ctx.textAlign = "left";
      y += GOST_TABLE.row;
      continue;
    }
    // Цвет категории — полоской слева, как и на прежнем листе: колонки с кодом
    // краски в таблице нет, и рисовать его негде. На чёрно-белом листе полоска
    // остаётся и чернеет — решение заказчика, см. `tablePng`.
    if (item.color) {
      ctx.fillStyle = item.color;
      ctx.fillRect(field.x * mm, (y + 1) * mm, 1.2 * mm, (GOST_TABLE.row - 2) * mm);
      ctx.fillStyle = "#1f2328";
    }
    drawCells(item.cells, false);
    columnLines(y);
    line(field.x, y + GOST_TABLE.row, field.x + bodyWidth, y + GOST_TABLE.row, 0.3);
    y += GOST_TABLE.row;
  }

  drawGostStamp(
    ctx,
    sheet,
    page.form,
    gostStampValues(options.stamp || {}, {
      object: options.object || "",
      drawing: options.title || "",
      sheet: options.sheet || 1,
      sheets: options.sheets || 1,
      date: gostDate(options.date),
    }),
    mm,
  );
  // Разрешение листа — то самое, которым он нарисован: лист по ГОСТ выверен в
  // миллиметрах, и в файле это должно быть написано, а не подразумеваться.
  // Страница PDF берёт миллиметры у формата листа, а не у пикселей: формат —
  // это то, что написано на коробке бумаги.
  return exportOut(canvas, dpi, options, { width: sheet.width, height: sheet.height });
}

/**
 * Архив готовых листов: порядковый номер в имени, чтобы листы в папке шли тем
 * же порядком, что и в документе. Zip один на всю сборку — тот же `writeZip`.
 */
export async function gostSheetsZip(blobs, name) {
  const files = blobs.map((data, index) => ({
    name: String(index + 1).padStart(2, "0") + "-" + name,
    data,
    compress: false,
  }));
  return writeZip(files, { compress: false });
}

/**
 * Печать готовых листов: по картинке на страницу, без заголовка над ней —
 * всё, что нужно, уже написано в основной надписи.
 *
 * **Миллиметры при такой печати не свои.** Браузер печатает со своими полями
 * и ужимает лист под них; линейкой выверяют не это, а скачанный PNG,
 * напечатанный «как есть» (100 %). Диалог говорит об этом вслух — молча
 * отдать на замер ужатый лист было бы хуже, чем не печатать вовсе.
 */
export async function gostPrintSheets(blobs) {
  const root = exportPrintRoot();
  const urls = [];
  const images = [];
  const nodes = [];
  for (const blob of blobs) {
    const url = URL.createObjectURL(blob);
    urls.push(url);
    const wrap = exportNode("div", "print-doc print-doc--scheme print-doc--sheet");
    const image = document.createElement("img");
    image.className = "print-doc__image";
    image.src = url;
    wrap.append(image);
    images.push(image);
    nodes.push(wrap);
  }
  root.replaceChildren(...nodes);
  await Promise.all(
    images.map(
      (image) =>
        new Promise((resolve) => {
          image.addEventListener("load", resolve, { once: true });
          image.addEventListener("error", resolve, { once: true });
        }),
    ),
  );
  exportPrintRun(root);
  setTimeout(() => urls.forEach((url) => URL.revokeObjectURL(url)), 4000);
}

/**
 * Все листы таблицы разом, в порядке листов. «Лист N из M» считает сама
 * разбивка, поэтому номер на бумаге не может разойтись с числом листов.
 *
 * Что в списке — PNG или страницы PDF — решает `options.pdf`: рисуются листы
 * одним и тем же `gostTablePng`, развилка у них одна и живёт в `exportOut`.
 */
export async function gostTableSheets(table, options = {}) {
  const plan = gostTablePages(table, options);
  // Ширины колонок считаются один раз на все листы: разные ширины на соседних
  // листах одной таблицы читались бы как две разные таблицы.
  const columns = gostTableColumns(table, gostField(plan.sheet, "form5").width);
  const blobs = [];
  for (let index = 0; index < plan.pages.length; index += 1) {
    blobs.push(
      await gostTablePng(table, plan.pages[index], { ...plan, columns }, {
        ...options,
        sheet: index + 1,
        sheets: plan.pages.length,
      }),
    );
  }
  return blobs;
}
