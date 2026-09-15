// Рисование схемы и попадание по метке.
//
// Две системы координат. В объекте метки лежат долями плана (0…1) — так поворот
// и обрезка картинки не двигают разметку. На экране (и в экспорте) точка плана
// превращается в пиксели одной формулой planToScreen: смещение плюс доля,
// умноженная на размер плана и на масштаб.
//
// `view` для рисования — это `{zoom, offsetX, offsetY, markSize, labelSize}`:
// первые три приходят из состояния сеанса (`state.view`), последние два — из
// объекта (`project.view`), их двигает ползунок в панели инструментов. Размер
// метки задан в пикселях плана, поэтому метка живёт на плане как наклейка:
// приближение увеличивает и её, а экспорт в двойном разрешении даёт тот же вид.
import { SHAPE_NAMES, findType, findGroup, styleOf, labelOf, typesInOrder } from "./model.js";

export const SHAPES = SHAPE_NAMES;

// Доля радиуса, на которую внутренние вершины звезды ближе к центру.
const STAR_INNER = 0.45;
// Запас в пикселях вокруг метки, чтобы попадать по ней не идеально точно.
const HIT_SLACK_PX = 4;
// Ширина буквы относительно кегля — оценка, одинаковая в тесте и на холсте.
const LABEL_CHAR_RATIO = 0.62;
// Насколько далеко от метки стоит подпись, если её не оттаскивали.
const LABEL_GAP = 1.5;
// Ручки «+» стоят от центра метки на столько её радиусов.
const HANDLE_GAP = 2.4;
const HANDLE_RADIUS = 9;

const RENDER_VIEW_DEFAULTS = { zoom: 1, offsetX: 0, offsetY: 0, markSize: 10, labelSize: 12 };

// Углы вершин, градусы от «вверх». Все фигуры вписаны в окружность радиуса size.
const SHAPE_ANGLES = {
  square: [-135, -45, 45, 135],
  triangle: [-90, 30, 150],
  diamond: [-90, 0, 90, 180],
  hexagon: [-90, -30, 30, 90, 150, 210],
};

function renderView(view) {
  const merged = { ...RENDER_VIEW_DEFAULTS, ...(view || {}) };
  if (!(merged.zoom > 0)) merged.zoom = 1;
  return merged;
}

function polarPoint(x, y, radius, degrees) {
  const angle = (degrees * Math.PI) / 180;
  return { x: x + radius * Math.cos(angle), y: y + radius * Math.sin(angle) };
}

// Геометрия фигуры в экранных пикселях: круг или список вершин.
function shapeGeometry(shape, x, y, size) {
  const radius = Math.max(1, size);
  if (shape === "star") {
    const points = [];
    for (let index = 0; index < 10; index += 1) {
      const long = index % 2 === 0;
      points.push(polarPoint(x, y, long ? radius : radius * STAR_INNER, -90 + index * 36));
    }
    return { kind: "polygon", points, cx: x, cy: y, r: radius, cross: false };
  }
  const angles = SHAPE_ANGLES[shape];
  if (angles) {
    return {
      kind: "polygon",
      points: angles.map((degrees) => polarPoint(x, y, radius, degrees)),
      cx: x,
      cy: y,
      r: radius,
      cross: false,
    };
  }
  return { kind: "circle", cx: x, cy: y, r: radius, points: [], cross: shape === "circle-cross" };
}

// Одна фигура — одним кодом и на экране, и в экспорте.
export function drawShape(ctx, shape, x, y, size, color) {
  const geometry = shapeGeometry(shape, x, y, size);
  const line = Math.max(1, size * 0.22);
  ctx.save();
  ctx.lineJoin = "round";
  ctx.lineWidth = line;
  ctx.fillStyle = "#ffffff";
  ctx.strokeStyle = color;
  ctx.beginPath();
  if (geometry.kind === "circle") {
    ctx.arc(geometry.cx, geometry.cy, geometry.r, 0, Math.PI * 2);
  } else {
    geometry.points.forEach((point, index) => {
      if (index === 0) ctx.moveTo(point.x, point.y);
      else ctx.lineTo(point.x, point.y);
    });
    ctx.closePath();
  }
  ctx.fill();
  ctx.stroke();
  if (geometry.cross) {
    const arm = geometry.r * Math.SQRT1_2;
    ctx.beginPath();
    ctx.moveTo(geometry.cx - arm, geometry.cy - arm);
    ctx.lineTo(geometry.cx + arm, geometry.cy + arm);
    ctx.moveTo(geometry.cx + arm, geometry.cy - arm);
    ctx.lineTo(geometry.cx - arm, geometry.cy + arm);
    ctx.stroke();
  }
  ctx.restore();
}

