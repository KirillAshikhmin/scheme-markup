// Связи меток на плане (G119).
//
// Проверяется не «нарисовалось что-то», а три обещания тикета, каждое из
// которых ломается молча:
//
// 1. **Связь нельзя спутать с меткой-линией.** Отпечаток требует того, чего
//    линии недоступно: дуги вместо ломаной, наконечника, своего цвета и
//    толщины, которая не растёт с масштабом. Ослабить любой из признаков —
//    значит вернуть план, на котором разбор читается как трасса.
// 2. **Кадр берёт объект оттуда же, откуда метки.** Тот же класс дефекта, на
//    котором обожглись направляющие (таск 68): свой, укороченный путь до кадра
//    даёт картинку, которая не едет за курсором. Проверяется промежуточный
//    кадр, а не итог, — итог верен и при поломке.
// 3. **Два режима показа не спорят.** Переключатель включён — все связи схемы,
//    выключен — связи выделенной метки. Дуга при переключении не должна
//    прыгать: прогиб считается по всем связям схемы, а не по показанным.
// 4. **В PNG и в печать связи идут только по отметке.** Умолчание — чертёж.
import test from "node:test";
import assert from "node:assert/strict";

import { addMark, addScheme, createProject, setMarkControls, setMarkNumber } from "../src/model.js";
import { canvasFrameLinks } from "../src/canvas.js";
import { convexHull, drawMarkLinks, drawScheme, linkHullOutline, markLinkAnchor, markLinks } from "../src/render.js";
import { linksHint, linksNotice } from "../src/panels/links.js";
import { strings } from "../src/strings.js";

const PLAN = { width: 1000, height: 500 };
const BOX = { width: 900, height: 600 };
const viewOf = (patch) => ({ zoom: 1, offsetX: 0, offsetY: 0, markSize: 10, labelSize: 12, ...patch });

// Заглушка холста, которая помнит не только путь, но и чем его вели: толщину,
// прозрачность и цвет. Признаки связи — как раз в этом, а не в координатах.
function drawProbe() {
  const strokes = [];
  const fills = [];
  let path = null;
  const impl = {
    canvas: { width: BOX.width, height: BOX.height },
    lineWidth: 1,
    globalAlpha: 1,
    strokeStyle: "",
    fillStyle: "",
    dash: [],
    getTransform: () => ({ a: 1 }),
    measureText: (value) => ({ width: String(value).length * 7 }),
    beginPath() {
      path = { points: [], curves: 0, control: null, arc: null };
    },
    moveTo(x, y) {
      if (path) path.points.push({ x, y });
    },
    lineTo(x, y) {
      if (path) path.points.push({ x, y });
    },
    quadraticCurveTo(cx, cy, x, y) {
      if (!path) return;
      path.curves += 1;
      path.control = { x: cx, y: cy };
      path.points.push({ x, y });
    },
    arc(x, y, r) {
      if (path) path.arc = { x, y, r };
    },
    setLineDash(value) {
      impl.dash = Array.isArray(value) ? value.slice() : [];
    },
    stroke() {
      if (path) {
        strokes.push({
          ...path,
          width: impl.lineWidth,
          alpha: impl.globalAlpha,
          color: impl.strokeStyle,
          dash: impl.dash.slice(),
        });
      }
      path = null;
    },
    fill() {
      if (path) fills.push({ ...path, alpha: impl.globalAlpha, color: impl.fillStyle });
      path = null;
    },
  };
  return {
    strokes,
    fills,
    ctx: new Proxy(impl, {
      get: (object, key) => (key in object ? object[key] : () => {}),
      set: (object, key, value) => {
        object[key] = value;
        return true;
      },
    }),
  };
}

