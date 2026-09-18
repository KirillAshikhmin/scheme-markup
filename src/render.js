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
import { text } from "./strings.js";

export const SHAPES = SHAPE_NAMES;

// Доля радиуса, на которую внутренние вершины звезды ближе к центру.
const STAR_INNER = 0.45;
// Запас в пикселях вокруг метки, чтобы попадать по ней не идеально точно.
const HIT_SLACK_PX = 4;
// Ширина буквы относительно кегля — оценка, одинаковая в тесте и на холсте.
// Доля кегля на знак в оценке ширины подписи. Мерить по-настоящему тут нечем:
// `labelBox` зовут и попадание по клику, и тесты, а холста у них нет. Значит,
// оценка берётся с запасом: 0,62 — про строчную латиницу, а коды заказчик
// пишет прописной кириллицей, которая шире примерно на шестую часть. Занижение
// стоит дважды: подпись у края плана не уезжает влево, когда пора, и клик по
// ней промахивается мимо прямоугольника.
const LABEL_CHAR_RATIO = 0.75;
// Насколько далеко от метки стоит подпись, если её не оттаскивали.
const LABEL_GAP = 1.5;
// Ручки «+» стоят от центра метки на столько её радиусов.
const HANDLE_GAP = 2.4;
const HANDLE_RADIUS = 9;

// Подсказка угла у курсора: кегль в экранных пикселях (это не часть плана, а
// подсказка руке), отступ от курсора и цвет для свободного направления.
const DRAFT_ANGLE_FONT = 12;
const DRAFT_ANGLE_GAP = 14;
const DRAFT_ANGLE_FREE = "#57606a";
// Короче этого отрезок ещё не направление, и градус у него случайный.
const DRAFT_ANGLE_MIN_PX = 8;

// Направляющая: мелкий пунктир в волос толщиной и вполсилы. Узор мельче любого
// начертания метки — на пунктирной линии подсказку иначе не отличить от самого
// черновика.
const GUIDE_DASH = [2, 5];
// Направляющая пользователя: тонкая сплошная, приглушённая. Взятая под руку —
// ярче: двенадцать штук на плане не должны спорить с самим планом.
const GUIDE_LINE = "rgba(9, 105, 218, 0.38)";
const GUIDE_LINE_ACTIVE = "rgba(9, 105, 218, 0.85)";
// Направляющая, утащенная обратно на линейку: гаснет и рвётся — её снимут.
const GUIDE_DROP_DASH = [3, 4];
const GUIDE_DROP_ALPHA = 0.45;
const GUIDE_WIDTH = 1;
const GUIDE_ALPHA = 0.5;

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

// Полуширина узкого прямоугольника в градусах от полюса окружности.
const RECT_VERTICAL_ANGLE = 18;

// Углы вершин, градусы от «вверх». Все фигуры вписаны в окружность радиуса size.
const SHAPE_ANGLES = {
  square: [-135, -45, 45, 135],
  triangle: [-90, 30, 150],
  "triangle-down": [90, 210, 330],
  diamond: [-90, 0, 90, 180],
  hexagon: [-90, -30, 30, 90, 150, 210],
  // Узкий прямоугольник стоймя: те же четыре вершины на окружности, но
  // разведённые к полюсам. Угол в 18° даёт ширину примерно в треть высоты —
  // в размере метки просвет между длинными сторонами ещё виден, а знак уже
  // читается полосой, а не квадратом.
  "rect-vertical": [-90 - RECT_VERTICAL_ANGLE, -90 + RECT_VERTICAL_ANGLE, 90 - RECT_VERTICAL_ANGLE, 90 + RECT_VERTICAL_ANGLE],
  // Тот же прямоугольник лёжа: настенный блок — кондиционер, корпус техники.
  "rect-horizontal": [-RECT_VERTICAL_ANGLE, RECT_VERTICAL_ANGLE, 180 - RECT_VERTICAL_ANGLE, 180 + RECT_VERTICAL_ANGLE],
};

// Трапеция раструбом вниз: зонт вытяжки, луч проектора. Доли радиуса —
// полуширина верха, полуширина низа и половина высоты.
const TRAPEZOID_TOP = 0.42;
const TRAPEZOID_BOTTOM = 0.98;
const TRAPEZOID_HEIGHT = 0.72;

// Капля: остриё вверху, круглое тело внизу. Тело — окружность доли радиуса,
// касательные к ней из острия сходятся в точку, поэтому знак читается каплей,
// а не кругом с шипом.
const DROP_BODY = 0.72;
const DROP_STEPS = 16;

// Полукруг плоской стороной вниз: бра на стене. Центр дуги опущен, чтобы
// пятно стояло в середине знака, а не висело в его верхней половине.
const DOME_BASE = 0.35;

// Родня фигур: контур берётся у базовой, а отличает их засечка внутри.
// Так «розетка» и «розетка двойная» различаются в 14 пикселях, а на плане
// по-прежнему рисуются одним `drawShape`.
const SHAPE_BASE = {
  "circle-cross": "circle",
  "circle-slash": "circle",
  "circle-slash-two": "circle",
  "circle-chevron": "circle",
  "circle-wave": "circle",
  "circle-ring": "circle",
  "circle-socket": "circle",
  "square-jack": "square",
  "square-bolt": "square",
  "square-split": "square",
  "square-hatch": "square",
  "square-bar": "square",
  "square-bar-two": "square",
  "square-chevron": "square",
  "square-wave": "square",
  "triangle-dot": "triangle",
  "triangle-down-fill": "triangle-down",
  "diamond-dot": "diamond",
  "diamond-cross": "diamond",
  "circle-dot": "circle",
  "circle-fill": "circle",
  "circle-half": "circle",
  "square-cross": "square",
  "square-fill": "square",
  "diamond-fill": "diamond",
  // Оборудование: те же контуры, новая засечка внутри.
  "circle-bolt": "circle",
  "circle-triple": "circle",
  "circle-antenna": "circle",
  "circle-valve": "circle",
  "circle-drain": "circle",
  "circle-thermo": "circle",
  "circle-fan": "circle",
  "circle-rays": "circle",
  "circle-bar": "circle",
  "dome-dot": "dome",
  "rect-vertical-ticks": "rect-vertical",
  "rect-horizontal-ticks": "rect-horizontal",
  "square-ring": "square",
  "square-grid": "square",
  "drop-dot": "drop",
  "diamond-ring": "diamond",
  "trapezoid-dot": "trapezoid",
  "trapezoid-bar": "trapezoid",
};

// Засечка внутри: перекрестье, точка, сплошная заливка, залитая нижняя половина.
const SHAPE_DECOR = {
  "circle-cross": "cross",
  "circle-slash": "slash",
  "circle-slash-two": "slash-two",
  "circle-chevron": "chevron",
  "circle-wave": "wave",
  "circle-ring": "ring",
  "circle-socket": "socket",
  "square-jack": "jack",
  "square-bolt": "bolt",
  "square-split": "split",
  "square-hatch": "hatch",
  "square-bar": "bar",
  "square-bar-two": "bar-two",
  "square-chevron": "chevron-square",
  "square-wave": "wave",
  "triangle-dot": "dot",
  "triangle-down-fill": "fill",
  "diamond-dot": "dot",
  "diamond-cross": "cross",
  "square-cross": "cross",
  "circle-dot": "dot",
  "circle-fill": "fill",
  "square-fill": "fill",
  "diamond-fill": "fill",
  "circle-half": "half",
  "circle-bolt": "bolt",
  "circle-triple": "triple",
  "circle-antenna": "antenna",
  "circle-valve": "valve",
  "circle-drain": "drain",
  "circle-thermo": "thermo",
  "circle-fan": "fan",
  "circle-rays": "rays",
  "circle-bar": "bar-flat",
  "dome-dot": "dot",
  "rect-vertical-ticks": "ticks-horizontal",
  "rect-horizontal-ticks": "ticks-vertical",
  "square-ring": "ring",
  "square-grid": "grid",
  "drop-dot": "dot",
  "diamond-ring": "ring",
  "trapezoid-dot": "dot",
  "trapezoid-bar": "bar-flat",
};

// Засечки оборудования в долях радиуса. Числа подобраны по отпечатку в размере
// метки: мельче — знак сливается с соседом по палитре, крупнее — упирается в
// контур.
// Три отверстия трёхфазной розетки: по кругу, чтобы не спорить с двумя
// отверстиями обычной.
const TRIPLE_REACH = 0.46;
const TRIPLE_DOT = 0.3;
// Антенна телевизионной розетки: мачта и два уса.
const ANTENNA_FORK = -0.26;
const ANTENNA_BOTTOM = 0.66;
const ANTENNA_ARM = 0.54;
const ANTENNA_LIFT = 0.5;
// Бабочка запорного крана: два треугольника, сходящиеся в центре.
const VALVE_REACH = 0.62;
const VALVE_HALF = 0.46;
// Сток канализации: мачта и стрелка вниз.
const DRAIN_TOP = -0.7;
const DRAIN_BOTTOM = 0.3;
const DRAIN_ARM = 0.6;
// Термометр: столбик и колба.
const THERMO_TOP = -0.62;
const THERMO_BOTTOM = 0.02;
const THERMO_BULB = 0.4;
// Лопасти вентилятора: три луча из центра.
const FAN_REACH = 0.72;
const FAN_ANGLES = [-90, 30, 150];
// Люстра: подвес и три рожка.
const RAYS_BAR = -0.34;
const RAYS_REACH = 0.58;
const RAYS_DROP = 0.42;
// Черта поперёк знака: база робота, сушка.
const BAR_FLAT_REACH = 0.72;
const BAR_FLAT_WIDTH = 2.4;
const BAR_FLAT_DROP = 0.34;
// Четыре кнопки сценарной панели.
const GRID_REACH = 0.36;
const GRID_DOT = 0.22;
// Две засечки поперёк узкого корпуса: решётка колонки, лоток медиацентра.
const TICKS_REACH = 0.56;
const TICKS_HALF = 0.3;
const TICKS_WIDTH = 1.9;

// Доля радиуса, на которую отступает от края «талия» плюса.
const PLUS_WAIST = 0.36;
// Точка внутри знака: меньше — сливается с пустым кругом на распечатке.
const DOT_RADIUS = 0.42;

// Штрих и просвет пунктирной линии в долях радиуса метки: короче — на бумаге
// пунктир сливается в сплошную, длиннее — линия рвётся на отдельные палки.
const DASH_STROKE = 1.7;
const DASH_GAP = 1.1;

export function dashPattern(radius) {
  return [Math.max(2, radius * DASH_STROKE), Math.max(2, radius * DASH_GAP)];
}

// ——— начертания линии ————————————————————————————————————————————————
//
// Начертание выбирают по изображению, а значит различать его должен глаз, и
// не на экране, а на чёрно-белой распечатке в толщине линии метки. Поэтому
// каждое начертание описано числами в долях радиуса метки — и растёт вместе с
// ней, как пунктир: на выгрузке в двойном разрешении штрих остаётся тем же,
// что на экране.
//
// Описание — одно на всю сборку: по нему рисует холст и по нему же снимает
// отпечаток `test/lineStyle.test.js`. Это тот же приём, что у фигур
// (`shapeInternals`): правила закраски записаны один раз, и тест проверяет
// ровно то, что увидит бумага.
//
//   dash  — узор пунктира в долях радиуса (null — сплошная нитка);
//   rails — поперечные смещения ниток: одна нитка по центру или две у двойной;
//   wave  — деформация нитки: синус или пила, амплитуда и период в радиусах;
//   pen   — толщина пера в долях радиуса.
const LINE_STYLE_PLANS = {
  solid: { dash: null },
  // Прежний пунктир не трогается ни на волос: объекты с ним уже нарисованы,
  // и узор берётся из того же `dashPattern`.
  dashed: { dash: [DASH_STROKE, DASH_GAP] },
  // Длинный штрих вдвое длиннее обычного — на бумаге это видно сразу.
  "long-dash": { dash: [3.6, 2.1] },
  // Точка — штрих нулевой длины: круглый торец пера рисует её сам.
  dotted: { dash: [0, 1.4] },
  "dash-dot": { dash: [2, 1.2, 0, 1.2] },
  "dash-dot-dot": { dash: [2, 1.1, 0, 1.1, 0, 1.1] },
  // Двойная: две тонкие нитки с просветом между ними.
  double: { dash: null, rails: [-0.5, 0.5], pen: 0.26 },
  // Волна и зигзаг разведены нарочно: волна редкая и высокая, зигзаг частый и
  // низкий. Сблизь их — и на бумаге останется одна мохнатая линия.
  wave: { dash: null, wave: { kind: "sine", amplitude: 1.05, period: 4.4 } },
  zigzag: { dash: null, wave: { kind: "zigzag", amplitude: 0.5, period: 1.5 } },
  // Жирная: та же сплошная, но перо почти вдвое толще. На бумаге она читается
  // как «главная» линия — ствол трассы, магистраль.
  bold: { dash: null, pen: 0.95 },
  // Змейка: прямоугольная волна — греющий контур, уложенный петлями. От пилы
  // её отличает ступень, от синусоиды — угол; на распечатке это три разных
  // рисунка, а не один мохнатый.
  meander: { dash: null, wave: { kind: "meander", amplitude: 1.0, period: 3.2 } },
};