// ——— координаты —————————————————————————————————————————————————————

export function planToScreen(point, scheme, view) {
  const state = renderView(view);
  return {
    x: state.offsetX + point.x * schemeWidth(scheme) * state.zoom,
    y: state.offsetY + point.y * schemeHeight(scheme) * state.zoom,
  };
}

export function screenToPlan(point, scheme, view) {
  const state = renderView(view);
  return {
    x: (point.x - state.offsetX) / (schemeWidth(scheme) * state.zoom),
    y: (point.y - state.offsetY) / (schemeHeight(scheme) * state.zoom),
  };
}

function schemeWidth(scheme) {
  return scheme && scheme.width > 0 ? scheme.width : 1000;
}

function schemeHeight(scheme) {
  return scheme && scheme.height > 0 ? scheme.height : 1000;
}

// Радиус метки на экране: размер задан в пикселях плана и растёт с масштабом.
export function markRadius(view) {
  const state = renderView(view);
  return Math.max(2, state.markSize * state.zoom);
}

function labelFontSize(view) {
  const state = renderView(view);
  return Math.max(6, state.labelSize * state.zoom);
}

// Вписать план в прямоугольник холста.
export function fitView(scheme, viewport) {
  const width = schemeWidth(scheme);
  const height = schemeHeight(scheme);
  const boxWidth = Math.max(1, viewport.width);
  const boxHeight = Math.max(1, viewport.height);
  const zoom = Math.min(boxWidth / width, boxHeight / height) * 0.96;
  return {
    zoom,
    offsetX: (boxWidth - width * zoom) / 2,
    offsetY: (boxHeight - height * zoom) / 2,
  };
}

// ——— видимость ———————————————————————————————————————————————————————

// Фильтр панели меток: скрытая метка не рисуется и по ней не кликается.
function markVisible(project, mark, filter) {
  if (!filter) return true;
  if (Array.isArray(filter.typeIds) && !filter.typeIds.includes(mark.typeId)) return false;
  if (Array.isArray(filter.categoryIds)) {
    const type = findType(project, mark.typeId);
    if (!type || !filter.categoryIds.includes(type.categoryId)) return false;
  }
  if (filter.roomId && mark.roomId !== filter.roomId) return false;
  const query = (filter.query || "").trim().toLowerCase();
  if (!query) return true;
  const haystack = [labelOf(project, mark.id), mark.location, mark.original]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return haystack.includes(query);
}

export function visibleMarks(project, scheme, filter) {
  if (!project || !scheme) return [];
  return project.marks.filter((mark) => mark.schemeId === scheme.id && markVisible(project, mark, filter));
}

// ——— подписи —————————————————————————————————————————————————————————

// Точка привязки подписи: для одиночной метки — её точка, для группы — середина
// между входящими метками. Смещение подписи хранится в пикселях плана, поэтому
// поворот плана уносит её вместе с меткой.
function labelOrigin(project, target) {
  if (target.markIds) {
    const points = target.markIds
      .map((id) => project.marks.find((mark) => mark.id === id))
      .filter(Boolean)
      .map((mark) => mark.points[0]);
    if (points.length === 0) return { x: 0, y: 0 };
    const sum = points.reduce((acc, point) => ({ x: acc.x + point.x, y: acc.y + point.y }), { x: 0, y: 0 });
    return { x: sum.x / points.length, y: sum.y / points.length };
  }
  return target.points[0];
}

// Смещение подписи. У группы своего поля модель не заводит — её подпись стоит
// по смещению первой метки блока (собственной подписи у этой метки нет,
// подпись у блока одна), и правится оно обычным updateMark.
export function labelOffsetOf(project, target) {
  if (!target.markIds) return target.labelOffset || null;
  if (target.labelOffset) return target.labelOffset;
  const first = project.marks.find((mark) => mark.id === target.markIds[0]);
  return first && first.labelOffset ? first.labelOffset : null;
}

