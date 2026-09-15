// Выгрузка на бумагу и в файлы: PNG схемы, PNG таблицы, zip всех схем, печать.
//
// Схема рисуется тем же `render.drawScheme`, что и холст: во `view` уходит
// `zoom = scale`, поэтому метки и подписи на выгруженной картинке выглядят
// ровно так, как их видел инженер на экране, только в большем разрешении.
// Своего рисования меток здесь нет и быть не должно.
//
// Zip берётся из `projectFile.writeZip` — второй реализации zip в сборке нет.
import { schemesInOrder } from "./model.js";
import { drawScheme } from "./render.js";
import { projectFileName, writeZip } from "./projectFile.js";
import { tableSections, tableRowCount } from "./tables.js";
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

function exportBlob(canvas) {
  return new Promise((resolve, reject) => {
    if (typeof canvas.toBlob !== "function") {
      reject(new Error(strings.exportPanel.failed));
      return;
    }
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error(strings.exportPanel.failed));
    }, "image/png");
  });
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

/**
 * PNG схемы с метками. `area` — «all» или прямоугольник в пикселях плана,
 * `scale` — множитель, `legend` — рисовать ли легенду в углу, `filter` —
 * тот же фильтр, что на экране: скрытое им не попадает ни в картинку,
 * ни в легенду.
 */
export async function schemePng(project, scheme, image, options = {}) {
  const scale = options.scale > 0 ? options.scale : 1;
  const area = exportArea(scheme, options.area);
  const canvas = exportCanvas(area.width * scale, area.height * scale);
  const ctx = canvas.getContext("2d");
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
  });
  return exportBlob(canvas);
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
  swatch: 11,
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

// Прибавка к ячейке, в которой печатается код краски: квадратик плюс зазор.
// Одна на замер ширины и на рисование — иначе колонка мерится по тексту,
// а текст рисуется со сдвигом, и «#1F6FEB» уезжает в многоточие.
function exportSwatchShift(rowColor, cell) {
  return rowColor && String(cell) === rowColor ? EXPORT_TABLE.swatch + 6 : 0;
}