// Толщина пера линейной метки: половина радиуса, но не тоньше двух пикселей —
// иначе на отдалении линия исчезает.
const LINE_PEN = 0.5;
const LINE_PEN_MIN = 2;
// У двойной нитки тоньше и минимум свой: две нитки по два пикселя с просветом
// в один слились бы в жирную полосу.
const LINE_PEN_MIN_THIN = 1.2;

/** Начертание в пикселях: узор, нитки и волна для метки радиуса `radius`. */
export function lineStylePlan(style, radius) {
  const base = LINE_STYLE_PLANS[style] || LINE_STYLE_PLANS.solid;
  const rails = base.rails || [0];
  const pen = Math.max(rails.length > 1 ? LINE_PEN_MIN_THIN : LINE_PEN_MIN, radius * (base.pen || LINE_PEN));
  return {
    // Пунктир считается тем же `dashPattern`, что и прежде: у «dashed» это
    // буквально он, у остальных — тот же пересчёт долей в пиксели.
    dash: base.dash ? base.dash.map((part) => (part === 0 ? 0 : Math.max(2, radius * part))) : null,
    rails: rails.map((offset) => offset * radius),
    wave: base.wave
      ? { kind: base.wave.kind, amplitude: base.wave.amplitude * radius, period: base.wave.period * radius }
      : null,
    pen,
  };
}

// Длина ломаной и точка на ней по пройденному пути — обе нужны и волне, и
// отпечатку, поэтому считаются один раз.
function pathLength(points, closed) {
  let total = 0;
  const last = closed ? points.length : points.length - 1;
  for (let index = 0; index < last; index += 1) {
    const from = points[index];
    const to = points[(index + 1) % points.length];
    total += Math.hypot(to.x - from.x, to.y - from.y);
  }
  return total;
}

// Точка на ломаной по пройденному пути плюс направление в ней: по направлению
// откладывается поперечное смещение нитки.
function pathAt(points, closed, distance) {
  let left = Math.max(0, distance);
  const last = closed ? points.length : points.length - 1;
  for (let index = 0; index < last; index += 1) {
    const from = points[index];
    const to = points[(index + 1) % points.length];
    const length = Math.hypot(to.x - from.x, to.y - from.y);
    if (length === 0) continue;
    if (left <= length || index === last - 1) {
      const t = length === 0 ? 0 : left / length;
      return {
        x: from.x + (to.x - from.x) * t,
        y: from.y + (to.y - from.y) * t,
        nx: -(to.y - from.y) / length,
        ny: (to.x - from.x) / length,
      };
    }
    left -= length;
  }
  const only = points[0];
  return { x: only.x, y: only.y, nx: 0, ny: 1 };
}

// Сколько проб на период волнистой линии: реже — и синус превращается в ломаную.
const LINE_WAVE_STEPS = 12;

/**
 * Нитки начертания: по каждой холст ведёт перо одним `stroke`. Волна и зигзаг
 * — не узор пера, а деформация самой нитки, поэтому считаются здесь, а не
 * в `setLineDash`. Период подгоняется под длину линии целым числом волн:
 * иначе линия обрывалась бы на полугорбе, и две одинаковые метки выглядели бы
 * по-разному только оттого, что одну провели на пиксель длиннее.
 */
export function lineStyleThreads(points, closed, plan) {
  const list = (points || []).filter(Boolean);
  if (list.length < 2) return [];
  const spine = plan && plan.wave ? waveSpine(list, closed, plan.wave) : list;
  const rails = (plan && plan.rails) || [0];
  if (rails.length === 1 && rails[0] === 0) return [spine];
  return rails.map((offset) => railOf(spine, closed, offset));
}

function waveSpine(points, closed, wave) {
  const total = pathLength(points, closed);
  if (total <= 0 || wave.period <= 0) return points;
  const waves = Math.max(1, Math.round(total / wave.period));
  if (wave.kind === "meander") {
    // Прямоугольная волна: петля греющего контура. Каждый полупериод ведётся
    // отдельным отрезком на своём уровне, а между ними перо идёт поперёк —
    // отсюда ступень вместо пилы.
    const steps = waves * 2;
    const spine = [];
    for (let index = 0; index < steps; index += 1) {
      const level = (index % 2 === 0 ? 1 : -1) * wave.amplitude;
      const from = pathAt(points, closed, (total * index) / steps);
      const to = pathAt(points, closed, (total * (index + 1)) / steps);
      spine.push({ x: from.x + from.nx * level, y: from.y + from.ny * level });
      spine.push({ x: to.x + to.nx * level, y: to.y + to.ny * level });
    }
    return spine;
  }
  const period = total / waves;
  // У зигзага пробы стоят ровно в вершинах пилы — иначе углы срезаются.
  const steps = wave.kind === "zigzag" ? waves * 2 : waves * LINE_WAVE_STEPS;
  const spine = [];
  for (let index = 0; index <= steps; index += 1) {
    const distance = (total * index) / steps;
    const at = pathAt(points, closed, distance);
    const phase = (distance / period) * Math.PI * 2;
    const shift =
      wave.kind === "zigzag"
        ? wave.amplitude * (index % 2 === 0 ? 0 : 1) * (Math.floor(index / 2) % 2 === 0 ? 1 : -1)
        : wave.amplitude * Math.sin(phase);
    spine.push({ x: at.x + at.nx * shift, y: at.y + at.ny * shift });
  }
  return spine;
}

// Нитка, сдвинутая поперёк на `offset`: вершина двигается по усреднённой
// нормали соседних отрезков, поэтому на изломе нитки не расходятся.
function railOf(points, closed, offset) {
  if (offset === 0) return points;
  const normals = [];
  const last = closed ? points.length : points.length - 1;
  for (let index = 0; index < last; index += 1) {
    const from = points[index];
    const to = points[(index + 1) % points.length];
    const length = Math.hypot(to.x - from.x, to.y - from.y) || 1;
    normals.push({ nx: -(to.y - from.y) / length, ny: (to.x - from.x) / length });
  }
  return points.map((point, index) => {
    const before = normals[(index - 1 + normals.length) % normals.length];
    const after = normals[Math.min(index, normals.length - 1)];
    const first = index === 0 && !closed ? after : before;
    const nx = (first.nx + after.nx) / 2;
    const ny = (first.ny + after.ny) / 2;
    const length = Math.hypot(nx, ny) || 1;
    return { x: point.x + (nx / length) * offset, y: point.y + (ny / length) * offset };
  });
}

// Линейная метка и её черновик рисуются одним кодом: начертание на плане, в
// PNG и на распечатке обязано быть одним и тем же.
function strokeStyledLine(ctx, points, closed, style, radius, color) {
  const plan = lineStylePlan(style, radius);
  const threads = lineStyleThreads(points, closed, plan);
  if (threads.length === 0) return;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = plan.pen;
  // Пунктир задан в пикселях плана и растёт с масштабом вместе с меткой:
  // на выгрузке в двойном разрешении штрих остаётся тем же, что на экране.
  if (plan.dash) ctx.setLineDash(plan.dash);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (const thread of threads) {
    ctx.beginPath();
    thread.forEach((point, index) => (index === 0 ? ctx.moveTo(point.x, point.y) : ctx.lineTo(point.x, point.y)));
    // Волна замыкается сама: её последняя проба совпала с первой, поэтому
    // замыкание здесь ничего не дорисовывает, а у прямой нитки — дорисовывает.
    if (closed) ctx.closePath();
    ctx.stroke();
  }
  ctx.setLineDash([]);
  ctx.restore();
}

/**
 * Образец начертания для сетки выбора и строки справочника: тот же код, что
 * рисует линию на плане, на маленьком холсте. Одна функция на весь интерфейс —
 * в справочнике видно ровно то, что попадёт на план.
 */
export function lineStyleIcon(style, color, size = 22, length = size * 3) {
  const canvas = document.createElement("canvas");
  canvas.className = "line-icon";
  canvas.width = length;
  canvas.height = size;
  const ctx = canvas.getContext ? canvas.getContext("2d") : null;
  if (!ctx) return canvas;
  const radius = size * 0.34;
  const pad = Math.max(3, radius * 0.6);
  strokeStyledLine(
    ctx,
    [
      { x: pad, y: size / 2 },
      { x: length - pad, y: size / 2 },
    ],
    false,
    style,
    radius,
    color,
  );
  return canvas;
}