// Точка внутри замкнутой ломаной: лучевой тест. Нужен, чтобы проверить, что
// оболочка обходит свои метки, а не режет их.
function pointInPolygon(point, polygon) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const a = polygon[i];
    const b = polygon[j];
    const crosses = a.y > point.y !== b.y > point.y;
    if (crosses && point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

// Сцена: выключатель слева, лента справа, выключатель управляет лентой.
function scene() {
  const made = addScheme(createProject(), { name: "1 этаж", width: PLAN.width, height: PLAN.height });
  const project = made.project;
  const point = project.markTypes.find((type) => type.code === "В");
  const line = project.markTypes.find((type) => type.code === "Л");
  const first = addMark(project, { schemeId: made.scheme.id, typeId: point.id, points: [{ x: 0.2, y: 0.5 }] });
  const second = addMark(first.project, {
    schemeId: made.scheme.id,
    typeId: line.id,
    kind: "line",
    points: [
      { x: 0.6, y: 0.4 },
      { x: 0.8, y: 0.4 },
    ],
  });
  return {
    project: second.project,
    scheme: second.project.schemes[0],
    schemeId: made.scheme.id,
    switchId: first.mark.id,
    stripId: second.mark.id,
    pointTypeId: point.id,
  };
}

function linked(base) {
  const tied = setMarkControls(base.project, base.switchId, [base.stripId]);
  return { ...base, project: tied.project, scheme: tied.project.schemes[0] };
}

// ——— что считается связью ——————————————————————————————————————————————

test("связь идёт к середине линии, а не к её началу", () => {
  const base = scene();
  const strip = base.project.marks.find((mark) => mark.id === base.stripId);
  assert.deepEqual(markLinkAnchor(strip), { x: 0.7, y: 0.4 }, "лента должна ловить связь серединой");
  const point = base.project.marks.find((mark) => mark.id === base.switchId);
  assert.deepEqual(markLinkAnchor(point), { x: 0.2, y: 0.5 });
});

test("связь между двумя видимыми метками одной схемы попадает в кадр", () => {
  const base = linked(scene());
  const links = markLinks(base.project, base.scheme, null);
  assert.equal(links.lines.length, 1);
  assert.equal(links.lines[0].fromId, base.switchId);
  assert.equal(links.lines[0].toId, base.stripId);
  assert.deepEqual(links.lines[0].from, { x: 0.2, y: 0.5 });
  assert.deepEqual(links.lines[0].to, { x: 0.7, y: 0.4 });
  assert.deepEqual(links.offScheme, []);
});

// Линию через границу листа не провести. Промолчать тоже нельзя: пустота у
// метки читается как «эта ничем не управляет», а это неправда.
test("связь на другую схему линией не рисуется, но метка помечается обрывком", () => {
  const base = scene();
  const second = addScheme(base.project, { name: "2 этаж", width: PLAN.width, height: PLAN.height });
  const upstairs = addMark(second.project, {
    schemeId: second.scheme.id,
    typeId: base.pointTypeId,
    points: [{ x: 0.5, y: 0.5 }],
  });
  const tied = setMarkControls(upstairs.project, base.switchId, [base.stripId, upstairs.mark.id]);
  const scheme = tied.project.schemes.find((item) => item.id === base.schemeId);

  const links = markLinks(tied.project, scheme, null);
  assert.equal(links.lines.length, 1, "через границу листа линию провести нельзя");
  assert.equal(links.offScheme.length, 1);
  assert.equal(links.offScheme[0].markId, base.switchId);
  assert.equal(links.offScheme[0].count, 1);
  assert.deepEqual(links.offScheme[0].at, { x: 0.2, y: 0.5 });
});

// Фильтр — рука пользователя: он сам только что спрятал эти метки, и
// рассказывать ему о них обрывком незачем.
test("связь к метке, спрятанной фильтром, пропускается молча", () => {
  const base = linked(scene());
  const only = { categoryIds: null, typeIds: [base.pointTypeId], roomId: null, query: "" };
  const links = markLinks(base.project, base.scheme, only);
  assert.deepEqual(links.lines, [], "лента спрятана фильтром — рисовать нечего");
  assert.deepEqual(links.offScheme, [], "и обрывок тут был бы враньём: лента на этой же схеме");
});

// Проходная схема: В1 и ВП1 на одном Т1. Слова заказчика: «может быть связь не
// только выключатель-лампочка, но ещё и несколько дополнительных
// переключателей». Две дуги в одну метку обязаны разойтись, а не лечь друг на
// друга: разводит их `spread`, и считается он до всякого рисования.
test("несколько связей в одну метку получают разную очередь", () => {
  const base = scene();
  const second = addMark(base.project, {
    schemeId: base.schemeId,
    typeId: base.pointTypeId,
    points: [{ x: 0.2, y: 0.56 }],
  });
  const third = addMark(second.project, {
    schemeId: base.schemeId,
    typeId: base.pointTypeId,
    points: [{ x: 0.2, y: 0.62 }],
  });
  let project = setMarkControls(third.project, base.switchId, [base.stripId]).project;
  project = setMarkControls(project, second.mark.id, [base.stripId]).project;
  project = setMarkControls(project, third.mark.id, [base.stripId]).project;

  const links = markLinks(project, project.schemes[0], null);
  assert.equal(links.lines.length, 3);
  assert.deepEqual(
    links.lines.map((line) => line.spread).sort(),
    [0, 1, 2],
    "три дуги в одну метку с одинаковой очередью лягут друг на друга",
  );
});

// ——— промежуточный кадр ————————————————————————————————————————————————
//
// Дефект, ради которого написан этот тест, в сборке уже был — на направляющих
// (таск 68): кадр читал их прямо из состояния, а промежуточное положение
// переноса лежит в отдельном объекте, том же, что у меток. Итог при этом
// всегда верен, поэтому проверка «по объекту» дефект пропускает. Связь держится
// за метку обоими концами, и цена та же: дуга отстала бы от метки, которую в
// этот миг ведут мышью.
test("кадр берёт связи из промежуточного объекта, пока идёт перенос", () => {
  const base = linked(scene());
  const state = {
    project: base.project,
    linksShown: true,
    filter: null,
    selectedMarkIds: [],
  };

  // Переноса нет — кадр видит то же, что объект.
  assert.deepEqual(canvasFrameLinks(state, null, base.scheme).lines[0].from, { x: 0.2, y: 0.5 });

  // Идёт перенос выключателя: промежуточный объект — тот же, что у метки.
  const moving = {
    ...base.project,
    marks: base.project.marks.map((mark) => (mark.id === base.switchId ? { ...mark, points: [{ x: 0.35, y: 0.7 }] } : mark)),
  };
  const frame = canvasFrameLinks(state, moving, base.scheme);
  assert.deepEqual(
    frame.lines[0].from,
    { x: 0.35, y: 0.7 },
    "связь читает объект из состояния — на экране она отстанет от метки под рукой",
  );
  // И второй конец тоже: тащат ленту — дуга обязана ехать за ней.
  const movingStrip = {
    ...base.project,
    marks: base.project.marks.map((mark) =>
      mark.id === base.stripId
        ? {
            ...mark,
            points: [
              { x: 0.5, y: 0.1 },
              { x: 0.7, y: 0.1 },
            ],
          }
        : mark,
    ),
  };
  assert.deepEqual(canvasFrameLinks(state, movingStrip, base.scheme).lines[0].to, { x: 0.6, y: 0.1 });
});

// ——— два режима показа ————————————————————————————————————————————————
//
// Заказчик: «если связи не включены, то при выделении метки да, пусть
// показываются её связи, это удобно будет». Значит «выключено» — это не «не
// рисовать», а «только у выделенной».
test("переключатель выключен и ничего не выделено — связей нет", () => {
  const base = linked(scene());
  const off = canvasFrameLinks({ project: base.project, filter: null, selectedMarkIds: [] }, null, base.scheme);
  assert.deepEqual(off.lines, []);
  assert.deepEqual(off.offScheme, []);
});

test("переключатель выключен — видны связи выделенной метки, в обе стороны", () => {
  const base = scene();
  const other = addMark(base.project, {
    schemeId: base.schemeId,
    typeId: base.pointTypeId,
    points: [{ x: 0.4, y: 0.85 }],
  });
  const far = addMark(other.project, {
    schemeId: base.schemeId,
    typeId: base.pointTypeId,
    points: [{ x: 0.9, y: 0.85 }],
  });
  let project = setMarkControls(far.project, base.switchId, [base.stripId]).project;
  project = setMarkControls(project, other.mark.id, [far.mark.id]).project;
  const scheme = project.schemes[0];
  const state = { project, filter: null, linksShown: false };

  // Выделен управляющий — видна его связь, чужая не видна.
  const mine = canvasFrameLinks({ ...state, selectedMarkIds: [base.switchId] }, null, scheme);
  assert.deepEqual(
    mine.lines.map((line) => [line.fromId, line.toId]),
    [[base.switchId, base.stripId]],
  );

  // Выделен управляемый — вопрос «кто это включает» такой же законный.
  const theirs = canvasFrameLinks({ ...state, selectedMarkIds: [base.stripId] }, null, scheme);
  assert.equal(theirs.lines.length, 1);
  assert.equal(theirs.lines[0].fromId, base.switchId);

  // Включённый переключатель показывает всё.
  const all = canvasFrameLinks({ ...state, linksShown: true, selectedMarkIds: [base.switchId] }, null, scheme);
  assert.equal(all.lines.length, 2);
});

// Вид не должен прыгать на переключении: одна и та же дуга у одной и той же
// метки обязана лежать в обоих режимах одинаково. Держится это тем, что прогиб
// (`spread`) считается по всем связям схемы, а не по показанным.
test("дуга выделенной метки не прыгает при переключении режима", () => {
  const base = scene();
  const second = addMark(base.project, {
    schemeId: base.schemeId,
    typeId: base.pointTypeId,
    points: [{ x: 0.25, y: 0.75 }],
  });
  let project = setMarkControls(second.project, base.switchId, [base.stripId]).project;
  project = setMarkControls(project, second.mark.id, [base.stripId]).project;
  const scheme = project.schemes[0];
  const state = { project, filter: null, selectedMarkIds: [second.mark.id] };

  const narrow = canvasFrameLinks({ ...state, linksShown: false }, null, scheme).lines;
  const wide = canvasFrameLinks({ ...state, linksShown: true }, null, scheme).lines;
  const mine = wide.find((line) => line.fromId === second.mark.id);
  assert.equal(narrow.length, 1);
  assert.deepEqual(narrow[0], mine, "в узком режиме дуга считается иначе — на переключении она прыгнет");
});

// Заметность выделенному даётся порядком, а не другим цветом: цвет и толщина
// одни на оба режима, иначе одна дуга читалась бы как две разные вещи.
test("в общем режиме связи выделенной метки ложатся поверх остальных", () => {
  const base = scene();
  const second = addMark(base.project, {
    schemeId: base.schemeId,
    typeId: base.pointTypeId,
    points: [{ x: 0.25, y: 0.75 }],
  });
  let project = setMarkControls(second.project, base.switchId, [base.stripId]).project;
  project = setMarkControls(project, second.mark.id, [base.stripId]).project;
  const scheme = project.schemes[0];
  const frame = canvasFrameLinks(
    { project, filter: null, linksShown: true, selectedMarkIds: [second.mark.id] },
    null,
    scheme,
  );
  assert.equal(frame.lines.length, 2);
  assert.equal(frame.lines[frame.lines.length - 1].fromId, second.mark.id, "связь выделенной метки ушла под чужие");
});

// ——— чем связь отличается от метки-линии ————————————————————————————————

test("связь ведена дугой, а метка-линия — ломаной", () => {
  const base = linked(scene());
  const links = drawProbe();
  drawMarkLinks(links.ctx, markLinks(base.project, base.scheme, null), base.scheme, viewOf());
  const curved = links.strokes.filter((item) => item.curves > 0);
  assert.equal(curved.length, 1, "связь обязана быть дугой: ломаных на плане и так девять начертаний");

  const plan = drawProbe();
  drawScheme(plan.ctx, {
    project: base.project,
    scheme: base.scheme,
    image: null,
    filter: null,
    view: viewOf(),
    legend: false,
  });
  assert.equal(
    plan.strokes.filter((item) => item.curves > 0).length,
    0,
    "дуга появилась в самом чертеже — признак «это связь» перестал работать",
  );
});

test("связь тоньше метки и не толстеет с масштабом", () => {
  const base = linked(scene());
  const thin = (zoom) => {
    const probe = drawProbe();
    drawMarkLinks(probe.ctx, markLinks(base.project, base.scheme, null), base.scheme, viewOf({ zoom }));
    return probe.strokes.find((item) => item.curves > 0).width;
  };
  assert.equal(thin(1), thin(4), "связь растёт вместе с планом — на приближении она станет трассой");

  const probe = drawProbe();
  drawScheme(probe.ctx, {
    project: base.project,
    scheme: base.scheme,
    image: null,
    filter: null,
    view: viewOf({ zoom: 4 }),
    legend: false,
  });
  const thickest = probe.strokes.reduce((max, item) => Math.max(max, item.width), 0);
  assert.ok(thin(4) < thickest, "на приближении связь обязана остаться ниткой: " + thin(4) + " против " + thickest);
});

test("у связи свой служебный цвет и она полупрозрачна", () => {
  const base = linked(scene());
  const probe = drawProbe();
  drawMarkLinks(probe.ctx, markLinks(base.project, base.scheme, null), base.scheme, viewOf());
  const arc = probe.strokes.find((item) => item.curves > 0);
  const colors = new Set(base.project.categories.map((category) => String(category.color).toLowerCase()));
  assert.ok(!colors.has(String(arc.color).toLowerCase()), "цвет связи занят категорией — она прочтётся как метка");
  assert.ok(arc.alpha > 0 && arc.alpha < 1, "связь непрозрачна и перебьёт план");
});

test("у связи есть наконечник у управляемого и точка у управляющего", () => {
  const base = linked(scene());
  const probe = drawProbe();
  drawMarkLinks(probe.ctx, markLinks(base.project, base.scheme, null), base.scheme, viewOf());
  const dot = probe.fills.find((item) => item.arc);
  const head = probe.fills.find((item) => !item.arc && item.points.length === 3);
  assert.ok(dot, "у начала связи нет точки — с какого конца её читать, непонятно");
  assert.ok(head, "у конца связи нет наконечника — у метки-линии концы одинаковы, у связи не должны");
  // Наконечник ближе к ленте, точка — к выключателю: направление и есть
  // содержание связи.
  const from = { x: 0.2 * PLAN.width, y: 0.5 * PLAN.height };
  const to = { x: 0.7 * PLAN.width, y: 0.4 * PLAN.height };
  const near = (point, at) => Math.hypot(point.x - at.x, point.y - at.y);
  assert.ok(near(dot.arc, from) < near(dot.arc, to), "точка должна стоять у управляющей метки");
  assert.ok(near(head.points[0], to) < near(head.points[0], from), "стрелка должна смотреть на управляемую");
});

test("встречная пара расходится двумя луками — видны обе стрелки", () => {
  const base = scene();
  let project = setMarkControls(base.project, base.switchId, [base.stripId]).project;
  project = setMarkControls(project, base.stripId, [base.switchId]).project;
  const probe = drawProbe();
  drawMarkLinks(probe.ctx, markLinks(project, project.schemes[0], null), project.schemes[0], viewOf());
  const arcs = probe.strokes.filter((item) => item.curves > 0);
  assert.equal(arcs.length, 2);
  const chord = { x: (0.2 + 0.7) / 2 * PLAN.width, y: (0.5 + 0.4) / 2 * PLAN.height };
  const side = (arc) => Math.sign((arc.control.x - chord.x) * (0.4 - 0.5) - (arc.control.y - chord.y) * (0.7 - 0.2));
  assert.notEqual(side(arcs[0]), side(arcs[1]), "оба лука выгнулись в одну сторону и легли друг на друга");
});

// Та же проходная схема, но уже на холсте: три выключателя стоят рядом, и
// хорды у их дуг почти совпадают. Разводит их прогиб — без него три связи
// нарисовались бы одной линией.
test("три дуги в одну метку расходятся прогибом и наконечниками", () => {
  const base = scene();
  const second = addMark(base.project, {
    schemeId: base.schemeId,
    typeId: base.pointTypeId,
    points: [{ x: 0.2, y: 0.505 }],
  });
  const third = addMark(second.project, {
    schemeId: base.schemeId,
    typeId: base.pointTypeId,
    points: [{ x: 0.2, y: 0.51 }],
  });
  let project = setMarkControls(third.project, base.switchId, [base.stripId]).project;
  project = setMarkControls(project, second.mark.id, [base.stripId]).project;
  project = setMarkControls(project, third.mark.id, [base.stripId]).project;
  const scheme = project.schemes[0];

  const probe = drawProbe();
  drawMarkLinks(probe.ctx, markLinks(project, scheme, null), scheme, viewOf());
  const arcs = probe.strokes.filter((item) => item.curves > 0);
  assert.equal(arcs.length, 3);
  const apart = (a, b) => Math.hypot(a.control.x - b.control.x, a.control.y - b.control.y);
  assert.ok(apart(arcs[0], arcs[1]) > 8, "две дуги легли одна на другую: " + apart(arcs[0], arcs[1]));
  assert.ok(apart(arcs[1], arcs[2]) > 8, "две дуги легли одна на другую: " + apart(arcs[1], arcs[2]));
  // И наконечники садятся на разном отдалении от знака: три стрелки в одной
  // точке не сосчитать.
  const tips = arcs.map((arc) => arc.points[arc.points.length - 1]);
  const gap = Math.hypot(tips[0].x - tips[2].x, tips[0].y - tips[2].y);
  assert.ok(gap > 3, "наконечники сошлись в одну точку: " + gap);
});

test("обрывок «на другую схему» — знак с разрывом и стрелкой наружу", () => {
  const base = scene();
  const second = addScheme(base.project, { name: "2 этаж", width: PLAN.width, height: PLAN.height });
  const upstairs = addMark(second.project, {
    schemeId: second.scheme.id,
    typeId: base.pointTypeId,
    points: [{ x: 0.5, y: 0.5 }],
  });
  const tied = setMarkControls(upstairs.project, base.switchId, [upstairs.mark.id]);
  const scheme = tied.project.schemes.find((item) => item.id === base.schemeId);
  const probe = drawProbe();
  drawMarkLinks(probe.ctx, markLinks(tied.project, scheme, null), scheme, viewOf());
  const pieces = probe.strokes.filter((item) => item.points.length === 2);
  assert.equal(pieces.length, 2, "обрывок читается разрывом: два куска, а не один отрезок");
  assert.equal(probe.fills.filter((item) => item.points.length === 3).length, 1, "у обрывка нет стрелки");
});

// ——— чего в чертеже нет —————————————————————————————————————————————————

// Умолчание выгрузки — чертёж: связей на листе нет, пока их не попросили
// отметкой. Заказчик: «для печати надо галкой разрешать показ связей».
test("в выгрузке связей нет без отметки и есть с отметкой", () => {
  const base = linked(scene());
  const arcs = (links) => {
    const probe = drawProbe();
    drawScheme(probe.ctx, {
      project: base.project,
      scheme: base.scheme,
      image: null,
      filter: null,
      view: viewOf(),
      legend: false,
      links,
    });
    return probe.strokes.filter((item) => item.curves > 0);
  };
  assert.equal(arcs(undefined).length, 0, "связь попала на лист без отметки");
  assert.equal(arcs(false).length, 0, "снятая отметка связи не убрала");
  assert.equal(arcs(true).length, 1, "с отметкой связь на лист не попала");
});

// Холст передаёт готовый кадр, а не `true`: он считает связи из того же
// промежуточного объекта, что и метки. `drawScheme` обязан рисовать и то, и
// другое — иначе один из двух путей молча перестанет работать.
test("drawScheme рисует и готовый кадр связей, и посчитанный сам", () => {
  const base = linked(scene());
  const ready = canvasFrameLinks(
    { project: base.project, filter: null, linksShown: true, selectedMarkIds: [] },
    null,
    base.scheme,
  );
  const probe = drawProbe();
  drawScheme(probe.ctx, {
    project: base.project,
    scheme: base.scheme,
    image: null,
    filter: null,
    view: viewOf(),
    legend: false,
    links: ready,
  });
  assert.equal(probe.strokes.filter((item) => item.curves > 0).length, 1);
});

// ——— что панель говорит словами ————————————————————————————————————————

test("подсказка кнопки говорит и про второй режим, и про выгрузку", () => {
  assert.ok(linksHint(false).includes(strings.links.showHint));
  assert.ok(
    linksHint(false).includes(strings.links.scopeOff),
    "выключенная кнопка обязана сказать, что связи выделенной метки всё равно видны",
  );
  assert.ok(linksHint(true).includes(strings.links.scopeOn));
  assert.ok(linksHint(true).includes(strings.links.inExport), "про выгрузку сказать больше негде");
});

test("пустой план и связи на другие схемы не остаются без слов", () => {
  const empty = scene();
  assert.equal(linksNotice(empty.project, empty.scheme, null), strings.links.none);

  const base = linked(scene());
  assert.equal(linksNotice(base.project, base.scheme, null), null, "всё показано — говорить нечего");

  const second = addScheme(base.project, { name: "2 этаж", width: PLAN.width, height: PLAN.height });
  const upstairs = addMark(second.project, {
    schemeId: second.scheme.id,
    typeId: base.pointTypeId,
    points: [{ x: 0.5, y: 0.5 }],
  });
  const tied = setMarkControls(upstairs.project, base.switchId, [base.stripId, upstairs.mark.id]);
  const scheme = tied.project.schemes.find((item) => item.id === base.schemeId);
  const notice = linksNotice(tied.project, scheme, null);
  assert.ok(notice && notice.includes("1"), "сколько связей ушло на другие схемы — сказано числом: " + notice);
});

// ——— общее управление: отношение равных ————————————————————————————————
//
// Проходная схема: В1 и ВП1 оба управляют Т1 — значит они в одной цепи. Слова
// заказчика: «ещё надо бы сделать соединение между управляемыми устройствами
// (например выключатели и переключатели)». Направления у этого отношения нет,
// и полного графа быть не должно: трое дали бы три линии, шестеро пятнадцать.

// Сцена проходной схемы: три выключателя слева и один светильник справа.
function circuit() {
  const base = scene();
  const second = addMark(base.project, {
    schemeId: base.schemeId,
    typeId: base.pointTypeId,
    points: [{ x: 0.3, y: 0.7 }],
  });
  const third = addMark(second.project, {
    schemeId: base.schemeId,
    typeId: base.pointTypeId,
    points: [{ x: 0.1, y: 0.9 }],
  });
  let project = setMarkControls(third.project, base.switchId, [base.stripId]).project;
  project = setMarkControls(project, second.mark.id, [base.stripId]).project;
  project = setMarkControls(project, third.mark.id, [base.stripId]).project;
  return { ...base, project, scheme: project.schemes[0], ids: [base.switchId, second.mark.id, third.mark.id] };
}

test("метки, управляющие одним объектом, связаны между собой", () => {
  const base = linked(scene());
  const second = addMark(base.project, {
    schemeId: base.schemeId,
    typeId: base.pointTypeId,
    points: [{ x: 0.3, y: 0.7 }],
  });
  const project = setMarkControls(second.project, second.mark.id, [base.stripId]).project;
  const links = markLinks(project, project.schemes[0], null);
  assert.equal(links.ties.length, 1);
  const ids = [links.ties[0].fromId, links.ties[0].toId].sort();
  assert.deepEqual(ids, [base.switchId, second.mark.id].sort());
});

test("трое на одном объекте дают цепочку, а не каждого с каждым", () => {
  const base = circuit();
  const links = markLinks(base.project, base.scheme, null);
  assert.equal(links.ties.length, 2, "полный граф на троих — это три линии; должна быть цепочка из двух");
  // Цепь идёт слева направо: крайние в ней не соседи.
  const pairs = links.ties.map((tie) => [tie.fromId, tie.toId]);
  const seen = new Map();
  for (const [a, b] of pairs) {
    seen.set(a, (seen.get(a) || 0) + 1);
    seen.set(b, (seen.get(b) || 0) + 1);
  }
  assert.deepEqual([...seen.values()].sort(), [1, 1, 2], "это не цепочка: у звеньев не те степени");
});

test("одна пара не удваивается, управляй они хоть двумя объектами", () => {
  const base = scene();
  const second = addMark(base.project, {
    schemeId: base.schemeId,
    typeId: base.pointTypeId,
    points: [{ x: 0.3, y: 0.7 }],
  });
  const lamp = addMark(second.project, {
    schemeId: base.schemeId,
    typeId: base.pointTypeId,
    points: [{ x: 0.9, y: 0.7 }],
  });
  let project = setMarkControls(lamp.project, base.switchId, [base.stripId, lamp.mark.id]).project;
  project = setMarkControls(project, second.mark.id, [base.stripId, lamp.mark.id]).project;
  assert.equal(markLinks(project, project.schemes[0], null).ties.length, 1);
});

// Цепь остаётся цепью, даже если сам светильник спрятан фильтром или лежит на
// другом этаже: выключатель с переключателем связаны друг с другом, а не через
// видимость подопечного.
test("общая цепь не зависит от того, виден ли подопечный", () => {
  const base = scene();
  const upstairs = addScheme(base.project, { name: "2 этаж", width: PLAN.width, height: PLAN.height });
  const lamp = addMark(upstairs.project, {
    schemeId: upstairs.scheme.id,
    typeId: base.pointTypeId,
    points: [{ x: 0.5, y: 0.5 }],
  });
  const second = addMark(lamp.project, {
    schemeId: base.schemeId,
    typeId: base.pointTypeId,
    points: [{ x: 0.3, y: 0.7 }],
  });
  let project = setMarkControls(second.project, base.switchId, [lamp.mark.id]).project;
  project = setMarkControls(project, second.mark.id, [lamp.mark.id]).project;
  const scheme = project.schemes.find((item) => item.id === base.schemeId);
  const links = markLinks(project, scheme, null);
  assert.equal(links.ties.length, 1, "светильник на другом этаже, а цепь между выключателями всё та же");
  assert.equal(links.lines.length, 0, "линию через границу листа не провести");
});

// ——— общий номер: тождество ————————————————————————————————————————————
//
// «Ещё между метками с одной меткой. Например группа светильников Т16». Это не
// отношение, а одна сущность, разнесённая по потолку, — и рисуется она не
// линией, а оболочкой. Полного графа тут нет по устройству: оболочка одна на
// всю группу, сколько бы меток в неё ни входило.

// Шесть светильников с одним номером — тот самый случай, ради которого
// оболочка и выбрана вместо линий.
function ceiling(count = 6) {
  const base = scene();
  let project = base.project;
  const ids = [];
  const type = project.markTypes.find((item) => item.code === "Т");
  for (let index = 0; index < count; index += 1) {
    const made = addMark(project, {
      schemeId: base.schemeId,
      typeId: type.id,
      points: [{ x: 0.3 + (index % 3) * 0.12, y: 0.6 + Math.floor(index / 3) * 0.14 }],
    });
    project = made.project;
    ids.push(made.mark.id);
  }
  // Все шесть под одним номером — намеренный повтор, приём заказчика.
  for (const id of ids.slice(1)) project = setMarkNumber(project, id, 16).project;
  project = setMarkNumber(project, ids[0], 16).project;
  return { ...base, project, scheme: project.schemes[0], ids, typeId: type.id };
}

test("метки с одним номером собираются в одну оболочку, а не в сеть линий", () => {
  const base = ceiling(6);
  const links = markLinks(base.project, base.scheme, null);
  assert.equal(links.groups.length, 1, "шесть светильников — одна группа");
  assert.equal(links.groups[0].markIds.length, 6);
  assert.equal(links.groups[0].label, "Т16");
  assert.equal(links.ties.length, 0, "общий номер — не общее управление");
  assert.equal(links.lines.length, 0);
});

test("непарный номер группы не заводит", () => {
  const base = scene();
  assert.deepEqual(markLinks(base.project, base.scheme, null).groups, []);
});

test("одинаковый номер у разных типов — это разные сущности", () => {
  const base = scene();
  const lamp = base.project.markTypes.find((item) => item.code === "Т");
  const first = addMark(base.project, { schemeId: base.schemeId, typeId: lamp.id, points: [{ x: 0.4, y: 0.4 }] });
  const project = setMarkNumber(first.project, first.mark.id, 1).project;
  // У выключателя В1 из сцены номер тоже 1, но тип другой.
  assert.deepEqual(markLinks(project, project.schemes[0], null).groups, []);
});

// ——— оболочка обходит метки, а не режет их ——————————————————————————————

test("оболочка двух меток — капсула, шести — замкнутый обход", () => {
  const pair = linkHullOutline(
    [
      { x: 100, y: 100 },
      { x: 300, y: 100 },
    ],
    20,
  );
  assert.ok(pair.length >= 8, "капсула вышла слишком грубой: " + pair.length);
  const box = (points) => ({
    left: Math.min(...points.map((p) => p.x)),
    right: Math.max(...points.map((p) => p.x)),
    top: Math.min(...points.map((p) => p.y)),
    bottom: Math.max(...points.map((p) => p.y)),
  });
  const around = box(pair);
  assert.ok(around.left <= 80.5 && around.right >= 319.5, "капсула не обошла метки: " + JSON.stringify(around));
  assert.ok(around.top <= 80.5 && around.bottom >= 119.5, "капсула не обошла метки по высоте");

  // Каждая метка группы обязана оказаться внутри оболочки — иначе линия режет
  // знак, и «это одно и то же» читаться перестаёт.
  const marks = [
    { x: 100, y: 100 },
    { x: 260, y: 90 },
    { x: 400, y: 160 },
    { x: 330, y: 300 },
    { x: 150, y: 280 },
    { x: 90, y: 200 },
  ];
  const outline = linkHullOutline(marks, 18);
  for (const mark of marks) {
    assert.ok(pointInPolygon(mark, outline), "метка оказалась снаружи оболочки: " + JSON.stringify(mark));
  }
  // И запас от знака есть: точка в полутора десятках пикселей за меткой наружу
  // всё ещё под оболочкой.
  assert.ok(pointInPolygon({ x: 90 - 12, y: 200 }, outline), "оболочка прошла вплотную по знаку");
});

test("выпуклая оболочка отбрасывает внутренние точки и не путается в прямой", () => {
  const hull = convexHull([
    { x: 0, y: 0 },
    { x: 10, y: 10 },
    { x: 20, y: 0 },
    { x: 10, y: 20 },
  ]);
  assert.equal(hull.length, 3, "точка внутри треугольника попала в оболочку");
  const line = convexHull([
    { x: 0, y: 0 },
    { x: 5, y: 5 },
    { x: 10, y: 10 },
  ]);
  assert.equal(line.length, 2, "три точки на одной прямой — это отрезок, а не многоугольник");
});

// ——— чем новые роды отличаются от управления и друг от друга ——————————————

test("у цепи равных нет ни стрелки, ни точки — и она прямая", () => {
  const base = scene();
  const second = addMark(base.project, {
    schemeId: base.schemeId,
    typeId: base.pointTypeId,
    points: [{ x: 0.3, y: 0.7 }],
  });
  const project = setMarkControls(
    setMarkControls(second.project, base.switchId, [base.stripId]).project,
    second.mark.id,
    [base.stripId],
  ).project;
  const scheme = project.schemes[0];

  const only = { lines: [], ties: markLinks(project, scheme, null).ties, groups: [], offScheme: [] };
  const probe = drawProbe();
  drawMarkLinks(probe.ctx, only, scheme, viewOf());
  assert.equal(probe.strokes.filter((item) => item.curves > 0).length, 0, "связь равных выгнулась дугой");
  assert.deepEqual(probe.fills, [], "у связи равных появился наконечник или точка — это знак направления");
  // Сама линия и две засечки на концах.
  assert.equal(probe.strokes.length, 3, "засечек на концах не видно: " + probe.strokes.length);
  const [line, first, last] = probe.strokes;
  const along = { x: line.points[1].x - line.points[0].x, y: line.points[1].y - line.points[0].y };
  for (const tick of [first, last]) {
    const across = { x: tick.points[1].x - tick.points[0].x, y: tick.points[1].y - tick.points[0].y };
    const dot = along.x * across.x + along.y * across.y;
    assert.ok(Math.abs(dot) < 1e-6, "засечка не поперёк линии");
  }
});

test("оболочка бледнее и тоньше связей и ведена пунктиром", () => {
  const base = ceiling(4);
  const links = markLinks(base.project, base.scheme, null);
  const probe = drawProbe();
  drawMarkLinks(probe.ctx, links, base.scheme, viewOf());
  const hull = probe.strokes.find((item) => item.points.length > 8);
  assert.ok(hull, "оболочка не нарисована");
  assert.deepEqual(hull.dash, [5, 4], "оболочка ведена сплошной — тождество перепутается с отношением");

  // Против управления: там сплошная, толще и ярче.
  const control = linked(scene());
  const other = drawProbe();
  drawMarkLinks(other.ctx, markLinks(control.project, control.scheme, null), control.scheme, viewOf());
  const arc = other.strokes.find((item) => item.curves > 0);
  assert.ok(hull.width < arc.width, "оболочка не тоньше управления");
  assert.ok(hull.alpha < arc.alpha, "оболочка не бледнее управления");
  assert.deepEqual(arc.dash, [], "управление стало пунктирным");
});

// ——— кадр и выделение ——————————————————————————————————————————————————

test("выделенная метка показывает свою цепь и свою группу целиком", () => {
  const base = ceiling(4);
  const links = markLinks(base.project, base.scheme, null);
  assert.equal(links.groups[0].markIds.length, 4, "пример не тот");
  const frame = canvasFrameLinks(
    { project: base.project, filter: null, linksShown: false, selectedMarkIds: [base.ids[2]] },
    null,
    base.scheme,
  );
  assert.equal(frame.groups.length, 1);
  assert.equal(frame.groups[0].markIds.length, 4, "показана половина группы — это неправда про тождество");
});

test("кадр берёт цепь и оболочку из промежуточного объекта, пока идёт перенос", () => {
  const base = ceiling(3);
  const state = { project: base.project, filter: null, linksShown: true, selectedMarkIds: [] };
  const moved = {
    ...base.project,
    marks: base.project.marks.map((mark) => (mark.id === base.ids[0] ? { ...mark, points: [{ x: 0.9, y: 0.1 }] } : mark)),
  };
  const frame = canvasFrameLinks(state, moved, base.scheme);
  const group = frame.groups[0];
  const index = group.markIds.indexOf(base.ids[0]);
  assert.deepEqual(group.points[index], { x: 0.9, y: 0.1 }, "оболочка читает объект из состояния и отстанет от метки");

  const chain = circuit();
  const chainState = { project: chain.project, filter: null, linksShown: true, selectedMarkIds: [] };
  const chainMoved = {
    ...chain.project,
    marks: chain.project.marks.map((mark) => (mark.id === chain.ids[0] ? { ...mark, points: [{ x: 0.05, y: 0.05 }] } : mark)),
  };
  const ties = canvasFrameLinks(chainState, chainMoved, chain.scheme).ties;
  const touching = ties.filter((tie) => tie.fromId === chain.ids[0] || tie.toId === chain.ids[0]);
  assert.ok(touching.length > 0, "пример не тот: метка должна быть в цепи");
  for (const tie of touching) {
    const end = tie.fromId === chain.ids[0] ? tie.from : tie.to;
    assert.deepEqual(end, { x: 0.05, y: 0.05 }, "цепь отстала от метки под рукой");
  }
});

// ——— другие схемы: тем же способом, а не третьим ————————————————————————

test("собеседник любого рода с другой схемы даёт один обрывок, а не три", () => {
  const base = scene();
  const upstairs = addScheme(base.project, { name: "2 этаж", width: PLAN.width, height: PLAN.height });
  // Наверху: подопечный, напарник по цепи и тёзка по номеру.
  const lamp = addMark(upstairs.project, {
    schemeId: upstairs.scheme.id,
    typeId: base.pointTypeId,
    points: [{ x: 0.5, y: 0.5 }],
  });
  const mate = addMark(lamp.project, {
    schemeId: upstairs.scheme.id,
    typeId: base.pointTypeId,
    points: [{ x: 0.6, y: 0.5 }],
  });
  let project = setMarkControls(mate.project, base.switchId, [lamp.mark.id]).project;
  project = setMarkControls(project, mate.mark.id, [lamp.mark.id]).project;
  // И тёзка: тот же тип, тот же номер, что у В1.
  const twin = addMark(project, {
    schemeId: upstairs.scheme.id,
    typeId: base.pointTypeId,
    points: [{ x: 0.7, y: 0.5 }],
  });
  project = twin.project;
  const number = project.marks.find((mark) => mark.id === base.switchId).number;
  project = setMarkNumber(project, twin.mark.id, number).project;

  const scheme = project.schemes.find((item) => item.id === base.schemeId);
  const links = markLinks(project, scheme, null);
  assert.equal(links.offScheme.length, 1, "обрывок у метки один, сколько бы родов связи через границу ни ушло");
  assert.equal(links.offScheme[0].markId, base.switchId);
  assert.equal(links.offScheme[0].count, 3, "подопечный, напарник и тёзка — три собеседника");
  assert.deepEqual(links.groups, [], "группа из одной метки — не группа");
  assert.deepEqual(links.ties, [], "цепь из одной метки — не цепь");
});

// Отметка в выгрузке одна на все три рода: «Со связями меток» — это и дуги, и
// цепь равных, и оболочка. Трёх отметок в диалоге быть не должно.
test("отметка выгрузки поднимает все три рода разом", () => {
  const base = ceiling(4);
  const second = addMark(base.project, {
    schemeId: base.schemeId,
    typeId: base.pointTypeId,
    points: [{ x: 0.12, y: 0.2 }],
  });
  let project = setMarkControls(second.project, base.switchId, [base.stripId]).project;
  project = setMarkControls(project, second.mark.id, [base.stripId]).project;
  const scheme = project.schemes[0];
  const sheet = (links) => {
    const probe = drawProbe();
    drawScheme(probe.ctx, { project, scheme, image: null, filter: null, view: viewOf(), legend: false, links });
    return {
      arcs: probe.strokes.filter((item) => item.curves > 0).length,
      hulls: probe.strokes.filter((item) => item.dash && item.dash.length > 0 && item.points.length > 8).length,
      ticks: probe.strokes.filter((item) => item.points.length === 2 && item.dash && item.dash.length === 0).length,
    };
  };
  const without = sheet(undefined);
  assert.equal(without.arcs, 0, "связь попала на лист без отметки");
  assert.equal(without.hulls, 0, "оболочка попала на лист без отметки");
  const with_ = sheet(true);
  assert.ok(with_.arcs > 0, "дуг управления на листе нет");
  assert.equal(with_.hulls, 1, "оболочки на листе нет");
  assert.ok(with_.ticks > without.ticks, "цепи равных на листе нет");
});
