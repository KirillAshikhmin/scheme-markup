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
import {
  SHAPE_NAMES,
  blockLabel,
  blockMembers,
  findRoom,
  findType,
  findGroup,
  outlinesInOrder,
  pointInOutline,
  styleOf,
  labelOf,
  typesInOrder,
} from "./model.js";

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

// Рамка легенды в высотах строки: отступ до текста, минимальная и предельная
// ширина. Предел — чтобы длинный код не растянул легенду на полплана.
const LEGEND_TEXT_EM = 2.2;
const LEGEND_MIN_EM = 16;
const LEGEND_MAX_EM = 34;

// Строка легенды по ширине рамки: остаток обрезается многоточием. Мерить
// нужно тем же `ctx`, которым будем рисовать, — шрифт уже выставлен.
function legendClip(ctx, value, limit) {
  if (ctx.measureText(value).width <= limit) return value;
  let cut = value;
  while (cut.length > 1 && ctx.measureText(cut + "…").width > limit) cut = cut.slice(0, -1);
  return cut + "…";
}

// Контур помещения: тонкая линия цветом комнаты и полупрозрачная заливка.
// На бумаге («pale») и линия, и заливка бледнее — контур там подсказка,
// а не главное на листе: главное — метки.
const OUTLINE_STYLE = {
  normal: { line: 1.6, fill: 0.1, label: 0.95 },
  pale: { line: 1, fill: 0.05, label: 0.6 },
};
// Запас в пикселях, с которым попадают по стенке контура.
const OUTLINE_HIT_PX = 6;
// Радиус ручки вершины и ручки «+» на середине стенки.
const OUTLINE_HANDLE_PX = 6;
const OUTLINE_COLOR_FALLBACK = "#57606a";

// Углы вершин, градусы от «вверх». Все фигуры вписаны в окружность радиуса size.
const SHAPE_ANGLES = {
  square: [-135, -45, 45, 135],
  triangle: [-90, 30, 150],
  "triangle-down": [90, 210, 330],
  diamond: [-90, 0, 90, 180],
  hexagon: [-90, -30, 30, 90, 150, 210],
};

// Родня фигур: контур берётся у базовой, а отличает их засечка внутри.
// Так «розетка» и «розетка двойная» различаются в 14 пикселях, а на плане
// по-прежнему рисуются одним `drawShape`.
const SHAPE_BASE = {
  "circle-cross": "circle",
  "circle-dot": "circle",
  "circle-fill": "circle",
  "circle-half": "circle",
  "square-cross": "square",
  "square-fill": "square",
  "diamond-fill": "diamond",
};

// Засечка внутри: перекрестье, точка, сплошная заливка, залитая нижняя половина.
const SHAPE_DECOR = {
  "circle-cross": "cross",
  "square-cross": "cross",
  "circle-dot": "dot",
  "circle-fill": "fill",
  "square-fill": "fill",
  "diamond-fill": "fill",
  "circle-half": "half",
};

// Доля радиуса, на которую отступает от края «талия» плюса.
const PLUS_WAIST = 0.36;
// Точка внутри знака: меньше — сливается с пустым кругом на распечатке.
const DOT_RADIUS = 0.42;

function renderView(view) {
  const merged = { ...RENDER_VIEW_DEFAULTS, ...(view || {}) };
  if (!(merged.zoom > 0)) merged.zoom = 1;
  return merged;
}

function polarPoint(x, y, radius, degrees) {
  const angle = (degrees * Math.PI) / 180;
  return { x: x + radius * Math.cos(angle), y: y + radius * Math.sin(angle) };
}