export function labelBox(project, scheme, target, view) {
  const state = renderView(view);
  const font = labelFontSize(state);
  const radius = markRadius(state);
  const anchor = planToScreen(labelOrigin(project, target), scheme, state);
  const offset = labelOffsetOf(project, target);
  const dx = offset ? offset.dx * state.zoom : radius * LABEL_GAP;
  const dy = offset ? offset.dy * state.zoom : -radius * LABEL_GAP;
  const value = labelOf(project, target.id) || "";
  return {
    text: value,
    x: anchor.x + dx,
    y: anchor.y + dy,
    width: Math.max(font * 0.8, value.length * font * LABEL_CHAR_RATIO),
    height: font * 1.2,
    font,
  };
}

// Подписи рисуются у меток без группы и по одной на группу.
function labelTargets(project, scheme, filter) {
  const marks = visibleMarks(project, scheme, filter);
  const targets = [];
  const seenGroups = new Set();
  for (const mark of marks) {
    if (!mark.groupId) {
      targets.push(mark);
      continue;
    }
    if (seenGroups.has(mark.groupId)) continue;
    seenGroups.add(mark.groupId);
    const group = findGroup(project, mark.groupId);
    if (group) targets.push(group);
    else targets.push(mark);
  }
  return targets;
}

// ——— попадание ———————————————————————————————————————————————————————