function exportMeasure(ctx, table) {
  const widths = table.columns.map((column) => {
    ctx.font = `600 ${EXPORT_TABLE.font}px system-ui, -apple-system, "Segoe UI", Arial, sans-serif`;
    return ctx.measureText(String(column)).width;
  });
  ctx.font = `${EXPORT_TABLE.font}px system-ui, -apple-system, "Segoe UI", Arial, sans-serif`;
  for (const section of tableSections(table)) {
    for (const row of section.rows) {
      row.cells.forEach((cell, index) => {
        const value = String(cell == null ? "" : cell);
        const width = ctx.measureText(value).width + exportSwatchShift(row.color, value);
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
  height += EXPORT_TABLE.padding;
  return { width, height, bodyWidth, widths, sections, title, room, note, subtitle };
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
 */
export async function tablePng(table, options = {}) {
  const scale = options.scale > 0 ? options.scale : 1;
  const layout = exportTableLayout(table, options);
  const { widths, sections, title, room, note, subtitle, bodyWidth } = layout;
  const layoutWidth = layout.width;
  const layoutHeight = layout.height;

  const canvas = exportCanvas(layoutWidth * scale, layoutHeight * scale);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.scale(scale, scale);
  ctx.textBaseline = "middle";
  ctx.textAlign = "left";

  const left = EXPORT_TABLE.padding;
  let y = EXPORT_TABLE.padding;

  if (title) {
    ctx.fillStyle = EXPORT_TABLE.ink;
    ctx.font = `600 ${EXPORT_TABLE.titleFont}px system-ui, -apple-system, "Segoe UI", Arial, sans-serif`;
    ctx.fillText(title, left, y + EXPORT_TABLE.titleFont * 0.8);
    y += EXPORT_TABLE.titleFont * 1.6;
  }
  // Комната — сразу под именем объекта и тем же весом, что заголовок: лист по
  // одной комнате должен и на бумаге читаться как лист по комнате.
  if (room) {
    ctx.fillStyle = EXPORT_TABLE.ink;
    ctx.font = `600 ${EXPORT_TABLE.roomFont}px system-ui, -apple-system, "Segoe UI", Arial, sans-serif`;
    ctx.fillText(room, left, y + EXPORT_TABLE.roomFont * 0.8);
    y += EXPORT_TABLE.roomFont * 1.6;
  }
  // Лист, сужённый фильтром, признаётся в этом на бумаге — иначе неполная
  // таблица неотличима от полной.
  if (note) {
    ctx.fillStyle = EXPORT_TABLE.ink;
    ctx.font = `600 ${EXPORT_TABLE.font}px system-ui, -apple-system, "Segoe UI", Arial, sans-serif`;
    ctx.fillText(note, left, y + EXPORT_TABLE.font * 0.8);
    y += EXPORT_TABLE.font * 1.6;
  }
  if (subtitle) {
    ctx.fillStyle = EXPORT_TABLE.muted;
    ctx.font = `${EXPORT_TABLE.font}px system-ui, -apple-system, "Segoe UI", Arial, sans-serif`;
    ctx.fillText(subtitle, left, y + EXPORT_TABLE.font * 0.8);
    y += EXPORT_TABLE.font * 1.6;
  }

  // Ячейка, в которой напечатан код краски («#1F6FEB»), показывает и саму
  // краску: на бумаге монтажнику говорит квадратик, а не шестнадцатеричный код.
  const drawCells = (cells, textLeft, bold, rowColor) => {
    ctx.font = `${bold ? "600 " : ""}${EXPORT_TABLE.font}px system-ui, -apple-system, "Segoe UI", Arial, sans-serif`;
    let x = textLeft;
    cells.forEach((cell, index) => {
      const shift = exportSwatchShift(rowColor, cell);
      if (shift) {
        const ink = ctx.fillStyle;
        ctx.fillStyle = rowColor;
        ctx.fillRect(x, y + (EXPORT_TABLE.rowHeight - EXPORT_TABLE.swatch) / 2, EXPORT_TABLE.swatch, EXPORT_TABLE.swatch);
        ctx.fillStyle = ink;
      }
      const limit = widths[index] - EXPORT_TABLE.cellGap - shift;
      ctx.fillText(exportClip(ctx, cell, limit), x + shift, y + EXPORT_TABLE.rowHeight / 2);
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
      y += EXPORT_TABLE.gap;
      ctx.fillStyle = color;
      ctx.font = `600 ${EXPORT_TABLE.groupFont}px system-ui, -apple-system, "Segoe UI", Arial, sans-serif`;
      ctx.fillText(section.title, left, y + EXPORT_TABLE.rowHeight / 2);
      const lineY = y + EXPORT_TABLE.rowHeight - 2;
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(left, lineY);
      ctx.lineTo(left + bodyWidth, lineY);
      ctx.stroke();
      y += EXPORT_TABLE.rowHeight;
    }
    for (const row of section.rows) {
      ctx.fillStyle = row.color || section.color || EXPORT_TABLE.line;
      ctx.fillRect(left, y + 4, EXPORT_TABLE.stripe, EXPORT_TABLE.rowHeight - 8);
      ctx.fillStyle = EXPORT_TABLE.ink;
      drawCells(row.cells, left + EXPORT_TABLE.stripe + EXPORT_TABLE.gap, false, row.color);
      y += EXPORT_TABLE.rowHeight;
    }
    y += EXPORT_TABLE.gap;
  }

  return exportBlob(canvas);
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
 * Zip с картинками всех схем объекта. `images` — Map «imageId → Blob»
 * (или ImageBitmap). Zip пишется общим `writeZip`: PNG уже сжат, поэтому
 * хранится как есть.
 */
export async function allSchemesZip(project, images, options = {}) {
  // Форма входа одна — Map «imageId → Blob», как у packProject: разбирать
  // четыре формы одного и того же было бы вторым правилом на тот же вход.
  if (images != null && !(images instanceof Map)) throw new Error(strings.errors.imagesNotMap);
  const map = images || new Map();
  const schemes = schemesInOrder(project);
  const files = [];
  const onProgress = typeof options.onProgress === "function" ? options.onProgress : null;
  for (let index = 0; index < schemes.length; index += 1) {
    const scheme = schemes[index];
    const image = await exportImageOf(map.get(scheme.imageId));
    const blob = await schemePng(project, scheme, image, { ...options, area: "all" });
    const name = String(index + 1).padStart(2, "0") + "-" + exportEntryName(scheme.name) + ".png";
    files.push({ name, data: blob, compress: false });
    if (onProgress) onProgress({ done: index + 1, total: schemes.length, name });
  }
  return writeZip(files, { compress: false });
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
  const doc = exportNode("div", "print-doc");
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
    const block = exportNode("section", "print-doc__group");
    if (section.color) block.style.setProperty("--print-color", section.color);
    if (section.title) block.append(exportNode("h2", "print-doc__group-title", section.title));
    const tableNode = exportNode("table", "print-doc__table");
    const thead = exportNode("thead");
    const headRow = exportNode("tr");
    for (const column of table.columns) headRow.append(exportNode("th", null, column));
    thead.append(headRow);
    tableNode.append(thead);
    const tbody = exportNode("tbody");
    for (const row of section.rows) {
      const tr = exportNode("tr", "print-doc__row");
      if (row.color) tr.style.setProperty("--print-row-color", row.color);
      row.cells.forEach((cell, index) => {
        const td = exportNode("td", index === 0 ? "print-doc__label" : null, cell);
        if (row.color && String(cell) === row.color) {
          const swatch = exportNode("span", "print-doc__swatch");
          swatch.style.background = row.color;
          td.prepend(swatch);
        }
        tr.append(td);
      });
      tbody.append(tr);
    }
    tableNode.append(tbody);
    block.append(tableNode);
    doc.append(block);
  }

  if (options.extra) doc.append(options.extra);
  if (options.footer) doc.append(exportNode("footer", "print-doc__foot", options.footer));
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
 * extra}`) или «scheme» (данные: `{blob, title}`).
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
      footer: data.footer,
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