// Геометрия фигуры в экранных пикселях: круг или список вершин плюс засечка,
// которую рисуют поверх контура.
function shapeGeometry(shape, x, y, size) {
  const radius = Math.max(1, size);
  const base = SHAPE_BASE[shape] || shape;
  const decor = SHAPE_DECOR[shape] || null;
  const shell = {
    cx: x,
    cy: y,
    r: radius,
    line: Math.max(1, radius * 0.22),
    cross: decor === "cross",
    decor: decor === "cross" ? null : decor,
  };

  if (base === "star") {
    const points = [];
    for (let index = 0; index < 10; index += 1) {
      const long = index % 2 === 0;
      points.push(polarPoint(x, y, long ? radius : radius * STAR_INNER, -90 + index * 36));
    }
    return { kind: "polygon", points, ...shell };
  }
  if (base === "plus") {
    // Двенадцать вершин: четыре конца по осям и «талия» между ними.
    const arm = radius;
    const waist = radius * PLUS_WAIST;
    const points = [
      { x: x - waist, y: y - arm },
      { x: x + waist, y: y - arm },
      { x: x + waist, y: y - waist },
      { x: x + arm, y: y - waist },
      { x: x + arm, y: y + waist },
      { x: x + waist, y: y + waist },
      { x: x + waist, y: y + arm },
      { x: x - waist, y: y + arm },
      { x: x - waist, y: y + waist },
      { x: x - arm, y: y + waist },
      { x: x - arm, y: y - waist },
      { x: x - waist, y: y - waist },
    ];
    return { kind: "polygon", points, ...shell };
  }
  const angles = SHAPE_ANGLES[base];
  if (angles) {
    return { kind: "polygon", points: angles.map((degrees) => polarPoint(x, y, radius, degrees)), ...shell };
  }
  return { kind: "circle", points: [], ...shell };
}

// Начинка знака: что закрашивается внутри контура и чем. Единственное описание
// закраски в сборке — по нему рисует `drawShape`, по нему же тест снимает
// отпечаток, так что разойтись правилам негде.
// `role` — смысл («сплошная», «половина», «точка», «крест»), `mask` — область
// краски: вся внутренность, прямоугольник, круг или линии заданной толщины.
function shapeInternals(geometry) {
  const parts = [];
  if (geometry.decor === "fill") {
    parts.push({ role: "fill", mask: "interior" });
  } else if (geometry.decor === "half") {
    // Залита нижняя половина: прямоугольник от центра вниз, обрезанный контуром.
    parts.push({
      role: "half",
      mask: "rect",
      x: geometry.cx - geometry.r,
      y: geometry.cy,
      width: geometry.r * 2,
      height: geometry.r,
    });
  } else if (geometry.decor === "dot") {
    parts.push({
      role: "dot",
      mask: "disc",
      cx: geometry.cx,
      cy: geometry.cy,
      r: Math.max(1, geometry.r * DOT_RADIUS),
    });
  }
  if (geometry.cross) {
    const arm = geometry.r * Math.SQRT1_2;
    parts.push({
      role: "cross",
      mask: "lines",
      width: geometry.line,
      segments: [
        [
          { x: geometry.cx - arm, y: geometry.cy - arm },
          { x: geometry.cx + arm, y: geometry.cy + arm },
        ],
        [
          { x: geometry.cx + arm, y: geometry.cy - arm },
          { x: geometry.cx - arm, y: geometry.cy + arm },
        ],
      ],
    });
  }
  return parts;
}

// Одна фигура — одним кодом и на экране, и в экспорте.
export function drawShape(ctx, shape, x, y, size, color) {
  const geometry = shapeGeometry(shape, x, y, size);
  ctx.save();
  ctx.lineJoin = "round";
  ctx.lineWidth = geometry.line;
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
  // Заливка и засечка идут поверх белой подложки, контур — поверх них: так
  // фигура читается и на тёмной линии плана, и на чёрно-белой распечатке.
  for (const part of shapeInternals(geometry)) {
    if (part.mask === "interior") {
      ctx.fillStyle = color;
      ctx.fill();
      ctx.stroke();
    } else if (part.mask === "rect") {
      ctx.save();
      ctx.clip();
      ctx.fillStyle = color;
      ctx.fillRect(part.x, part.y, part.width, part.height);
      ctx.restore();
      ctx.stroke();
    } else if (part.mask === "disc") {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(part.cx, part.cy, part.r, 0, Math.PI * 2);
      ctx.fill();
    } else if (part.mask === "lines") {
      ctx.lineWidth = part.width;
      ctx.beginPath();
      for (const [from, to] of part.segments) {
        ctx.moveTo(from.x, from.y);
        ctx.lineTo(to.x, to.y);
      }
      ctx.stroke();
    }
  }
  ctx.restore();
}

