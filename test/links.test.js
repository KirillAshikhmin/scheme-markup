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

import { addMark, addScheme, createProject, setMarkControls } from "../src/model.js";
import { canvasFrameLinks } from "../src/canvas.js";
import { drawMarkLinks, drawScheme, markLinkAnchor, markLinks } from "../src/render.js";
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
    stroke() {
      if (path) {
        strokes.push({ ...path, width: impl.lineWidth, alpha: impl.globalAlpha, color: impl.strokeStyle });
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