// Узнаваемые значки собраны из тех же кирпичей, что и старые засечки: отрезки,
// круг, прямоугольник. Ни шрифтов, ни эмодзи — знак обязан выглядеть одинаково
// на экране, в PNG и на распечатке, а чужой шрифт этого не обещает.
// Числа подобраны под настоящий размер метки (радиус около пяти пикселей на
// бумаге): в этом размере их и различает отпечаток из test/shapes.test.js.
// Клавиша выключателя: наклонный рычаг во весь знак. Короче — и на бумаге
// он перестаёт отличаться от пустого круга: отпечаток считает это слиянием.
const LEVER_REACH = 1;
// Наклон рычага, градусы от горизонтали.
const LEVER_ANGLE = 70;
// Две клавиши: два рычага короче, разведённые поперёк на столько радиусов.
const LEVER_PAIR_GAP = 0.34;
const LEVER_PAIR_REACH = 0.62;
// Переключатель: уголок, раскрытый вправо.
const CHEVRON_REACH = 0.62;
// Тот же уголок внутри квадрата. Числа свои и заданы в долях полустороны
// (r/√2), а не радиуса: в квадрате места меньше, чем в круге, и уголок круга
// упирался бы концами прямо в углы квадрата. Уголок квадрата короче, толще и
// с просветом до края — на бумаге он читается знаком внутри рамки, а не
// заливкой, которая срослась с контуром.
const SQUARE_CHEVRON_BACK_X = 0.6;
const SQUARE_CHEVRON_TIP_X = 0.62;
const SQUARE_CHEVRON_REACH_Y = 0.64;
const SQUARE_CHEVRON_WIDTH = 1.45;
// Беспроводная точка: волны над точкой у нижнего края знака.
const WAVE_BASE = 0.5;
const WAVE_RADII = [0.5, 0.92];
const WAVE_FROM = 205;
const WAVE_TO = 335;
const WAVE_STEPS = 5;
// Кольцо внутри знака: доля радиуса, на которой оно идёт.
const RING_SHARE = 0.55;
const RING_POINTS = 12;
// Молния: полуразмах и полувысота в долях радиуса.
const BOLT_WIDE = 0.72;
const BOLT_TALL = 0.82;
// Пара контактов: полудлина черты и просвет между ними в долях радиуса.
const SPLIT_REACH = 0.62;
const SPLIT_GAP = 0.22;
// Штриховка: полудлина черты и её ряды в долях радиуса.
const HATCH_REACH = 0.46;
const HATCH_ROWS = [-0.3, 0, 0.3];
// Клавиши выключателя: вертикальные черты, делящие квадрат. Одна черта — две
// клавиши, две черты — три; так выключатель и выглядит в жизни. Черта идёт от
// края до края квадрата (полусторона — r/√2) и толще обычной засечки: в
// размере метки тонкая короткая черта добавляет к пустому квадрату меньше
// краски, чем нужно отпечатку, чтобы счесть знаки разными.
const BAR_REACH = Math.SQRT1_2;
const BAR_WIDTH = 1.6;
// Пара клавиш рисуется тоньше одиночной: двум толстым чертам в размере метки
// не остаётся просветов, и квадрат с двумя чертами сливается в полосатое пятно,
// неотличимое от квадрата с одной. Краски у пары и так вдвое больше, поэтому
// тонкая черта отпечатку не мешает — на распечатке знаки расходятся.
const BAR_TWO_WIDTH = 1.0;
// Евророзетка: два контактных отверстия по сторонам от центра.
const SOCKET_GAP = 0.46;
const SOCKET_DOT = 0.3;
// Разъём Ethernet: корпус вилки и шнур вниз.
const JACK_WIDTH = 0.52;
const JACK_TOP = -0.55;
const JACK_HEIGHT = 0.75;

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
  if (base === "drop") {
    // Остриё вверху и круглое тело внизу: касательные из острия к телу сходятся
    // в точку, поэтому знак читается каплей, а не кругом с шипом.
    const body = radius * DROP_BODY;
    const center = { x, y: y + radius - body };
    const apex = { x, y: y - radius };
    const reach = center.y - apex.y;
    const touch = (Math.asin(Math.min(1, body / reach)) * 180) / Math.PI;
    const from = -90 + (90 - touch);
    const to = from + (360 - 2 * (90 - touch));
    const points = [apex];
    for (let step = 0; step <= DROP_STEPS; step += 1) {
      points.push(polarPoint(center.x, center.y, body, from + ((to - from) * step) / DROP_STEPS));
    }
    return { kind: "polygon", points, ...shell };
  }
  if (base === "dome") {
    // Полукруг плоской стороной вниз: бра на стене.
    const base_y = y + radius * DOME_BASE;
    const points = [];
    for (let step = 0; step <= DROP_STEPS; step += 1) {
      points.push(polarPoint(x, base_y, radius, 180 + (180 * step) / DROP_STEPS));
    }
    return { kind: "polygon", points, ...shell };
  }
  if (base === "trapezoid") {
    const top = radius * TRAPEZOID_TOP;
    const bottom = radius * TRAPEZOID_BOTTOM;
    const half = radius * TRAPEZOID_HEIGHT;
    return {
      kind: "polygon",
      points: [
        { x: x - top, y: y - half },
        { x: x + top, y: y - half },
        { x: x + bottom, y: y + half },
        { x: x - bottom, y: y + half },
      ],
      ...shell,
    };
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
// Кольцо ломаной: настоящей дуги в описании начинки нет, а отрезков хватает —
// на бумаге в размере метки двенадцать звеньев читаются кругом.
function ringSegments(geometry, share) {
  const radius = geometry.r * share;
  const segments = [];
  let previous = polarPoint(geometry.cx, geometry.cy, radius, 0);
  for (let step = 1; step <= RING_POINTS; step += 1) {
    const next = polarPoint(geometry.cx, geometry.cy, radius, (360 * step) / RING_POINTS);
    segments.push([previous, next]);
    previous = next;
  }
  return segments;
}

// Отрезок рычага: длина в долях радиуса, сдвиг поперёк. Наклон намеренно не
// сорок пять градусов — под ним рычаг ложится на луч креста, и на бумаге
// «круг с клавишей» перестаёт отличаться от «круга с крестом».
function leverSegment(geometry, reach, shift) {
  const angle = (LEVER_ANGLE * Math.PI) / 180;
  const along = { x: Math.cos(angle), y: -Math.sin(angle) };
  const across = { x: -along.y, y: along.x };
  const cx = geometry.cx + across.x * geometry.r * shift;
  const cy = geometry.cy + across.y * geometry.r * shift;
  const reachPx = geometry.r * reach;
  return [
    { x: cx - along.x * reachPx, y: cy - along.y * reachPx },
    { x: cx + along.x * reachPx, y: cy + along.y * reachPx },
  ];
}

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
  if (geometry.decor === "slash" || geometry.decor === "slash-two") {
    // Клавиша выключателя: наклонный рычаг. Две клавиши — два рычага рядом,
    // и на бумаге видно, одна их или две, без чтения буквы.
    const segments =
      geometry.decor === "slash"
        ? [leverSegment(geometry, LEVER_REACH, 0)]
        : [
            leverSegment(geometry, LEVER_PAIR_REACH, -LEVER_PAIR_GAP),
            leverSegment(geometry, LEVER_PAIR_REACH, LEVER_PAIR_GAP),
          ];
    parts.push({ role: geometry.decor, mask: "lines", width: geometry.line, segments });
  } else if (geometry.decor === "chevron") {
    // Переключатель: свет из двух мест, и знак показывает две стороны.
    const reach = geometry.r * CHEVRON_REACH;
    parts.push({
      role: "chevron",
      mask: "lines",
      width: geometry.line,
      segments: [
        [
          { x: geometry.cx - reach, y: geometry.cy - reach },
          { x: geometry.cx + reach, y: geometry.cy },
        ],
        [
          { x: geometry.cx + reach, y: geometry.cy },
          { x: geometry.cx - reach, y: geometry.cy + reach },
        ],
      ],
    });
  } else if (geometry.decor === "chevron-square") {
    // Тот же переключатель, вписанный в квадрат: уголок на две стороны.
    const half = geometry.r * Math.SQRT1_2;
    const back = half * SQUARE_CHEVRON_BACK_X;
    const tip = half * SQUARE_CHEVRON_TIP_X;
    const reach = half * SQUARE_CHEVRON_REACH_Y;
    parts.push({
      role: "chevron-square",
      mask: "lines",
      width: geometry.line * SQUARE_CHEVRON_WIDTH,
      segments: [
        [
          { x: geometry.cx - back, y: geometry.cy - reach },
          { x: geometry.cx + tip, y: geometry.cy },
        ],
        [
          { x: geometry.cx + tip, y: geometry.cy },
          { x: geometry.cx - back, y: geometry.cy + reach },
        ],
      ],
    });
  } else if (geometry.decor === "wave") {
    // Беспроводная точка: точка у нижнего края и волны над ней.
    const base = { x: geometry.cx, y: geometry.cy + geometry.r * WAVE_BASE };
    const segments = [];
    for (const share of WAVE_RADII) {
      const radius = geometry.r * share;
      let previous = polarPoint(base.x, base.y, radius, WAVE_FROM);
      for (let step = 1; step <= WAVE_STEPS; step += 1) {
        const angle = WAVE_FROM + ((WAVE_TO - WAVE_FROM) * step) / WAVE_STEPS;
        const next = polarPoint(base.x, base.y, radius, angle);
        segments.push([previous, next]);
        previous = next;
      }
    }
    parts.push({ role: "wave", mask: "lines", width: geometry.line, segments });
    parts.push({ role: "wave-dot", mask: "disc", cx: base.x, cy: base.y, r: Math.max(1, geometry.r * 0.22) });
  } else if (geometry.decor === "ring") {
    // Кольцо внутри круга: потолочный датчик — дыма, движения, присутствия.
    parts.push({ role: "ring", mask: "lines", width: geometry.line, segments: ringSegments(geometry, RING_SHARE) });
  } else if (geometry.decor === "bolt") {
    // Молния: силовая линия, автомат, вывод под мощную нагрузку.
    const wide = geometry.r * BOLT_WIDE;
    const tall = geometry.r * BOLT_TALL;
    parts.push({
      role: "bolt",
      mask: "lines",
      width: geometry.line,
      segments: [
        [
          { x: geometry.cx + wide, y: geometry.cy - tall },
          { x: geometry.cx - wide * 0.55, y: geometry.cy },
        ],
        [
          { x: geometry.cx - wide * 0.55, y: geometry.cy },
          { x: geometry.cx + wide * 0.55, y: geometry.cy },
        ],
        [
          { x: geometry.cx + wide * 0.55, y: geometry.cy },
          { x: geometry.cx - wide, y: geometry.cy + tall },
        ],
      ],
    });
  } else if (geometry.decor === "split") {
    // Знак разделён надвое: пара контактов — датчик открытия, геркон.
    const reach = geometry.r * SPLIT_REACH;
    const gap = geometry.r * SPLIT_GAP;
    parts.push({
      role: "split",
      mask: "lines",
      width: geometry.line,
      segments: [
        [
          { x: geometry.cx - reach, y: geometry.cy - gap },
          { x: geometry.cx + reach, y: geometry.cy - gap },
        ],
        [
          { x: geometry.cx - reach, y: geometry.cy + gap },
          { x: geometry.cx + reach, y: geometry.cy + gap },
        ],
      ],
    });
  } else if (geometry.decor === "bar" || geometry.decor === "bar-two") {
    // Клавиши выключателя: черта делит квадрат пополам, две черты — на три
    // равные части. Ровно так их и видят на стене, поэтому знак читается без
    // буквы рядом.
    const reach = geometry.r * BAR_REACH;
    const width = geometry.line * (geometry.decor === "bar" ? BAR_WIDTH : BAR_TWO_WIDTH);
    // Две черты делят квадрат на три равные части — равные по просвету, а не по
    // расстоянию между осями черт: считать от осей значило бы оставить средний
    // просвет уже крайних, а именно он и схлопывается первым.
    const third = (reach + width / 2) / 3;
    const offsets = geometry.decor === "bar" ? [0] : [-third, third];
    parts.push({
      role: geometry.decor,
      mask: "lines",
      width,
      segments: offsets.map((offset) => [
        { x: geometry.cx + offset, y: geometry.cy - reach },
        { x: geometry.cx + offset, y: geometry.cy + reach },
      ]),
    });
  } else if (geometry.decor === "socket") {
    // Евророзетка: два отверстия под контакты. Знак узнают по ним, а не по
    // букве рядом.
    const gap = geometry.r * SOCKET_GAP;
    const dot = Math.max(1, geometry.r * SOCKET_DOT);
    parts.push({ role: "socket", mask: "disc", cx: geometry.cx - gap, cy: geometry.cy, r: dot });
    parts.push({ role: "socket", mask: "disc", cx: geometry.cx + gap, cy: geometry.cy, r: dot });
  } else if (geometry.decor === "hatch") {
    // Штриховка: греющая площадь — тёплый пол, обогрев.
    const reach = geometry.r * HATCH_REACH;
    const segments = [];
    for (const share of HATCH_ROWS) {
      const y = geometry.cy + geometry.r * share;
      segments.push([
        { x: geometry.cx - reach, y },
        { x: geometry.cx + reach, y },
      ]);
    }
    parts.push({ role: "hatch", mask: "lines", width: geometry.line, segments });
  } else if (geometry.decor === "jack") {
    // Разъём: корпус вилки и шнур вниз — знак сетевой розетки.
    parts.push({
      role: "jack",
      mask: "rect",
      x: geometry.cx - geometry.r * JACK_WIDTH,
      y: geometry.cy + geometry.r * JACK_TOP,
      width: geometry.r * JACK_WIDTH * 2,
      height: geometry.r * JACK_HEIGHT,
    });
    parts.push({
      role: "jack-cord",
      mask: "lines",
      width: geometry.line,
      segments: [
        [
          { x: geometry.cx, y: geometry.cy + geometry.r * (JACK_TOP + JACK_HEIGHT) },
          { x: geometry.cx, y: geometry.cy + geometry.r * 0.72 },
        ],
      ],
    });
  } else if (geometry.decor === "triple") {
    // Трёхфазная розетка: три отверстия по кругу. Обычная евророзетка — два в
    // ряд, и на бумаге эти знаки не спутать.
    const reach = geometry.r * TRIPLE_REACH;
    const dot = Math.max(1, geometry.r * TRIPLE_DOT);
    for (const angle of [-90, 30, 150]) {
      const at = polarPoint(geometry.cx, geometry.cy, reach, angle);
      parts.push({ role: "triple", mask: "disc", cx: at.x, cy: at.y, r: dot });
    }
  } else if (geometry.decor === "antenna") {
    // Телевизионная розетка: мачта с усами.
    // Вилка усов смотрит вверх — так рисуют антенну. Вниз она читалась бы
    // стрелкой и спорила бы со стоком.
    const fork = geometry.cy + geometry.r * ANTENNA_FORK;
    const arm = geometry.r * ANTENNA_ARM;
    const lift = geometry.r * ANTENNA_LIFT;
    parts.push({
      role: "antenna",
      mask: "lines",
      width: geometry.line,
      segments: [
        [
          { x: geometry.cx, y: geometry.cy + geometry.r * ANTENNA_BOTTOM },
          { x: geometry.cx, y: fork },
        ],
        [
          { x: geometry.cx, y: fork },
          { x: geometry.cx - arm, y: fork - lift },
        ],
        [
          { x: geometry.cx, y: fork },
          { x: geometry.cx + arm, y: fork - lift },
        ],
      ],
    });
  } else if (geometry.decor === "valve") {
    // Бабочка запорного крана: два треугольника, сошедшиеся в центре.
    const reach = geometry.r * VALVE_REACH;
    const half = geometry.r * VALVE_HALF;
    parts.push({
      role: "valve",
      mask: "lines",
      width: geometry.line,
      segments: [
        [
          { x: geometry.cx - reach, y: geometry.cy - half },
          { x: geometry.cx - reach, y: geometry.cy + half },
        ],
        [
          { x: geometry.cx - reach, y: geometry.cy - half },
          { x: geometry.cx + reach, y: geometry.cy + half },
        ],
        [
          { x: geometry.cx - reach, y: geometry.cy + half },
          { x: geometry.cx + reach, y: geometry.cy - half },
        ],
        [
          { x: geometry.cx + reach, y: geometry.cy - half },
          { x: geometry.cx + reach, y: geometry.cy + half },
        ],
      ],
    });
  } else if (geometry.decor === "drain") {
    // Сток канализации: мачта со стрелкой вниз.
    const bottom = geometry.cy + geometry.r * DRAIN_BOTTOM;
    const arm = geometry.r * DRAIN_ARM;
    parts.push({
      role: "drain",
      mask: "lines",
      width: geometry.line,
      segments: [
        [
          { x: geometry.cx, y: geometry.cy + geometry.r * DRAIN_TOP },
          { x: geometry.cx, y: bottom },
        ],
        [
          { x: geometry.cx - arm, y: bottom - arm },
          { x: geometry.cx, y: bottom },
        ],
        [
          { x: geometry.cx + arm, y: bottom - arm },
          { x: geometry.cx, y: bottom },
        ],
      ],
    });
  } else if (geometry.decor === "thermo") {
    // Термометр: столбик и колба.
    parts.push({
      role: "thermo",
      mask: "lines",
      width: geometry.line,
      segments: [
        [
          { x: geometry.cx, y: geometry.cy + geometry.r * THERMO_TOP },
          { x: geometry.cx, y: geometry.cy + geometry.r * THERMO_BOTTOM },
        ],
      ],
    });
    parts.push({
      role: "thermo-bulb",
      mask: "disc",
      cx: geometry.cx,
      cy: geometry.cy + geometry.r * (THERMO_BOTTOM + THERMO_BULB * 0.7),
      r: Math.max(1, geometry.r * THERMO_BULB),
    });
  } else if (geometry.decor === "fan") {
    // Три лопасти из центра: вентилятор.
    const reach = geometry.r * FAN_REACH;
    parts.push({
      role: "fan",
      mask: "lines",
      width: geometry.line,
      segments: FAN_ANGLES.map((angle) => [
        { x: geometry.cx, y: geometry.cy },
        polarPoint(geometry.cx, geometry.cy, reach, angle),
      ]),
    });
  } else if (geometry.decor === "rays") {
    // Люстра: подвес и три рожка вниз.
    const bar = geometry.cy + geometry.r * RAYS_BAR;
    const reach = geometry.r * RAYS_REACH;
    const drop = geometry.cy + geometry.r * RAYS_DROP;
    parts.push({
      role: "rays",
      mask: "lines",
      width: geometry.line,
      segments: [
        [
          { x: geometry.cx - reach, y: bar },
          { x: geometry.cx + reach, y: bar },
        ],
        [
          { x: geometry.cx - reach, y: bar },
          { x: geometry.cx - reach, y: drop },
        ],
        [
          { x: geometry.cx, y: bar },
          { x: geometry.cx, y: drop },
        ],
        [
          { x: geometry.cx + reach, y: bar },
          { x: geometry.cx + reach, y: drop },
        ],
      ],
    });
  } else if (geometry.decor === "bar-flat") {
    // Черта поперёк знака: база робота-пылесоса, сушка.
    const reach = geometry.r * BAR_FLAT_REACH;
    parts.push({
      role: "bar-flat",
      mask: "lines",
      width: geometry.line * BAR_FLAT_WIDTH,
      segments: [
        [
          { x: geometry.cx - reach, y: geometry.cy + geometry.r * BAR_FLAT_DROP },
          { x: geometry.cx + reach, y: geometry.cy + geometry.r * BAR_FLAT_DROP },
        ],
      ],
    });
  } else if (geometry.decor === "ticks-vertical" || geometry.decor === "ticks-horizontal") {
    // Две засечки поперёк узкого корпуса: решётка колонки, лоток медиацентра.
    // Идут поперёк длинной стороны, поэтому засечка у лежачего корпуса стоит
    // стоймя, а у стоячего — лёжа.
    const reach = geometry.r * TICKS_REACH;
    const half = geometry.r * TICKS_HALF;
    const upright = geometry.decor === "ticks-vertical";
    parts.push({
      role: geometry.decor,
      mask: "lines",
      width: geometry.line * TICKS_WIDTH,
      segments: [-reach, 0, reach].map((offset) =>
        upright
          ? [
              { x: geometry.cx + offset, y: geometry.cy - half },
              { x: geometry.cx + offset, y: geometry.cy + half },
            ]
          : [
              { x: geometry.cx - half, y: geometry.cy + offset },
              { x: geometry.cx + half, y: geometry.cy + offset },
            ],
      ),
    });
  } else if (geometry.decor === "grid") {
    // Четыре кнопки сценарной панели.
    const reach = geometry.r * GRID_REACH;
    const dot = Math.max(1, geometry.r * GRID_DOT);
    for (const dx of [-reach, reach]) {
      for (const dy of [-reach, reach]) {
        parts.push({ role: "grid", mask: "disc", cx: geometry.cx + dx, cy: geometry.cy + dy, r: dot });
      }
    }
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

// ——— магнит направления и направляющие ————————————————————————————————
//
// Линиями рисуют ленту по периметру комнаты и треки, контурами — сами комнаты.
// Стены в квартире прямые, и от руки инженер каждый раз промахивается мимо
// горизонтали на пару градусов — на распечатке это видно. Магнит дотягивает
// почти ровное направление до ровного.
//
// Ровных направлений двенадцать пар: шаг 15°. Горизонталь и вертикаль — только
// часть работы, скосы в квартире идут через 45°, а эркер — через 15°, и
// рисовать их от руки так же неточно, как горизонталь. Порог — 4°: промах «на
// пару градусов» он забирает, а между соседними ровными направлениями остаётся
// 7° свободной руки, так что поставить отрезок мимо сетки по-прежнему можно.
// Совсем косые стены рисуются при снятом магните — это `free`, холст поднимает
// его с зажатого Alt.

// Шаг сетки ровных направлений, градусы.
export const SNAP_STEP_DEG = 15;

// Порог притяжения к ровному направлению, градусы.
export const SNAP_ANGLE_DEG = 4;

// Разброс, в пределах которого угол считается ровно ровным: проекция попадает
// в него с точностью плавающей арифметики, а не буква в букву.
const SNAP_ROUND_EPS = 0.01;

// Направляющая ловит курсор в этом радиусе — в пикселях экрана, а не в долях
// плана: иначе на разном масштабе притяжка вела бы себя по-разному.
export const GUIDE_SNAP_PX = 7;

// Угол направления в градусах: 0 — вправо, 90 — вверх, дальше против часовой.
// Экранный `y` растёт вниз, поэтому знак вертикали переворачивается здесь один
// раз — тот же угол читает и подсказка у курсора.
function segmentAngle(dx, dy) {
  const degrees = (Math.atan2(-dy, dx) * 180) / Math.PI;
  return (degrees + 360) % 360;
}

// Ровный ли это угол — с точностью до плавающей ошибки.
function roundAngle(angle) {
  const step = Math.abs(angle - Math.round(angle / SNAP_STEP_DEG) * SNAP_STEP_DEG);
  return step < SNAP_ROUND_EPS || Math.abs(step - SNAP_STEP_DEG) < SNAP_ROUND_EPS;
}

// Ортогональная проекция курсора на луч заданного направления, в пикселях
// плана. Притяжение — это проекция, а не поворот с сохранением длины: поворот
// увёл бы конец отрезка из-под руки.
function rayProject(from, to, scheme, degrees) {
  const straight = ((degrees % 360) + 360) % 360;
  // Горизонталь и вертикаль считаются присваиванием: та же проекция, но без
  // плавающей ошибки — продольная координата остаётся ровно под курсором.
  if (straight % 180 === 0) return { x: to.x, y: from.y };
  if (straight % 180 === 90) return { x: from.x, y: to.y };
  const width = schemeWidth(scheme);
  const height = schemeHeight(scheme);
  const radians = (straight * Math.PI) / 180;
  const ux = Math.cos(radians);
  const uy = -Math.sin(radians);
  const along = (to.x - from.x) * width * ux + (to.y - from.y) * height * uy;
  return { x: from.x + (along * ux) / width, y: from.y + (along * uy) / height };
}

// Направление отрезка `from → to` и точка, притянутая к ровному направлению.
// Считается в пикселях плана: план бывает 1000×500, доли по осям стоят там
// разных пикселей, и угол по долям — не тот угол, который видит инженер.
// `options.free` — магнит снят; `options.limit` — свой порог.
export function snapSegment(from, to, scheme, options = {}) {
  const dx = (to.x - from.x) * schemeWidth(scheme);
  const dy = (to.y - from.y) * schemeHeight(scheme);
  if (dx === 0 && dy === 0) return { point: to, angle: 0, snapped: false };
  const angle = segmentAngle(dx, dy);
  const limit = options.limit === undefined ? SNAP_ANGLE_DEG : options.limit;
  if (options.free || !(limit > 0)) return { point: to, angle, snapped: false };
  const straight = Math.round(angle / SNAP_STEP_DEG) * SNAP_STEP_DEG;
  if (Math.abs(angle - straight) > limit) return { point: to, angle, snapped: false };
  return { point: rayProject(from, to, scheme, straight), angle: straight % 360, snapped: true };
}

/**
 * Направляющие: пока ломаная рисуется, курсор ловится вершинами, которые в ней
 * уже стоят. Ровно под прежней вершиной — значит через неё идёт направляющая, и
 * точка садится на неё. Этим замыкают квадрат (направляющая от первой вершины) и
 * ровняют верхи зигзага (направляющие от вершин прежних зубцов).
 *
 * Источник вершин — только текущая ломаная: на плане с сотней меток притяжка к
 * чужим точкам превратилась бы в кашу. Последняя вершина в источники не входит —
 * горизонталь и вертикаль от неё держит магнит направления, и вторая подсказка
 * о том же только мигала бы под рукой в миг постановки точки.
 *
 * Направляющих не больше двух: ближайшая горизонтальная и ближайшая
 * вертикальная. Возвращается `{point, guides}`, где `guides` — `{axis, at}`:
 * `h` — горизонтальная через вершину `at`, `v` — вертикальная.
 */
export function draftGuides(points, cursor, scheme, view, options = {}) {
  const limit = options.guide === undefined ? GUIDE_SNAP_PX : options.guide;
  const sources = Array.isArray(points) ? points.slice(0, -1) : [];
  if (!(limit > 0) || sources.length === 0) return { point: cursor, guides: [] };
  const state = renderView(view);
  const at = planToScreen(cursor, scheme, state);
  let horizontal = null;
  let vertical = null;
  for (const vertex of sources) {
    const screen = planToScreen(vertex, scheme, state);
    const gapY = Math.abs(screen.y - at.y);
    if (gapY <= limit && (!horizontal || gapY < horizontal.gap)) horizontal = { gap: gapY, at: vertex };
    const gapX = Math.abs(screen.x - at.x);
    if (gapX <= limit && (!vertical || gapX < vertical.gap)) vertical = { gap: gapX, at: vertex };
  }
  const guides = [];
  const point = { x: cursor.x, y: cursor.y };
  if (horizontal) {
    point.y = horizontal.at.y;
    guides.push({ axis: "h", at: horizontal.at });
  }
  if (vertical) {
    point.x = vertical.at.x;
    guides.push({ axis: "v", at: vertical.at });
  }
  return { point, guides };
}

/**
 * Куда сядет следующая вершина ломаной: свои направляющие, направляющие по
 * вершинам и магнит направления. Одна дверь и для предпросмотра, и для клика —
 * разойтись им негде. `points` — уже поставленные вершины, `cursor` — точка под
 * курсором в долях плана. `options.free` снимает всё разом, `options.planGuides`
 * — направляющие схемы, которые пользователь поставил с линейки.
 *
 * **Порядок разрешения споров — один на всю сборку: занятую ось не двигает
 * никто, а старшинство идёт сверху вниз.**
 *
 *   1. Направляющие пользователя — он поставил их руками, это точное намерение.
 *   2. Направляющие по вершинам текущей ломаной — подсказка программы.
 *   3. Угол кратно 15° — самое приблизительное из трёх.
 *
 * Угол при этом применяется целиком или молчит: сдвинуть точку с пунктира,
 * который пользователь перед собой видит, он не может.
 *
 * `snapped` — итоговое направление ровное. Считается по готовой точке, а не по
 * тому, кто её подвинул: квадрат, замкнутый направляющей, стоит ровно на 180°,
 * и подсказка у курсора обязана это сказать.
 */
export function draftSnap(points, cursor, scheme, view, options = {}) {
  const from = Array.isArray(points) && points.length > 0 ? points[points.length - 1] : null;
  if (options.free) {
    const angle = from ? snapSegment(from, cursor, scheme, { free: true }).angle : 0;
    return { point: cursor, angle, snapped: false, guides: [], held: { h: null, v: null } };
  }
  // 1. Своя направляющая старше всех: она уже нарисована на плане.
  const own = snapToSchemeGuides(options.planGuides, cursor, scheme, view, options);
  let point = own.point;
  const heldX = Boolean(own.held.v);
  const heldY = Boolean(own.held.h);
  if (!from) return { point, angle: 0, snapped: false, guides: [], held: own.held };

  // 2. Направляющие по вершинам — только по осям, которые ещё свободны.
  const vertex = draftGuides(points, point, scheme, view, options).guides.filter(
    (guide) => (guide.axis === "h" ? !heldY : !heldX),
  );
  const takenX = heldX || vertex.some((guide) => guide.axis === "v");
  const takenY = heldY || vertex.some((guide) => guide.axis === "h");
  for (const guide of vertex) {
    if (guide.axis === "h") point = { x: point.x, y: guide.at.y };
    else point = { x: guide.at.x, y: point.y };
  }

  // 3. Угол — по тому, что осталось свободным, и целиком или никак.
  if (!(takenX && takenY)) {
    const snap = snapSegment(from, point, scheme, options);
    const disturbs = (takenX && snap.point.x !== point.x) || (takenY && snap.point.y !== point.y);
    if (snap.snapped && !disturbs) point = snap.point;
  }

  const shown = snapSegment(from, point, scheme, { free: true });
  const moved = point.x !== from.x || point.y !== from.y;
  return {
    point,
    angle: shown.angle,
    snapped: moved && roundAngle(shown.angle),
    guides: vertex,
    held: own.held,
  };
}

// ——— линейка и направляющие схемы ————————————————————————————————————
//
// Заказчик: «добавь „линейку“ по бокам у схемы, просто шкала с метками, без
// единиц измерения». Единиц у плана и правда нет: подложка — картинка,
// масштаба она не знает, и подписать деления метрами значило бы соврать.
// Шкала нужна, чтобы **ставить направляющие** и видеть, что они стоят ровно.
//
// Рисуется всё это только холстом: `drawScheme` о линейке и направляющих не
// знает вовсе, поэтому в PNG, в печать и в лист «Схема» они не попадают —
// монтажнику на бумаге они не нужны.

// Ширина полосы линейки в пикселях экрана.
export const RULER_SIZE = 18;
// Реже этого деления на экране не ставятся: частая гребёнка читается заливкой.
const RULER_STEP_MIN_PX = 48;
// Каждое пятое деление — длинное: по ним глаз считает.
const RULER_MAJOR_EVERY = 5;
const RULER_TICK = 5;
const RULER_TICK_MAJOR = 10;

// Попадание по направляющей и порог притяжки — в пикселях экрана, как у
// направляющих черновика: иначе на разном зуме всё ведёт себя по-разному.
export const GUIDE_HIT_PX = 5;
// Перекрестие ловит шире одиночной направляющей: главный приём пользователя —
// ставить точки в перекрестия, и промахиваться по ним обидно.
export const GUIDE_CROSS_PX = 13;

// Шаг делений в пикселях плана: 1, 2, 5 и их десятки. Берётся самый мелкий, у
// которого на экране остаётся разборчивый просвет.
export function rulerStep(zoom) {
  const scale = zoom > 0 ? zoom : 1;
  let step = 1;
  let guard = 0;
  while (step * scale < RULER_STEP_MIN_PX && guard < 40) {
    const digit = Number(String(step)[0]);
    step = digit === 1 ? step * 2 : digit === 2 ? (step / 2) * 5 : step * 2;
    guard += 1;
  }
  return step;
}

/**
 * Деления линейки для видимой части холста. `box` — размер холста в его
 * собственных пикселях. Возвращает `{step, top, left}`; в списках — экранная
 * координата деления и признак длинного.
 */
export function rulerTicks(scheme, view, box) {
  const state = renderView(view);
  const step = rulerStep(state.zoom);
  const ticks = (size, offset, planSize) => {
    const list = [];
    const first = Math.floor(-offset / (step * state.zoom));
    const last = Math.ceil((size - offset) / (step * state.zoom));
    for (let index = first; index <= last; index += 1) {
      const at = index * step;
      if (at < 0 || at > planSize) continue;
      list.push({ at, screen: offset + at * state.zoom, major: index % RULER_MAJOR_EVERY === 0 });
    }
    return list;
  };
  return {
    step,
    top: ticks(box.width, state.offsetX, schemeWidth(scheme)),
    left: ticks(box.height, state.offsetY, schemeHeight(scheme)),
  };
}

// Линейка: полоса с делениями сверху и слева. Без чисел — подписывать деления
// нечем, план масштаба не знает.
export function drawRuler(ctx, scheme, view, box) {
  const state = renderView(view);
  const ticks = rulerTicks(scheme, state, box);
  ctx.save();
  ctx.fillStyle = "rgba(246, 248, 250, 0.94)";
  ctx.fillRect(0, 0, box.width, RULER_SIZE);
  ctx.fillRect(0, 0, RULER_SIZE, box.height);
  ctx.strokeStyle = "#d0d7de";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, RULER_SIZE + 0.5);
  ctx.lineTo(box.width, RULER_SIZE + 0.5);
  ctx.moveTo(RULER_SIZE + 0.5, 0);
  ctx.lineTo(RULER_SIZE + 0.5, box.height);
  ctx.stroke();
  ctx.strokeStyle = "#8c959f";
  ctx.beginPath();
  for (const tick of ticks.top) {
    const x = Math.round(tick.screen) + 0.5;
    if (x < RULER_SIZE) continue;
    ctx.moveTo(x, RULER_SIZE);
    ctx.lineTo(x, RULER_SIZE - (tick.major ? RULER_TICK_MAJOR : RULER_TICK));
  }
  for (const tick of ticks.left) {
    const y = Math.round(tick.screen) + 0.5;
    if (y < RULER_SIZE) continue;
    ctx.moveTo(RULER_SIZE, y);
    ctx.lineTo(RULER_SIZE - (tick.major ? RULER_TICK_MAJOR : RULER_TICK), y);
  }
  ctx.stroke();
  ctx.restore();
}

/**
 * Какая линейка лежит под точкой экрана и какую направляющую она ставит.
 *
 * **Левая (вертикальная) линейка задаёт высоту — значит ставит горизонтальную
 * направляющую; верхняя задаёт положение по ширине — значит вертикальную.**
 * Слова заказчика: «по вертикальной линейке горизонтальную линию, а по
 * горизонтальной — вертикальную». Угол, где полосы сходятся, отдан верхней:
 * решать его пополам было бы гаданием, а так правило одно и предсказуемое.
 *
 * `null` — точка не на линейке.
 */
export function rulerAxis(point) {
  if (!point) return null;
  if (point.y <= RULER_SIZE) return "v";
  if (point.x <= RULER_SIZE) return "h";
  return null;
}

// Экранная координата направляющей: у горизонтальной это `y`, у вертикальной `x`.
export function guideScreen(guide, scheme, view) {
  const state = renderView(view);
  return guide.axis === "h"
    ? state.offsetY + guide.at * schemeHeight(scheme) * state.zoom
    : state.offsetX + guide.at * schemeWidth(scheme) * state.zoom;
}

// Доля плана из экранной координаты — обратный ход для перетаскивания.
export function guideFraction(axis, screen, scheme, view) {
  const state = renderView(view);
  const size = (axis === "h" ? schemeHeight(scheme) : schemeWidth(scheme)) * state.zoom;
  const offset = axis === "h" ? state.offsetY : state.offsetX;
  return size > 0 ? (screen - offset) / size : 0;
}

// Направляющие: тонкая приглушённая линия через весь холст, взятая под руку —
// заметнее. Двенадцать штук не должны превратить план в сетку.
export function drawSchemeGuides(ctx, guides, scheme, view, box, options = {}) {
  if (!guides || guides.length === 0) return;
  const state = renderView(view);
  const active = options.activeId || null;
  const dropping = options.dropId || null;
  ctx.save();
  for (const guide of guides) {
    const at = Math.round(guideScreen(guide, scheme, state)) + 0.5;
    const live = guide.id === active;
    const drop = guide.id === dropping;
    // Утащенная обратно на линейку гаснет и рвётся пунктиром: по отпусканию её
    // снимут, и знать об этом надо до, а не после.
    ctx.setLineDash(drop ? GUIDE_DROP_DASH : []);
    ctx.strokeStyle = drop ? GUIDE_LINE : live ? GUIDE_LINE_ACTIVE : GUIDE_LINE;
    ctx.globalAlpha = drop ? GUIDE_DROP_ALPHA : 1;
    ctx.lineWidth = live && !drop ? 1.6 : 1;
    ctx.beginPath();
    if (guide.axis === "h") {
      ctx.moveTo(0, at);
      ctx.lineTo(box.width, at);
    } else {
      ctx.moveTo(at, 0);
      ctx.lineTo(at, box.height);
    }
    ctx.stroke();
  }
  ctx.restore();
}

// Направляющая под точкой экрана: по ней холст решает, что взяли под руку.
export function hitSchemeGuide(guides, point, scheme, view) {
  const state = renderView(view);
  let best = null;
  for (const guide of guides || []) {
    const at = guideScreen(guide, scheme, state);
    const gap = Math.abs((guide.axis === "h" ? point.y : point.x) - at);
    if (gap <= GUIDE_HIT_PX && (!best || gap < best.gap)) best = { guide, gap };
  }
  return best ? best.guide : null;
}

/**
 * Притяжка к направляющим схемы. Возвращает `{point, held}`; `held` — какие
 * оси заняты и какими направляющими, по нему холст подсвечивает сработавшую.
 *
 * **Перекрестие тянет сильнее одиночной направляющей**: если рядом есть и
 * горизонтальная, и вертикальная, ловятся обе по широкому порогу
 * (`GUIDE_CROSS_PX`), а поодиночке — по обычному (`GUIDE_HIT_PX`). Главный приём
 * пользователя — ставить точки в перекрестия, и промах по ним обиднее лишнего
 * притяжения.
 */
export function snapToSchemeGuides(guides, point, scheme, view, options = {}) {
  const empty = { point, held: { h: null, v: null } };
  if (!guides || guides.length === 0 || options.free) return empty;
  const state = renderView(view);
  const at = planToScreen(point, scheme, state);
  let horizontal = null;
  let vertical = null;
  for (const guide of guides) {
    const screen = guideScreen(guide, scheme, state);
    if (guide.axis === "h") {
      const gap = Math.abs(screen - at.y);
      if (!horizontal || gap < horizontal.gap) horizontal = { guide, gap };
    } else {
      const gap = Math.abs(screen - at.x);
      if (!vertical || gap < vertical.gap) vertical = { guide, gap };
    }
  }
  const cross =
    horizontal && vertical && horizontal.gap <= GUIDE_CROSS_PX && vertical.gap <= GUIDE_CROSS_PX;
  const limit = cross ? GUIDE_CROSS_PX : GUIDE_HIT_PX;
  const next = { x: point.x, y: point.y };
  const held = { h: null, v: null };
  if (horizontal && horizontal.gap <= limit) {
    next.y = horizontal.guide.at;
    held.h = horizontal.guide.id;
  }
  if (vertical && vertical.gap <= limit) {
    next.x = vertical.guide.at;
    held.v = vertical.guide.id;
  }
  return { point: next, held };
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

// Текст подписи: у блока — свёрнутый в диапазон список, у одиночной метки — её
// обозначение.
function labelTextOf(project, target) {
  return (target.markIds ? blockLabel(project, labelMemberIds(target)) : labelOf(project, target.id)) || "";
}

// Ключ цели в раскладке. Группа и метка живут в разных пространствах
// идентификаторов, но в одной таблице — отсюда приставка.
function labelKeyOf(target) {
  return (target.markIds ? "g:" : "m:") + target.id;
}

// Технический код ошибки контракта — как в `store.js`, наружу он не выходит:
// это промах вызывающего, а не сообщение пользователю.
const LABEL_FILTER_ERROR = "label-layout-instead-of-filter";

// Пятый аргумент — **фильтр**, ровно тот же, что у `hitTest`, `drawScheme` и
// `visibleMarks`: раскладка считается по тем подписям, которые видит
// вызывающий. Передать сюда готовую раскладку нельзя — `Map` молча сошла бы за
// «фильтра нет», подписи разделили бы места со скрытыми, и клик разошёлся бы с
// картинкой. Внутри модуля для уже посчитанной раскладки есть `labelBoxIn`.
// Угол подписи: 0 — лежит, 90 — стоит вдоль стены. Хранится там же, где
// смещение: у группы своего поля модель не заводит, поэтому поворот блока
// живёт у его первой метки.
export function labelAngleOf(project, target) {
  if (!target) return 0;
  if (target.labelAngle === 90 || target.labelAngle === 0) return target.labelAngle;
  if (!target.markIds) return 0;
  const first = project.marks.find((mark) => mark.id === target.markIds[0]);
  return first && first.labelAngle === 90 ? 90 : 0;
}

// Габарит подписи от точки привязки текста. Лежачая идёт вправо и висит на
// середине строки; повёрнутая читается снизу вверх, поэтому растёт вверх, а
// вширь занимает высоту строки.
export function labelSpan(width, height, angle) {
  if (angle === 90) return { left: -height / 2, right: height / 2, top: -width, bottom: 0 };
  return { left: 0, right: width, top: -height / 2, bottom: height / 2 };
}

// Прямоугольник подписи на экране: левый верхний угол и размеры. По нему
// считаются и попадание по клику, и разведение — расходиться им нельзя.
export function labelBounds(box) {
  const span = labelSpan(box.width, box.height, box.angle);
  return {
    x: box.x + span.left,
    y: box.y + span.top,
    width: span.right - span.left,
    height: span.bottom - span.top,
  };
}

export function labelBox(project, scheme, target, view, filter) {
  if (filter instanceof Map) {
    const error = new Error(LABEL_FILTER_ERROR);
    error.code = LABEL_FILTER_ERROR;
    throw error;
  }
  const state = renderView(view);
  return labelBoxIn(project, scheme, target, state, labelLayout(project, scheme, filter, state));
}

// То же самое с уже посчитанной раскладкой: кадр холста и попадание по клику
// считают её один раз на все подписи схемы, а не заново на каждую.
function labelBoxIn(project, scheme, target, state, layout) {
  const font = labelFontSize(state);
  const anchor = planToScreen(labelOrigin(project, target), scheme, state);
  const value = labelTextOf(project, target);
  const width = Math.max(font * 0.8, value.length * font * LABEL_CHAR_RATIO);
  const place = labelPlaceOf(project, scheme, target, state, layout);
  return {
    text: value,
    x: anchor.x + place.dx * state.zoom,
    y: anchor.y + place.dy * state.zoom,
    width,
    height: font * 1.2,
    font,
    // Смещение подписи в пикселях плана — в тех же единицах, что `labelOffset`
    // у метки. Отсюда его берёт перетаскивание: подпись, которую разводка
    // отодвинула, не прыгает обратно, когда за неё взялись мышью.
    dx: place.dx,
    dy: place.dy,
    row: place.row,
    crowded: place.crowded,
    angle: labelAngleOf(project, target),
  };
}

// Где стоит подпись. Оттащенная руками — строго по своему смещению: его задал
// пользователь, и трогать его нельзя. Остальные — по месту из раскладки.
function labelPlaceOf(project, scheme, target, state, layout) {
  const manual = labelOffsetOf(project, target);
  if (manual) return { dx: manual.dx, dy: manual.dy, row: 0, crowded: false };
  const place = layout.get(labelKeyOf(target));
  if (place) return place;
  // Цели в раскладке нет — значит она в неё и не входила: метку спрятал фильтр
  // или она с другой схемы. Такая подпись не рисуется; место ей даётся
  // стандартное, то самое, где подпись стояла всегда.
  const [slot] = labelSlots(
    labelPlanSizes(state).gap,
    labelSpan(0, 0, 0),
    0,
    { left: 0, right: 0 },
    labelLeadSide(project, scheme, target),
  );
  return { dx: slot.dx, dy: slot.dy, row: 0, crowded: false };
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

// ——— разведение подписей ——————————————————————————————————————————————
//
// Метка стоит там, где стоит железка на стене, и двигать её нельзя. Двигать
// можно только подпись — а подписи соседних меток запросто перекрывают друг
// друга: код типа бывает в шестнадцать букв, а розетки стоят в сорока
// пикселях одна от другой. Перекрытая подпись съедает номер, а номер —
// единственное, ради чего подпись на плане и стоит.
//
// Раскладка перебирает для каждой подписи короткий список мест вокруг её
// метки и берёт первое свободное. Три свойства, ради которых всё считается
// именно так:
//
// 1. Считается в пикселях плана, а не экрана. Экран и выгрузка отличаются
//    только масштабом, и подпись уезжает на `dx × zoom` — значит распечатка
//    повторяет то, что видел инженер, знак в знак.
// 2. Порядок обхода — сверху вниз, слева направо, при равенстве по ключу.
//    Одна и та же схема, открытая дважды, раскладывается одинаково.
// 3. Жадность вместо оптимума: перебор мест у каждой подписи ограничен, чужие
//    подписи уже расставлены и не переставляются. Полсотни меток — это полсотни
//    коротких переборов, а не поиск идеальной раскладки.

// Сколько рядов вверх и вниз пробует раскладка, прежде чем сдаться. Ряд — это
// высота подписи: дальше подпись уже не читается как «эта, у этой метки».
const LABEL_ROWS = 3;
// Просвет между соседними подписями в пикселях плана: вплотную поставленные
// строки читаются как одна.
const LABEL_PAD = 2;

// Кегль и отступ в пикселях плана. Те же нижние границы, что у экранных
// `labelFontSize` и `markRadius` при единичном масштабе.
function labelPlanSizes(state) {
  const radius = Math.max(2, state.markSize);
  return { font: Math.max(6, state.labelSize), gap: radius * LABEL_GAP, radius };
}

// Куда уходить подписи линии. У точки подпись встаёт справа и ни с чем не
// спорит, а у ломаной справа от первой вершины лежит она сама: линия, идущая
// вправо, проходит ровно под своей подписью. Заказчик: «по направлению первого
// сегмента» — значит подпись уходит **поперёк** этого направления.
//
// Почти вертикальная первая сторона правила не меняет: подпись справа от неё
// и так в стороне от линии. Почти горизонтальная уводит подпись по вертикали —
// вверх, а если сегмент сам идёт вверх, то вниз: в обе стороны от линии
// одинаково свободно, и выбирается та, куда линия не пошла.
//
// Считается в пикселях плана: план бывает 1000×500, и «горизонтальнее ли»
// решается тем же счётом, что угол отрезка.
function labelLeadSide(project, scheme, target) {
  const lead = labelLead(project, target);
  const points = (lead && lead.kind === "line" && lead.points) || [];
  if (points.length < 2) return null;
  const dx = (points[1].x - points[0].x) * schemeWidth(scheme);
  const dy = (points[1].y - points[0].y) * schemeHeight(scheme);
  if (Math.abs(dx) < Math.abs(dy)) return null;
  if (dx === 0 && dy === 0) return null;
  return { sign: dy >= 0 ? -1 : 1 };
}

// Места вокруг метки в порядке убывания желанности.
//
// Первое — **справа, на уровне метки**: заказчик просил подпись «не сверху
// справа, а просто справа». Ряд обозначений на одной высоте так и читается
// строкой, а не лесенкой. Второе — слева на том же уровне, для метки у правого
// края плана. Дальше — те же две стороны ряд за рядом вверх и вниз, для тех,
// кому на своём уровне не хватило места.
//
// `dx` — смещение левого края подписи, `dy` — её середины: слева подпись
// отодвигается на всю свою ширину.
function labelSlots(gap, span, angle, reach = { left: 0, right: 0 }, lead = null) {
  const tall = span.bottom - span.top;
  // Шаг ряда — высота подписи и два просвета: соседние ряды обязаны разойтись
  // с запасом, иначе проверка наложения упирается в ноль и решает исход по
  // погрешности последнего разряда.
  const step = tall + LABEL_PAD * 2;
  // Подпись отсчитывается от края цели, а не от её середины: у блока точка
  // привязки — середина между метками, и подпись «В1В2В3», встав на уровень
  // меток, легла бы поверх крайней из них.
  const right = reach.right + gap - span.left;
  const left = -reach.left - gap - span.right;
  // Лежачая подпись висит серединой строки у точки привязки, повёрнутая растёт
  // от неё вверх — её середина на полстолбца выше, и уровень метки для неё
  // считается отсюда.
  const middle = angle === 90 ? tall / 2 : 0;
  const slots = [
    { dx: right, dy: middle, row: 0 },
    { dx: left, dy: middle, row: 0 },
  ];
  // У линии первыми пробуются места над началом и под ним: вбок от первой
  // вершины идёт сама линия. Ближний край подписи отстоит от точки привязки на
  // тот же просвет `gap`, что и у боковых мест, — мера одна.
  if (lead) {
    const away = { dy: lead.sign < 0 ? -gap - span.bottom : gap - span.top };
    const back = { dy: lead.sign < 0 ? gap - span.top : -gap - span.bottom };
    slots.unshift(
      { dx: right, dy: away.dy, row: 0 },
      { dx: left, dy: away.dy, row: 0 },
      { dx: right, dy: back.dy, row: 0 },
      { dx: left, dy: back.dy, row: 0 },
    );
  }
  for (let row = 1; row <= LABEL_ROWS; row += 1) {
    const up = middle - row * step;
    const down = middle + row * step;
    slots.push({ dx: right, dy: up, row });
    slots.push({ dx: right, dy: down, row });
    slots.push({ dx: left, dy: up, row });
    slots.push({ dx: left, dy: down, row });
  }
  return slots;
}

// Насколько метки цели расходятся от точки привязки вправо и влево, в долях
// плана. У одиночной точки это ноль, у блока — половина его ширины: подпись
// обязана встать за крайней меткой блока, а не поверх неё. Вершины ломаной в
// счёт не идут: её подпись стоит у первой вершины, и тянуть её за весь трек
// через полплана незачем.
function labelReach(project, target) {
  const origin = labelOrigin(project, target);
  const ids = target.markIds ? labelMemberIds(target) : null;
  const marks = ids
    ? ids.map((id) => project.marks.find((mark) => mark.id === id)).filter(Boolean)
    : [target];
  let left = 0;
  let right = 0;
  for (const mark of marks) {
    if (!mark || mark.kind === "line") continue;
    for (const point of mark.points || []) {
      right = Math.max(right, point.x - origin.x);
      left = Math.max(left, origin.x - point.x);
    }
  }
  return { left, right };
}

// Подпись в пикселях плана: `x`, `y` — точка привязки (сама метка), размеры —
// оценка по числу знаков, та же, что у экранного `labelBox`.
function labelPlanBox(project, scheme, target, sizes) {
  const origin = labelOrigin(project, target);
  const text = labelTextOf(project, target);
  const reach = labelReach(project, target);
  const lead = labelLeadSide(project, scheme, target);
  const width = schemeWidth(scheme);
  return {
    text,
    x: origin.x * width,
    y: origin.y * schemeHeight(scheme),
    width: Math.max(sizes.font * 0.8, text.length * sizes.font * LABEL_CHAR_RATIO),
    height: sizes.font * 1.2,
    angle: labelAngleOf(project, target),
    reach: { left: reach.left * width, right: reach.right * width },
    lead,
  };
}

function labelRect(box, offset) {
  const span = labelSpan(box.width, box.height, box.angle);
  return {
    x: box.x + offset.dx + span.left,
    y: box.y + offset.dy + span.top,
    width: span.right - span.left,
    height: span.bottom - span.top,
  };
}

// Площадь наложения двух подписей с учётом обязательного просвета. Ноль — место
// свободно; иначе число тем больше, чем хуже: по нему выбирается наименее
// плохое место, когда свободных не осталось.
function labelOverlap(a, b) {
  const wide = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x) + LABEL_PAD;
  const tall = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y) + LABEL_PAD;
  return wide > 0 && tall > 0 ? wide * tall : 0;
}

// Подпись целиком на плане. Выгрузка «весь план» рисует ровно прямоугольник
// плана — всё, что за его краем, на картинке просто отрезано.
function labelInsidePlan(rect, width, height) {
  return rect.x >= 0 && rect.x + rect.width <= width && rect.y >= 0 && rect.y + rect.height <= height;
}

// Фильтр меняет состав подписей, а значит и раскладку: ключ кэша обязан его
// учитывать.
function labelFilterKey(filter) {
  if (!filter) return "-";
  return [
    Array.isArray(filter.categoryIds) ? filter.categoryIds.join(",") : "*",
    Array.isArray(filter.typeIds) ? filter.typeIds.join(",") : "*",
    filter.roomId || "",
    (filter.query || "").trim().toLowerCase(),
  ].join("|");
}

function labelPlaceAll(project, scheme, filter, sizes) {
  const planWidth = schemeWidth(scheme);
  const planHeight = schemeHeight(scheme);
  const layout = new Map();
  const entries = labelTargets(project, scheme, filter)
    .map((target) => ({
      key: labelKeyOf(target),
      box: labelPlanBox(project, scheme, target, sizes),
      offset: labelOffsetOf(project, target),
    }))
    .filter((entry) => entry.box.text);
  entries.sort((a, b) => a.box.y - b.box.y || a.box.x - b.box.x || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));

  // Оттащенные руками подписи в раскладку не попадают, но остаются на плане:
  // их места заняты, и остальные их обходят.
  const placed = entries.filter((entry) => entry.offset).map((entry) => labelRect(entry.box, entry.offset));

  // Сами метки — тоже занятые места. Подпись встала на уровень своей метки, и
  // у плотно поставленных точек соседний знак оказывается ровно там, куда
  // просится строка: без этого «Р6» легла бы на соседнюю розетку.
  for (const mark of visibleMarks(project, scheme, filter)) {
    for (const point of mark.points || []) {
      placed.push({
        x: point.x * planWidth - sizes.radius,
        y: point.y * planHeight - sizes.radius,
        width: sizes.radius * 2,
        height: sizes.radius * 2,
      });
    }
  }

  for (const entry of entries) {
    if (entry.offset) continue;
    const slots = labelSlots(
      sizes.gap,
      labelSpan(entry.box.width, entry.box.height, entry.box.angle),
      entry.box.angle,
      entry.box.reach,
      entry.box.lead,
    );
    let best = null;
    for (const slot of slots) {
      const rect = labelRect(entry.box, slot);
      const inside = labelInsidePlan(rect, planWidth, planHeight);
      let overlap = 0;
      for (const other of placed) overlap += labelOverlap(rect, other);
      if (overlap === 0 && inside) {
        best = { slot, rect, overlap, inside };
        break;
      }
      // Свободного и целиком помещающегося места пока нет — запоминаем лучшее
      // из виденных: сперва по наложению, при равном наложении — то, что не
      // свешивается с плана.
      if (!best || overlap < best.overlap || (overlap === best.overlap && inside && !best.inside)) {
        best = { slot, rect, overlap, inside };
      }
    }
    placed.push(best.rect);
    layout.set(entry.key, { dx: best.slot.dx, dy: best.slot.dy, row: best.slot.row, crowded: best.overlap > 0 });
  }
  return layout;
}