// Значок фигуры для списков и сеток: тот же `drawShape` на маленьком холсте.
// Одна функция на весь интерфейс — в справочнике, в списке меток и в сетке
// выбора видно ровно то, что попадёт на план и на распечатку.
export function shapeIcon(shape, color, size = 22) {
  const canvas = document.createElement("canvas");
  canvas.className = "shape-icon";
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext ? canvas.getContext("2d") : null;
  if (ctx) drawShape(ctx, shape, size / 2, size / 2, size * 0.34, color);
  return canvas;
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
    const points = labelMemberIds(target)
      .map((id) => project.marks.find((mark) => mark.id === id))
      .filter(Boolean)
      .map((mark) => mark.points[0]);
    if (points.length === 0) return { x: 0, y: 0 };
    const sum = points.reduce((acc, point) => ({ x: acc.x + point.x, y: acc.y + point.y }), { x: 0, y: 0 });
    return { x: sum.x / points.length, y: sum.y / points.length };
  }
  return target.points[0];
}

// Метки блока, по которым собирается подпись: под фильтром — только видимые
// (`shownIds` кладёт labelTargets), иначе весь блок. Смещение подписи это не
// трогает: его держит первая метка блока, видимая она или нет.
function labelMemberIds(target) {
  return target.shownIds || target.markIds;
}

// Ведущая метка подписи: у блока — та, с которой подпись начинается,
// у одиночной метки — она сама. По ней берётся цвет подписи: подпись
// «В1, Р1» красится зелёным выключателя, а не красным розетки.
export function labelLead(project, target) {
  if (!target) return null;
  if (!target.markIds) return target;
  const [lead] = blockMembers(project, labelMemberIds(target));
  return lead || null;
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
  const value = (target.markIds ? blockLabel(project, labelMemberIds(target)) : labelOf(project, target.id)) || "";
  const width = Math.max(font * 0.8, value.length * font * LABEL_CHAR_RATIO);
  let x = anchor.x + dx;
  // Код типа бывает длинным («ПОДСВЕТКА», шестнадцать букв), и у правого края
  // такая подпись уходила за план — на выгрузке «весь план» её просто срезало.
  // Подпись, которую не оттаскивали руками, переходит на левую сторону метки,
  // если слева помещается; оттащенную не двигает никто.
  if (!offset) {
    const left = planToScreen({ x: 0, y: 0 }, scheme, state).x;
    const right = planToScreen({ x: 1, y: 0 }, scheme, state).x;
    const mirrored = anchor.x - dx - width;
    if (x + width > right && mirrored >= left) x = mirrored;
  }
  return { text: value, x, y: anchor.y + dy, width, height: font * 1.2, font };
}

// Подписи рисуются у меток без группы и по одной на группу. Цель группы несёт
// `shownIds` — метки блока, прошедшие фильтр: на листе розеток от смешанного
// блока остаётся «Р1», а не «В1, Р1» с невидимым выключателем.
function labelTargets(project, scheme, filter) {
  const marks = visibleMarks(project, scheme, filter);
  const targets = [];
  const byGroup = new Map();
  for (const mark of marks) {
    if (!mark.groupId) {
      targets.push(mark);
      continue;
    }
    let target = byGroup.get(mark.groupId);
    if (!target) {
      const group = findGroup(project, mark.groupId);
      if (!group) {
        targets.push(mark);
        continue;
      }
      target = { ...group, shownIds: [] };
      byGroup.set(mark.groupId, target);
      targets.push(target);
    }
    target.shownIds.push(mark.id);
  }
  return targets;
}

// ——— контуры помещений ————————————————————————————————————————————————