function pointInPolygon(point, points) {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i, i += 1) {
    const a = points[i];
    const b = points[j];
    const crosses = a.y > point.y !== b.y > point.y;
    if (crosses && point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

function distanceToSegment(point, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSq = dx * dx + dy * dy;
  if (lengthSq === 0) return Math.hypot(point.x - a.x, point.y - a.y);
  let t = ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSq;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(point.x - (a.x + t * dx), point.y - (a.y + t * dy));
}

function insideBox(point, box) {
  return (
    point.x >= box.x - 2 &&
    point.x <= box.x + box.width + 2 &&
    point.y >= box.y - box.height / 2 &&
    point.y <= box.y + box.height / 2
  );
}

// Точка — в экранных пикселях холста. Возвращает `{markId, part, index}`:
// `part` — `label` (подпись, её таскают отдельно), `mark` (точка или вершина
// линии), `line` (сегмент ломаной). Сверху вниз: подписи, потом метки в обратном
// порядке постановки — поздняя метка лежит выше ранней.
export function hitTest(project, scheme, point, view, filter) {
  if (!project || !scheme) return null;
  const state = renderView(view);
  const radius = markRadius(state);
  const slack = radius + HIT_SLACK_PX;

  const targets = labelTargets(project, scheme, filter);
  for (let index = targets.length - 1; index >= 0; index -= 1) {
    const target = targets[index];
    const box = labelBox(project, scheme, target, state);
    if (box.text && insideBox(point, box)) {
      const markId = target.markIds ? target.markIds[0] : target.id;
      return { markId, part: "label", groupId: target.markIds ? target.id : null, index: 0 };
    }
  }

  const marks = visibleMarks(project, scheme, filter);
  for (let index = marks.length - 1; index >= 0; index -= 1) {
    const mark = marks[index];
    const style = styleOf(project, mark.typeId);
    const screen = mark.points.map((item) => planToScreen(item, scheme, state));
    for (let vertex = 0; vertex < screen.length; vertex += 1) {
      const geometry = shapeGeometry(style.shape, screen[vertex].x, screen[vertex].y, radius);
      const near =
        geometry.kind === "circle"
          ? Math.hypot(point.x - geometry.cx, point.y - geometry.cy) <= slack
          : pointInPolygon(point, geometry.points) ||
            Math.hypot(point.x - geometry.cx, point.y - geometry.cy) <= slack;
      if (near) return { markId: mark.id, part: "mark", groupId: mark.groupId, index: vertex };
    }
    if (mark.kind === "line" && screen.length > 1) {
      const last = mark.closed ? screen.length : screen.length - 1;
      for (let segment = 0; segment < last; segment += 1) {
        const a = screen[segment];
        const b = screen[(segment + 1) % screen.length];
        if (distanceToSegment(point, a, b) <= Math.max(4, radius * 0.6)) {
          return { markId: mark.id, part: "line", groupId: mark.groupId, index: segment };
        }
      }
    }
  }
  return null;
}

// ——— ручки блока —————————————————————————————————————————————————————

// Четыре «+» вокруг выделенной точки: клик ставит соседнюю точку блока.
// Ради них таск и существует: два десятка розеток ставятся без диалогов.
function handlePositions(scheme, mark, view) {
  if (!mark || mark.kind !== "point") return [];
  const state = renderView(view);
  const radius = markRadius(state);
  const gap = radius * HANDLE_GAP;
  const base = planToScreen(mark.points[mark.points.length - 1], scheme, state);
  const handleRadius = Math.max(7, Math.min(HANDLE_RADIUS, radius));
  return [
    { side: "left", x: base.x - gap, y: base.y, r: handleRadius },
    { side: "right", x: base.x + gap, y: base.y, r: handleRadius },
    { side: "up", x: base.x, y: base.y - gap, r: handleRadius },
    { side: "down", x: base.x, y: base.y + gap, r: handleRadius },
  ];
}

export function hitHandle(scheme, mark, point, view) {
  for (const handle of handlePositions(scheme, mark, view)) {
    if (Math.hypot(point.x - handle.x, point.y - handle.y) <= handle.r + 2) return handle.side;
  }
  return null;
}

// ——— рисование ———————————————————————————————————————————————————————

function drawLabel(ctx, box, color) {
  if (!box.text) return;
  ctx.save();
  ctx.font = `600 ${box.font}px system-ui, -apple-system, "Segoe UI", Arial, sans-serif`;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  // Обводка-подложка: подпись читается и поверх тёмных линий плана.
  ctx.lineWidth = Math.max(2, box.font * 0.3);
  ctx.lineJoin = "round";
  ctx.strokeStyle = "rgba(255, 255, 255, 0.92)";
  ctx.strokeText(box.text, box.x, box.y);
  ctx.fillStyle = color;
  ctx.fillText(box.text, box.x, box.y);
  ctx.restore();
}

function drawMarkBody(ctx, project, scheme, mark, view, selected) {
  const style = styleOf(project, mark.typeId);
  const radius = markRadius(view);
  const screen = mark.points.map((point) => planToScreen(point, scheme, view));
  if (mark.kind === "line" && screen.length > 1) {
    ctx.save();
    ctx.strokeStyle = style.color;
    ctx.lineWidth = Math.max(2, radius * 0.5);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    screen.forEach((point, index) => (index === 0 ? ctx.moveTo(point.x, point.y) : ctx.lineTo(point.x, point.y)));
    if (mark.closed) ctx.closePath();
    ctx.stroke();
    ctx.restore();
    for (const point of screen) drawShape(ctx, "circle", point.x, point.y, Math.max(2, radius * 0.45), style.color);
  } else {
    for (const point of screen) drawShape(ctx, style.shape, point.x, point.y, radius, style.color);
  }
  if (!selected) return;
  ctx.save();
  ctx.strokeStyle = "#0969da";
  ctx.setLineDash([4, 3]);
  ctx.lineWidth = 2;
  for (const point of screen) {
    ctx.beginPath();
    ctx.arc(point.x, point.y, radius * 1.6, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
}

// Ручки «+» рисуются только у выделенной точки.
export function drawHandles(ctx, scheme, mark, view) {
  for (const handle of handlePositions(scheme, mark, view)) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(handle.x, handle.y, handle.r, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(255, 255, 255, 0.95)";
    ctx.strokeStyle = "#0969da";
    ctx.lineWidth = 1.5;
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    const arm = handle.r * 0.5;
    ctx.moveTo(handle.x - arm, handle.y);
    ctx.lineTo(handle.x + arm, handle.y);
    ctx.moveTo(handle.x, handle.y - arm);
    ctx.lineTo(handle.x, handle.y + arm);
    ctx.strokeStyle = "#0969da";
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.restore();
  }
}

// Черновик линии: уже поставленные вершины плюс резинка до курсора.
function drawDraft(ctx, scheme, draft, view, color) {
  if (!draft || draft.points.length === 0) return;
  const radius = markRadius(view);
  const screen = draft.points.map((point) => planToScreen(point, scheme, view));
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(2, radius * 0.5);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  screen.forEach((point, index) => (index === 0 ? ctx.moveTo(point.x, point.y) : ctx.lineTo(point.x, point.y)));
  if (draft.cursor) {
    const cursor = planToScreen(draft.cursor, scheme, view);
    ctx.lineTo(cursor.x, cursor.y);
  }
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();
  for (const point of screen) drawShape(ctx, "circle", point.x, point.y, Math.max(3, radius * 0.5), color);
  // Первая вершина крупнее: по ней замыкают контур.
  drawShape(ctx, "circle", screen[0].x, screen[0].y, Math.max(4, radius * 0.75), color);
}

function legendRows(project, scheme, filter) {
  const used = new Set(visibleMarks(project, scheme, filter).map((mark) => mark.typeId));
  const rows = [];
  for (const group of typesInOrder(project)) {
    for (const type of group.types) {
      if (!used.has(type.id)) continue;
      rows.push({ code: type.code, name: type.name, category: group.category.name, ...styleOf(project, type.id) });
    }
  }
  return rows;
}

// Легенда — для выгрузки: список типов, встреченных на схеме.
export function drawLegend(ctx, { project, scheme, filter, view, box }) {
  const rows = legendRows(project, scheme, filter);
  if (rows.length === 0) return;
  const state = renderView(view);
  const font = Math.max(11, labelFontSize(state) * 0.9);
  const step = font * 1.7;
  const width = font * 16;
  const height = step * rows.length + font;
  const x = box ? box.x : 12;
  const y = box ? box.y : 12;
  ctx.save();
  ctx.fillStyle = "rgba(255, 255, 255, 0.92)";
  ctx.strokeStyle = "#d0d7de";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.rect(x, y, width, height);
  ctx.fill();
  ctx.stroke();
  ctx.font = `${font}px system-ui, -apple-system, "Segoe UI", Arial, sans-serif`;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  rows.forEach((row, index) => {
    const lineY = y + font * 0.6 + step * (index + 0.5);
    drawShape(ctx, row.shape, x + font * 1.1, lineY, font * 0.55, row.color);
    ctx.fillStyle = "#1f2328";
    ctx.fillText(`${row.code} — ${row.name}`, x + font * 2.2, lineY);
  });
  ctx.restore();
}

// Весь кадр: план, метки, подписи, при надобности легенда. Тот же код и на
// экране, и в экспорте — меняется только масштаб во `view`.
export function drawScheme(ctx, { project, scheme, image, filter, view, legend, selectedIds, draft, draftColor }) {
  const state = renderView(view);
  if (image) {
    ctx.save();
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(
      image,
      state.offsetX,
      state.offsetY,
      schemeWidth(scheme) * state.zoom,
      schemeHeight(scheme) * state.zoom,
    );
    ctx.restore();
  }
  if (!project || !scheme) return;
  const selected = new Set(selectedIds || []);
  for (const mark of visibleMarks(project, scheme, filter)) {
    drawMarkBody(ctx, project, scheme, mark, state, selected.has(mark.id));
  }
  for (const target of labelTargets(project, scheme, filter)) {
    const typeId = target.markIds
      ? (project.marks.find((mark) => mark.id === target.markIds[0]) || {}).typeId
      : target.typeId;
    drawLabel(ctx, labelBox(project, scheme, target, state), styleOf(project, typeId).color);
  }
  if (draft) drawDraft(ctx, scheme, draft, state, draftColor || "#0969da");
  if (legend) drawLegend(ctx, { project, scheme, filter, view: state, box: legend === true ? null : legend });
}

// Дверь для тестов — не для панелей: за ней внутренности drawScheme, которые
// снаружи вызывать незачем, но проверить нужно (геометрия, видимость, запас
// попадания). Панели и экспорт берут только именованные экспорты выше.
export const renderInternals = {
  shapeGeometry,
  labelFontSize,
  labelTargets,
  labelOrigin,
  markVisible,
  handlePositions,
  drawDraft,
  HIT_SLACK_PX,
  LABEL_CHAR_RATIO,
  LABEL_GAP,
  HANDLE_GAP,
};