// Кэш раскладки: объект после любой правки — новый (все функции модели чистые),
// поэтому WeakMap по объекту сам забывает устаревшее. Внутри — по схеме,
// размерам и фильтру: раскладка считается один раз, а зовут её и кадр холста,
// и попадание по клику на каждое движение мыши.
const labelLayoutCache = new WeakMap();

// Раскладка подписей схемы: ключ цели → смещение в пикселях плана.
// Оттащенных руками подписей в ней нет — у них своё смещение, и оно главнее.
export function labelLayout(project, scheme, filter, view) {
  if (!project || !scheme) return new Map();
  const state = renderView(view);
  const sizes = labelPlanSizes(state);
  const key = [scheme.id, sizes.font, sizes.gap, labelFilterKey(filter)].join("|");
  let byKey = labelLayoutCache.get(project);
  if (!byKey) {
    byKey = new Map();
    labelLayoutCache.set(project, byKey);
  }
  let value = byKey.get(key);
  if (!value) {
    value = labelPlaceAll(project, scheme, filter, sizes);
    byKey.set(key, value);
  }
  return value;
}

// ——— ручка поворота подписи ———————————————————————————————————————————
//
// Кнопка живёт на холсте, у самой подписи выделенной метки, а не в панели:
// поворачивают подпись, глядя на план — влезает она вдоль стены или нет, —
// и уводить руку в колонку ради этого незачем. Панель к тому же скрыта на
// узком экране, а холст виден всегда.