// Цвет комнаты с прозрачностью: заливка контура не должна перебивать план,
// поэтому она всегда полупрозрачна, а линия — нет.
function outlineTint(color, alpha) {
  const hex = /^#[0-9a-fA-F]{6}$/.test(String(color || "")) ? color : OUTLINE_COLOR_FALLBACK;
  const value = parseInt(hex.slice(1), 16);
  return `rgba(${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255}, ${alpha})`;
}

function outlineScreen(scheme, outline, view) {
  return outline.points.map((point) => planToScreen(point, scheme, view));
}

// Середина многоугольника для подписи: центр по площади, а не по вершинам, —
// у Г-образной комнаты он ближе к её телу, чем среднее углов.
function outlineCenter(points) {
  let area = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0, j = points.length - 1; i < points.length; j = i, i += 1) {
    const cross = points[j].x * points[i].y - points[i].x * points[j].y;
    area += cross;
    cx += (points[j].x + points[i].x) * cross;
    cy += (points[j].y + points[i].y) * cross;
  }
  if (Math.abs(area) < 1e-9) {
    const sum = points.reduce((acc, point) => ({ x: acc.x + point.x, y: acc.y + point.y }), { x: 0, y: 0 });
    return { x: sum.x / points.length, y: sum.y / points.length };
  }
  return { x: cx / (3 * area), y: cy / (3 * area) };
}

// Контуры схемы, прошедшие фильтр: сужение списка меток до одного помещения
// оставляет на плане и его контур — иначе лист по комнате обещает не ту комнату.
export function visibleOutlines(project, scheme, filter) {
  if (!project || !scheme) return [];
  const roomId = filter && filter.roomId ? filter.roomId : null;
  return outlinesInOrder(project, scheme.id).filter((outline) => !roomId || outline.roomId === roomId);
}

function outlineColor(project, outline) {
  const room = findRoom(project, outline.roomId);
  return (room && room.color) || OUTLINE_COLOR_FALLBACK;
}

// Ручки правки: вершины (их двигают и удаляют) и «+» на середине каждой стенки
// (по нему вершина добавляется). Замыкающая стенка — такая же, как все.
export function outlineHandles(scheme, outline, view) {
  const state = renderView(view);
  const screen = outlineScreen(scheme, outline, state);
  const handles = [];
  screen.forEach((point, index) => {
    handles.push({ kind: "vertex", index, x: point.x, y: point.y, r: OUTLINE_HANDLE_PX });
    const next = screen[(index + 1) % screen.length];
    handles.push({
      kind: "insert",
      index,
      x: (point.x + next.x) / 2,
      y: (point.y + next.y) / 2,
      r: OUTLINE_HANDLE_PX - 1,
    });
  });
  return handles;
}

/**
 * Попадание по контуру. Клик по метке всегда важнее — поэтому холст зовёт
 * сперва `hitTest`, и только потом это. Внутренность контура не ловится:
 * иначе заливка комнаты перехватывала бы клики по пустому плану.
 * `selectedOutlineId` — у выделенного контура ловятся ещё и ручки вершин.
 */
export function hitOutline(project, scheme, point, view, filter, selectedOutlineId) {
  if (!project || !scheme) return null;
  const state = renderView(view);
  const outlines = visibleOutlines(project, scheme, filter);
  const selected = outlines.find((outline) => outline.id === selectedOutlineId);
  if (selected) {
    for (const handle of outlineHandles(scheme, selected, state)) {
      if (Math.hypot(point.x - handle.x, point.y - handle.y) <= handle.r + 2) {
        return { outlineId: selected.id, part: handle.kind, index: handle.index };
      }
    }
  }
  // Меньший контур лежит в порядке последним и ловится первым: у комнаты
  // внутри комнаты стенки могут совпасть со стенками большей.
  for (let index = outlines.length - 1; index >= 0; index -= 1) {
    const outline = outlines[index];
    const screen = outlineScreen(scheme, outline, state);
    for (let i = 0; i < screen.length; i += 1) {
      const a = screen[i];
      const b = screen[(i + 1) % screen.length];
      if (distanceToSegment(point, a, b) <= OUTLINE_HIT_PX) {
        return { outlineId: outline.id, part: "edge", index: i };
      }
    }
    const label = outlineLabelBox(project, scheme, outline, state);
    if (label && insideBox(point, label)) return { outlineId: outline.id, part: "label", index: 0 };
  }
  return null;
}