// Радиус ручки: как у ручек блока, чтобы попадать по ней не целясь.
const LABEL_TURN_RADIUS = 9;

// Цель подписи, которой принадлежит метка: у блока — его группа (подпись одна
// на всех), у одиночной метки — она сама. Скрытая фильтром метка цели не имеет.
export function labelTargetOf(project, scheme, markId, filter) {
  if (!project || !scheme || !markId) return null;
  for (const target of labelTargets(project, scheme, filter)) {
    if (target.markIds) {
      if (labelMemberIds(target).includes(markId)) return target;
    } else if (target.id === markId) {
      return target;
    }
  }
  return null;
}

// Ручка стоит у верхнего правого угла подписи — того самого, который не
// заслоняет текст ни лежачей подписи, ни стоячей. Считается от габарита, а не
// от метки: подпись комнаты берёт ту же ручку и тот же угол.
function turnHandleAt(rect, view) {
  const radius = Math.max(7, Math.min(LABEL_TURN_RADIUS, markRadius(view) * 0.8));
  return { x: rect.x + rect.width + radius * 0.6, y: rect.y - radius * 0.6, r: radius };
}

export function labelTurnHandle(project, scheme, target, view, filter) {
  if (!target) return null;
  const box = labelBox(project, scheme, target, view, filter);
  if (!box.text) return null;
  return turnHandleAt(labelBounds(box), view);
}