function outlineLabelBox(project, scheme, outline, view) {
  const room = findRoom(project, outline.roomId);
  if (!room || !room.name) return null;
  const state = renderView(view);
  const font = Math.max(9, labelFontSize(state) * 0.95);
  const center = planToScreen(outlineCenter(outline.points), scheme, state);
  const width = room.name.length * font * LABEL_CHAR_RATIO;
  return { text: room.name, x: center.x - width / 2, y: center.y, width, height: font * 1.2, font };
}

/**
 * Контуры помещений под метками: тонкая линия цветом комнаты, полупрозрачная
 * заливка и название внутри. `mode` — `"pale"` для бумаги.
 */
export function drawOutlines(ctx, { project, scheme, filter, view, mode, selectedOutlineId }) {
  const outlines = visibleOutlines(project, scheme, filter);
  if (outlines.length === 0) return;
  const state = renderView(view);
  const style = OUTLINE_STYLE[mode === "pale" ? "pale" : "normal"];
  for (const outline of outlines) {
    const color = outlineColor(project, outline);
    const screen = outlineScreen(scheme, outline, state);
    ctx.save();
    ctx.beginPath();
    screen.forEach((point, index) => (index === 0 ? ctx.moveTo(point.x, point.y) : ctx.lineTo(point.x, point.y)));
    ctx.closePath();
    ctx.fillStyle = outlineTint(color, style.fill);
    ctx.fill();
    ctx.lineJoin = "round";
    ctx.lineWidth = style.line;
    ctx.strokeStyle = outline.id === selectedOutlineId ? "#0969da" : outlineTint(color, 0.9);
    if (outline.id === selectedOutlineId) ctx.setLineDash([6, 4]);
    ctx.stroke();
    ctx.restore();

    const label = outlineLabelBox(project, scheme, outline, state);
    if (!label) continue;
    ctx.save();
    ctx.font = `600 ${label.font}px system-ui, -apple-system, "Segoe UI", Arial, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.lineWidth = Math.max(2, label.font * 0.3);
    ctx.lineJoin = "round";
    ctx.strokeStyle = "rgba(255, 255, 255, 0.85)";
    ctx.strokeText(label.text, label.x + label.width / 2, label.y);
    ctx.fillStyle = outlineTint(color, style.label);
    ctx.fillText(label.text, label.x + label.width / 2, label.y);
    ctx.restore();
  }
}

// Ручки выделенного контура: квадрат на вершине, «+» на середине стенки.
export function drawOutlineHandles(ctx, scheme, outline, view, color) {
  const tint = color || "#0969da";
  for (const handle of outlineHandles(scheme, outline, renderView(view))) {
    ctx.save();
    ctx.fillStyle = "rgba(255, 255, 255, 0.95)";
    ctx.strokeStyle = tint;
    ctx.lineWidth = 1.5;
    if (handle.kind === "vertex") {
      ctx.beginPath();
      ctx.rect(handle.x - handle.r, handle.y - handle.r, handle.r * 2, handle.r * 2);
      ctx.fill();
      ctx.stroke();
    } else {
      ctx.beginPath();
      ctx.arc(handle.x, handle.y, handle.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      const arm = handle.r * 0.55;
      ctx.moveTo(handle.x - arm, handle.y);
      ctx.lineTo(handle.x + arm, handle.y);
      ctx.moveTo(handle.x, handle.y - arm);
      ctx.lineTo(handle.x, handle.y + arm);
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
    ctx.restore();
  }
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
      // Подпись блока выбирает первую из тех меток, что в ней перечислены:
      // под фильтром скрытая метка в подписи не стоит и выбираться не должна.
      const markId = target.markIds ? labelMemberIds(target)[0] : target.id;
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

// Ручки «+» рисуются только у выделенной точки. `color` — цвет типа, который
// эта ручка поставит: в смешанном блоке она красится в цвет ставящейся метки,
// а без него остаётся цветом выделения.
export function drawHandles(ctx, scheme, mark, view, color) {
  const tint = color || "#0969da";
  for (const handle of handlePositions(scheme, mark, view)) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(handle.x, handle.y, handle.r, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(255, 255, 255, 0.95)";
    ctx.strokeStyle = tint;
    ctx.lineWidth = 1.5;
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    const arm = handle.r * 0.5;
    ctx.moveTo(handle.x - arm, handle.y);
    ctx.lineTo(handle.x + arm, handle.y);
    ctx.moveTo(handle.x, handle.y - arm);
    ctx.lineTo(handle.x, handle.y + arm);
    ctx.strokeStyle = tint;
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
  const x = box ? box.x : 12;
  const y = box ? box.y : 12;
  ctx.save();
  ctx.font = `${font}px system-ui, -apple-system, "Segoe UI", Arial, sans-serif`;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  // Ширина рамки — по самой длинной строке: код типа бывает и в шестнадцать
  // букв, а рамка фиксированной ширины оставляла «ПОДСВЕТКА — подсветка ниши»
  // лежать поверх плана. Шире предела легенда сама закрывает план, и строка
  // обрезается многоточием.
  const textX = font * LEGEND_TEXT_EM;
  const pad = font * 0.8;
  const texts = rows.map((row) => legendClip(ctx, `${row.code} — ${row.name}`, font * LEGEND_MAX_EM - textX - pad));
  const widest = texts.reduce((max, value) => Math.max(max, ctx.measureText(value).width), 0);
  const width = Math.max(font * LEGEND_MIN_EM, textX + widest + pad);
  const height = step * rows.length + font;
  ctx.fillStyle = "rgba(255, 255, 255, 0.92)";
  ctx.strokeStyle = "#d0d7de";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.rect(x, y, width, height);
  ctx.fill();
  ctx.stroke();
  rows.forEach((row, index) => {
    const lineY = y + font * 0.6 + step * (index + 0.5);
    drawShape(ctx, row.shape, x + font * 1.1, lineY, font * 0.55, row.color);
    ctx.fillStyle = "#1f2328";
    ctx.fillText(texts[index], x + textX, lineY);
  });
  ctx.restore();
}

// Весь кадр: план, метки, подписи, при надобности легенда. Тот же код и на
// экране, и в экспорте — меняется только масштаб во `view`.
export function drawScheme(ctx, {
  project,
  scheme,
  image,
  filter,
  view,
  legend,
  selectedIds,
  draft,
  draftColor,
  outlines,
  selectedOutlineId,
}) {
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
  // Контуры ложатся под метки: метка на стене комнаты должна остаться видна.
  if (outlines !== false && outlines !== null) {
    drawOutlines(ctx, { project, scheme, filter, view: state, mode: outlines, selectedOutlineId });
  }
  const selected = new Set(selectedIds || []);
  for (const mark of visibleMarks(project, scheme, filter)) {
    drawMarkBody(ctx, project, scheme, mark, state, selected.has(mark.id));
  }
  for (const target of labelTargets(project, scheme, filter)) {
    const lead = labelLead(project, target);
    drawLabel(ctx, labelBox(project, scheme, target, state), styleOf(project, lead && lead.typeId).color);
  }
  if (draft) drawDraft(ctx, scheme, draft, state, draftColor || "#0969da");
  if (legend) drawLegend(ctx, { project, scheme, filter, view: state, box: legend === true ? null : legend });
}

// Дверь для тестов — не для панелей: за ней внутренности drawScheme, которые
// снаружи вызывать незачем, но проверить нужно (геометрия, видимость, запас
// попадания). Панели и экспорт берут только именованные экспорты выше.
export const renderInternals = {
  shapeGeometry,
  outlineCenter,
  outlineTint,
  outlineLabelBox,
  shapeInternals,
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