export function hitLabelTurn(project, scheme, target, point, view, filter) {
  const handle = labelTurnHandle(project, scheme, target, view, filter);
  if (!handle) return false;
  return Math.hypot(point.x - handle.x, point.y - handle.y) <= handle.r + HIT_SLACK_PX;
}

// Значок — дуга со стрелкой: поворот, а не «плюс» и не «крест». Буквы здесь
// нельзя: строки живут в словаре, а на холсте рисуется фигура.
export function drawLabelTurn(ctx, handle, color) {
  if (!handle) return;
  ctx.save();
  ctx.beginPath();
  ctx.arc(handle.x, handle.y, handle.r, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(255, 255, 255, 0.95)";
  ctx.fill();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = color;
  ctx.stroke();
  const inner = handle.r * 0.5;
  ctx.beginPath();
  ctx.arc(handle.x, handle.y, inner, Math.PI * 0.75, Math.PI * 2.1);
  ctx.lineWidth = Math.max(1.4, handle.r * 0.2);
  ctx.stroke();
  // Наконечник на конце дуги.
  const tip = polarPoint(handle.x, handle.y, inner, 135);
  ctx.beginPath();
  ctx.moveTo(tip.x, tip.y - inner * 0.55);
  ctx.lineTo(tip.x + inner * 0.55, tip.y);
  ctx.lineTo(tip.x, tip.y + inner * 0.55);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
  ctx.restore();
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

// Ручки вершин пути: квадрат на каждой вершине. Одна мера и один вид у контура
// помещения и у ломаной метки — правит их одна и та же рука.
export function pathVertexHandles(scheme, points, view) {
  const state = renderView(view);
  return (points || []).map((point, index) => {
    const at = planToScreen(point, scheme, state);
    return { kind: "vertex", index, x: at.x, y: at.y, r: OUTLINE_HANDLE_PX };
  });
}

// Ручка пути под точкой экрана — по ней холст решает, что потащили.
export function hitPathHandle(handles, point) {
  for (const handle of handles) {
    if (Math.hypot(point.x - handle.x, point.y - handle.y) <= handle.r + 2) return handle;
  }
  return null;
}

// Ручки правки контура — те же квадраты на вершинах, что у ломаной метки:
// после того, как правка свелась в один жест, своих ручек у контура нет.
export function outlineHandles(scheme, outline, view) {
  return pathVertexHandles(scheme, outline.points, renderView(view));
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
    const handle = hitPathHandle(outlineHandles(scheme, selected, state), point);
    if (handle) return { outlineId: selected.id, part: handle.kind, index: handle.index };
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

// Смещение подписи комнаты — в пикселях плана, ровно как `labelOffset` у метки
// и у блока. Поля нет у контуров, размеченных до этого: «нет смещения» — это и
// есть прежняя подпись в середине контура.
export function outlineLabelOffsetOf(outline) {
  return (outline && outline.labelOffset) || null;
}

// Угол подписи комнаты: 0 — лежит, 90 — стоит вдоль стены. Тот же список
// углов, что у метки; всё, что не 90, читается как 0.
export function outlineLabelAngleOf(outline) {
  return outline && outline.labelAngle === 90 ? 90 : 0;
}

/**
 * Габарит подписи комнаты. Кегль — тем же правилом, что у подписи метки: своего
 * коэффициента и своего минимума у комнаты нет, иначе на одном плане стояли бы
 * две разные меры.
 *
 * Подпись стоит **серединой** на своей точке — в середине контура или там, куда
 * её оттащили руками. У метки точка привязки — сама метка, и подпись идёт от
 * неё вбок; у комнаты привязка — её середина, и подпись обязана остаться на ней
 * посередине, как бы её ни повернули. Отсюда и пересчёт в точку начала текста:
 * `x`, `y` здесь — то же, что у подписи метки, и `labelBounds` считает габарит
 * обоих одной формулой.
 */
export function outlineLabelBox(project, scheme, outline, view) {
  const room = findRoom(project, outline.roomId);
  if (!room || !room.name) return null;
  const state = renderView(view);
  const font = labelFontSize(state);
  const angle = outlineLabelAngleOf(outline);
  const offset = outlineLabelOffsetOf(outline);
  const dx = offset ? offset.dx : 0;
  const dy = offset ? offset.dy : 0;
  const center = planToScreen(outlineCenter(outline.points), scheme, state);
  const at = { x: center.x + dx * state.zoom, y: center.y + dy * state.zoom };
  const width = Math.max(font * 0.8, room.name.length * font * LABEL_CHAR_RATIO);
  const anchor = angle === 90 ? { x: at.x, y: at.y + width / 2 } : { x: at.x - width / 2, y: at.y };
  return { text: room.name, x: anchor.x, y: anchor.y, width, height: font * 1.2, font, angle, dx, dy };
}

// Ручка поворота у подписи комнаты — та же, что у подписи метки, и стоит там же
// относительно габарита.
export function outlineLabelTurn(project, scheme, outline, view) {
  if (!outline) return null;
  const box = outlineLabelBox(project, scheme, outline, renderView(view));
  if (!box) return null;
  return turnHandleAt(labelBounds(box), renderView(view));
}

export function hitOutlineLabelTurn(project, scheme, outline, point, view) {
  const handle = outlineLabelTurn(project, scheme, outline, view);
  if (!handle) return false;
  return Math.hypot(point.x - handle.x, point.y - handle.y) <= handle.r + HIT_SLACK_PX;
}

// Подпись комнаты рисуется серединой на своей точке — так она стояла всегда,
// так же ложится и повёрнутая. Габарит для клика считает `labelBounds` того же
// прямоугольника, поэтому подпись ловится там, где нарисована.
function drawOutlineLabel(ctx, box, color) {
  const rect = labelBounds(box);
  ctx.save();
  ctx.font = `600 ${box.font}px system-ui, -apple-system, "Segoe UI", Arial, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  // Обводка-подложка: подпись читается и поверх линий плана.
  ctx.lineWidth = Math.max(2, box.font * 0.3);
  ctx.lineJoin = "round";
  ctx.strokeStyle = "rgba(255, 255, 255, 0.85)";
  ctx.fillStyle = color;
  ctx.translate(rect.x + rect.width / 2, rect.y + rect.height / 2);
  // Повёрнутая читается снизу вверх — так подписывают вдоль стен на чертежах.
  if (box.angle === 90) ctx.rotate(-Math.PI / 2);
  ctx.strokeText(box.text, 0, 0);
  ctx.fillText(box.text, 0, 0);
  ctx.restore();
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
    drawOutlineLabel(ctx, label, outlineTint(color, style.label));
  }
}

// Рисование ручек пути. Квадрат — вершина, кружок с «+» — вставка: один вид у
// контура помещения и у ломаной метки.
export function drawPathHandles(ctx, handles, color) {
  const tint = color || "#0969da";
  ctx.save();
  ctx.fillStyle = "rgba(255, 255, 255, 0.95)";
  ctx.strokeStyle = tint;
  ctx.lineWidth = 1.5;
  for (const handle of handles) {
    ctx.beginPath();
    ctx.rect(handle.x - handle.r, handle.y - handle.r, handle.r * 2, handle.r * 2);
    ctx.fill();
    ctx.stroke();
  }
  ctx.restore();
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
  const rect = labelBounds(box);
  return (
    point.x >= rect.x - 2 &&
    point.x <= rect.x + rect.width + 2 &&
    point.y >= rect.y &&
    point.y <= rect.y + rect.height
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
  const layout = labelLayout(project, scheme, filter, state);
  for (let index = targets.length - 1; index >= 0; index -= 1) {
    const target = targets[index];
    const box = labelBoxIn(project, scheme, target, state, layout);
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

// Поводок к отведённой подписи: тонкая линия от метки к ближнему краю текста.
// Рисуется только тем, кого раскладка увела на ряд и дальше, — у подписи
// вплотную к метке и так видно, чья она.
function drawLabelLeader(ctx, anchor, box, color) {
  if (!box.text) return;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.globalAlpha = 0.5;
  ctx.lineWidth = Math.max(1, box.font * 0.08);
  const rect = labelBounds(box);
  ctx.beginPath();
  ctx.moveTo(anchor.x, anchor.y);
  ctx.lineTo(
    rect.x + rect.width < anchor.x ? rect.x + rect.width : Math.max(rect.x, Math.min(anchor.x, rect.x + rect.width)),
    anchor.y < rect.y ? rect.y : rect.y + rect.height,
  );
  ctx.stroke();
  ctx.restore();
}

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
  ctx.fillStyle = color;
  // Повёрнутая подпись читается снизу вверх — так её пишут вдоль стен на
  // чертежах. Рисование и габарит берут один и тот же угол, поэтому клик
  // попадает туда, где текст виден.
  if (box.angle === 90) {
    ctx.translate(box.x, box.y);
    ctx.rotate(-Math.PI / 2);
    ctx.strokeText(box.text, 0, 0);
    ctx.fillText(box.text, 0, 0);
    ctx.restore();
    return;
  }
  ctx.strokeText(box.text, box.x, box.y);
  ctx.fillText(box.text, box.x, box.y);
  ctx.restore();
}

function drawMarkBody(ctx, project, scheme, mark, view, selected) {
  const style = styleOf(project, mark.typeId);
  const radius = markRadius(view);
  const screen = mark.points.map((point) => planToScreen(point, scheme, view));
  if (mark.kind === "line" && screen.length > 1) {
    strokeStyledLine(ctx, screen, mark.closed, style.lineStyle, radius, style.color);
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

// Видимая часть холста в его собственных единицах: по ней тянутся направляющие.
// Ширину холста знает только `ctx`, и если он её не отдаёт (заглушка в тесте),
// направляющая тянется по плану.
function drawExtent(ctx, scheme, view) {
  const scale = typeof ctx.getTransform === "function" ? ctx.getTransform() : null;
  const ratio = scale && scale.a > 0 ? scale.a : 0;
  const width = ctx.canvas && ctx.canvas.width > 0 && ratio > 0 ? ctx.canvas.width / ratio : 0;
  const height = ctx.canvas && ctx.canvas.height > 0 && ratio > 0 ? ctx.canvas.height / ratio : 0;
  if (width > 0 && height > 0) return { width, height };
  return {
    width: view.offsetX + schemeWidth(scheme) * view.zoom,
    height: view.offsetY + schemeHeight(scheme) * view.zoom,
  };
}

// Направляющие: полупрозрачный мелкий пунктир через вершину, которая поймала
// курсор. Узор нарочно мельче любого начертания метки — иначе на пунктирной
// линии не понять, где черновик, а где подсказка.
function drawDraftGuides(ctx, scheme, guides, view, color) {
  if (!guides || guides.length === 0) return;
  const box = drawExtent(ctx, scheme, view);
  ctx.save();
  ctx.globalAlpha = GUIDE_ALPHA;
  ctx.strokeStyle = color;
  ctx.lineWidth = GUIDE_WIDTH;
  ctx.setLineDash(GUIDE_DASH);
  for (const guide of guides) {
    const at = planToScreen(guide.at, scheme, view);
    ctx.beginPath();
    if (guide.axis === "h") {
      ctx.moveTo(0, at.y);
      ctx.lineTo(box.width, at.y);
    } else {
      ctx.moveTo(at.x, 0);
      ctx.lineTo(at.x, box.height);
    }
    ctx.stroke();
  }
  ctx.restore();
}

// Черновик линии: уже поставленные вершины плюс резинка до курсора.
function drawDraft(ctx, scheme, draft, view, color, lineStyle) {
  if (!draft || draft.points.length === 0) return;
  const radius = markRadius(view);
  // Направляющие — под черновиком: подсказка не должна перечёркивать линию.
  drawDraftGuides(ctx, scheme, draft.guides, view, color);
  const screen = draft.points.map((point) => planToScreen(point, scheme, view));
  // Черновик рисуется тем же начертанием, каким ляжет метка: волну и пунктир
  // видно ещё до того, как линия поставлена. Резинка до курсора — часть той же
  // нитки, иначе узор на ней начинался бы заново.
  const drawn = draft.cursor ? [...screen, planToScreen(draft.cursor, scheme, view)] : screen;
  if (drawn.length > 1) strokeStyledLine(ctx, drawn, false, lineStyle, radius, color);
  for (const point of screen) drawShape(ctx, "circle", point.x, point.y, Math.max(3, radius * 0.5), color);
  // Первая вершина крупнее: по ней замыкают контур.
  drawShape(ctx, "circle", screen[0].x, screen[0].y, Math.max(4, radius * 0.75), color);
  if (!draft.cursor) return;
  const from = draft.points[draft.points.length - 1];
  const start = planToScreen(from, scheme, view);
  const cursor = planToScreen(draft.cursor, scheme, view);
  if (Math.hypot(cursor.x - start.x, cursor.y - start.y) < DRAFT_ANGLE_MIN_PX) return;
  // Угол берётся у уже нарисованного отрезка: точку под курсором холст к этому
  // времени притянул сам, и подсказка обязана показывать то, что видно.
  const shown = snapSegment(from, draft.cursor, scheme, { free: true });
  drawDraftAngle(ctx, cursor, shown.angle, Boolean(draft.snapped), color);
}

// Градус тянущегося отрезка — у курсора, а не в углу холста: инженер смотрит на
// конец линии, и по углу холста не понять, к какому отрезку относится число.
// Сработавший магнит виден по слову «ровно» и цвету — иначе непонятно, почему
// линия не идёт за рукой.
function drawDraftAngle(ctx, at, angle, snapped, color) {
  const value = text(snapped ? "canvas.angleSnapped" : "canvas.angleFree", { deg: Math.round(angle) % 360 });
  ctx.save();
  ctx.font = `600 ${DRAFT_ANGLE_FONT}px system-ui, -apple-system, "Segoe UI", Arial, sans-serif`;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.lineWidth = Math.max(2, DRAFT_ANGLE_FONT * 0.3);
  ctx.lineJoin = "round";
  const x = draftAngleX(ctx, at, ctx.measureText(value).width);
  const y = at.y - DRAFT_ANGLE_GAP;
  ctx.strokeStyle = "rgba(255, 255, 255, 0.92)";
  ctx.strokeText(value, x, y);
  ctx.fillStyle = snapped ? color : DRAFT_ANGLE_FREE;
  ctx.fillText(value, x, y);
  ctx.restore();
}

// Подсказка стоит справа от курсора, а у правого края холста переезжает влево:
// обрезанное число не читается, а курсор у края — обычное дело, когда линию
// ведут к стене. Ширину холста в своих единицах знает только `ctx`, и если он
// её не отдаёт (заглушка в тесте), подсказка остаётся справа.
function draftAngleX(ctx, at, width) {
  const right = at.x + DRAFT_ANGLE_GAP;
  const scale = typeof ctx.getTransform === "function" ? ctx.getTransform() : null;
  const ratio = scale && scale.a > 0 ? scale.a : 0;
  const edge = ctx.canvas && ctx.canvas.width > 0 && ratio > 0 ? ctx.canvas.width / ratio : 0;
  if (!(edge > 0) || right + width <= edge) return right;
  return at.x - DRAFT_ANGLE_GAP - width;
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
  draftLineStyle,
  guides,
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
  // Подписи — после меток и в два прохода: сперва поводки у тех, кого развели
  // от соседа, потом сам текст. Иначе поводок ляжет поверх уже нарисованной
  // подписи и перечеркнёт её.
  const layout = labelLayout(project, scheme, filter, state);
  const labels = labelTargets(project, scheme, filter).map((target) => ({
    box: labelBoxIn(project, scheme, target, state, layout),
    anchor: planToScreen(labelOrigin(project, target), scheme, state),
    color: styleOf(project, (labelLead(project, target) || {}).typeId).color,
  }));
  for (const item of labels) {
    if (item.box.row > 0) drawLabelLeader(ctx, item.anchor, item.box, item.color);
  }
  for (const item of labels) drawLabel(ctx, item.box, item.color);
  if (draft) drawDraft(ctx, scheme, draft, state, draftColor || "#0969da", draftLineStyle);
  // Направляющие без черновика: вершину правят той же рукой, что рисуют, и
  // подсказки при этом те же. Черновика в этот момент нет, а пунктир нужен.
  if (guides && !draft) drawDraftGuides(ctx, scheme, guides, state, draftColor || "#0969da");
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
