// Линейка по бокам холста и направляющие, которые ставит пользователь.
//
// Заказчик: «надо поставить в линию по 6 точечных светильников 2 в ряд —
// поставил 2 горизонтальных направляющих, 6 вертикальных и на перекрестия
// ставишь точки». Отсюда три вещи, которые проверяются здесь: направляющая
// живёт у схемы в долях плана, притяжка считается в пикселях экрана, а
// перекрестие двух направляющих ловит шире одиночной.
//
// И главное про порядок: после этой задачи притягивают три источника — свои
// направляющие, направляющие по вершинам ломаной и углы кратно 15°. Правило
// одно: занятую ось не двигает никто, старшинство сверху вниз, рука
// пользователя первая.
import test from "node:test";
import assert from "node:assert/strict";

import {
  addMark,
  addSchemeGuide,
  addScheme,
  createProject,
  deleteSchemeGuide,
  moveSchemeGuide,
  replaceSchemeImage,
  schemeGuides,
} from "../src/model.js";
import { packProject, unpackProject } from "../src/projectFile.js";
import { canvasDraftPoint, canvasFrameGuides } from "../src/canvas.js";
import {
  GUIDE_CROSS_PX,
  GUIDE_HIT_PX,
  RULER_SIZE,
  drawScheme,
  drawSchemeGuides,
  guideFraction,
  hitSchemeGuide,
  rulerAxis,
  rulerStep,
  rulerTicks,
  draftSnap,
  snapToSchemeGuides,
} from "../src/render.js";

const PLAN = { width: 1000, height: 500 };
const viewOf = (patch) => ({ zoom: 1, offsetX: 0, offsetY: 0, markSize: 10, labelSize: 12, ...patch });
const BOX = { width: 900, height: 600 };

function scene() {
  const made = addScheme(createProject(), { name: "1 этаж", width: PLAN.width, height: PLAN.height });
  return { project: made.project, schemeId: made.scheme.id, scheme: made.project.schemes[0] };
}

// Направляющие: горизонтальная на 0,4 высоты и вертикальная на 0,3 ширины.
function withGuides(base) {
  const first = addSchemeGuide(base.project, base.schemeId, { axis: "h", at: 0.4 });
  const second = addSchemeGuide(first.project, base.schemeId, { axis: "v", at: 0.3 });
  return {
    project: second.project,
    scheme: second.project.schemes[0],
    schemeId: base.schemeId,
    guides: schemeGuides(second.project, base.schemeId),
  };
}

test("направляющая живёт у схемы и в долях плана", () => {
  const base = scene();
  const added = addSchemeGuide(base.project, base.schemeId, { axis: "v", at: 0.25 });
  assert.equal(schemeGuides(added.project, base.schemeId).length, 1);
  assert.deepEqual(
    schemeGuides(added.project, base.schemeId).map((guide) => [guide.axis, guide.at]),
    [["v", 0.25]],
  );
  // Объект чистый: прежний снимок не тронут.
  assert.deepEqual(schemeGuides(base.project, base.schemeId), []);

  const moved = moveSchemeGuide(added.project, base.schemeId, added.guide.id, 0.8).project;
  assert.equal(schemeGuides(moved, base.schemeId)[0].at, 0.8);
  // За края плана направляющая не уходит: её там не видно, а искать её потом
  // пришлось бы за обрезом.
  assert.equal(schemeGuides(moveSchemeGuide(moved, base.schemeId, added.guide.id, 1.7).project, base.schemeId)[0].at, 1);
  assert.equal(schemeGuides(moveSchemeGuide(moved, base.schemeId, added.guide.id, -3).project, base.schemeId)[0].at, 0);

  const gone = deleteSchemeGuide(moved, base.schemeId, added.guide.id).project;
  assert.deepEqual(schemeGuides(gone, base.schemeId), []);
  assert.throws(() => deleteSchemeGuide(gone, base.schemeId, added.guide.id), { code: "guideNotFound" });
  assert.throws(() => addSchemeGuide(gone, base.schemeId, { axis: "вбок", at: 0.5 }), { code: "guideAxisUnknown" });
});

// Доли, а не пиксели (ADR 002): замена подложки меняет размер плана, и
// направляющие обязаны остаться там же, где их поставили.
test("замена подложки не двигает направляющие", () => {
  const base = withGuides(scene());
  const scaled = replaceSchemeImage(base.project, base.schemeId, { imageId: "big", width: 2000, height: 1500 }).project;
  assert.deepEqual(
    schemeGuides(scaled, base.schemeId).map((guide) => [guide.axis, guide.at]),
    [
      ["h", 0.4],
      ["v", 0.3],
    ],
  );
});

// G68: у схем прежней разметки поля нет вовсе, и это не ошибка.
test("схема прежней разметки открывается без направляющих", async () => {
  const base = withGuides(scene());
  const legacy = {
    ...base.project,
    schemes: base.project.schemes.map(({ guides, ...rest }) => rest),
  };
  assert.deepEqual(schemeGuides(legacy, base.schemeId), []);
  // И через файл проекта — тоже: пустой список не ошибка, а «их просто нет».
  const restored = (await unpackProject(await packProject(legacy, new Map()))).project;
  assert.deepEqual(schemeGuides(restored, base.schemeId), []);

  // А поставленные — уезжают с файлом и возвращаются теми же.
  const saved = (await unpackProject(await packProject(base.project, new Map()))).project;
  assert.deepEqual(
    schemeGuides(saved, base.schemeId).map((guide) => [guide.axis, guide.at]),
    [
      ["h", 0.4],
      ["v", 0.3],
    ],
  );
});

test("шаг линейки растёт и мельчает вместе с масштабом, а деления стоят на местах плана", () => {
  // Шаг — «круглый»: 1, 2, 5 и их десятки, иначе деления читаются как случайные.
  for (const zoom of [0.1, 0.25, 0.5, 1, 2, 4, 8]) {
    const step = rulerStep(zoom);
    assert.ok([1, 2, 5].includes(Number(String(step)[0])), "шаг не круглый: " + step);
    assert.ok(step * zoom >= 48, "деления на экране гуще предела: " + step * zoom);
  }
  assert.ok(rulerStep(0.2) > rulerStep(4), "при мелком масштабе шаг обязан быть крупнее");

  // Деление соответствует одному и тому же месту плана на любом масштабе.
  const at = (zoom, offset) => rulerTicks(PLAN, viewOf({ zoom, offsetX: offset }), BOX).top;
  const plain = at(1, 0).find((tick) => tick.at === 100);
  assert.equal(plain.screen, 100);
  const zoomed = at(2, 40).find((tick) => tick.at === 100);
  assert.equal(zoomed.screen, 40 + 200);
  // За края плана деления не ставятся: линейка меряет план, а не пустое поле.
  assert.ok(at(1, 0).every((tick) => tick.at >= 0 && tick.at <= PLAN.width));
  assert.ok(RULER_SIZE > 0);
});

test("перекрестие ловит шире одиночной направляющей", () => {
  const base = withGuides(scene());
  const view = viewOf();
  // Одна направляющая: порог обычный.
  const near = snapToSchemeGuides(base.guides, { x: 0.8, y: 0.4 + (GUIDE_HIT_PX - 1) / PLAN.height }, PLAN, view);
  assert.equal(near.point.y, 0.4, "одиночная направляющая не поймала курсор рядом");
  assert.equal(near.point.x, 0.8, "поймала не свою ось");
  const far = snapToSchemeGuides(base.guides, { x: 0.8, y: 0.4 + (GUIDE_HIT_PX + 3) / PLAN.height }, PLAN, view);
  assert.notEqual(far.point.y, 0.4, "одиночная направляющая тянет дальше своего порога");

  // Перекрестие: обе оси ловятся с расстояния, на котором одиночная уже молчит.
  const gap = (GUIDE_HIT_PX + GUIDE_CROSS_PX) / 2;
  const cross = snapToSchemeGuides(
    base.guides,
    { x: 0.3 + gap / PLAN.width, y: 0.4 + gap / PLAN.height },
    PLAN,
    view,
  );
  assert.equal(cross.point.x, 0.3, "перекрестие не поймало по горизонтали");
  assert.equal(cross.point.y, 0.4, "перекрестие не поймало по вертикали");
  assert.ok(gap > GUIDE_HIT_PX, "пример не тот: на этом расстоянии одиночная и должна молчать");
});

test("порог притяжки — в пикселях экрана и одинаков на любом зуме", () => {
  const base = withGuides(scene());
  for (const zoom of [0.5, 1, 3]) {
    const view = viewOf({ zoom });
    const off = (px) => 0.4 + px / (PLAN.height * zoom);
    const hit = snapToSchemeGuides(base.guides, { x: 0.8, y: off(GUIDE_HIT_PX - 1) }, PLAN, view);
    assert.equal(hit.point.y, 0.4, "на зуме " + zoom + " притяжка не сработала");
    const miss = snapToSchemeGuides(base.guides, { x: 0.8, y: off(GUIDE_HIT_PX + 3) }, PLAN, view);
    assert.notEqual(miss.point.y, 0.4, "на зуме " + zoom + " притянуло слишком далёкий курсор");
  }
});

test("направляющая ловится под рукой и переводится обратно в долю плана", () => {
  const base = withGuides(scene());
  const view = viewOf();
  const horizontal = base.guides.find((guide) => guide.axis === "h");
  // Точка взята подальше от вертикальной направляющей: иначе ближе окажется она.
  assert.equal(hitSchemeGuide(base.guides, { x: 600, y: 200 + GUIDE_HIT_PX - 1 }, PLAN, view), horizontal);
  assert.equal(hitSchemeGuide(base.guides, { x: 600, y: 200 + GUIDE_HIT_PX + 4 }, PLAN, view), null);
  // Экранная координата и доля плана переводятся друг в друга без потерь.
  assert.ok(Math.abs(guideFraction("h", 200, PLAN, view) - 0.4) < 1e-9);
  assert.ok(Math.abs(guideFraction("v", 300, PLAN, viewOf({ zoom: 2, offsetX: 50 })) - (300 - 50) / 2000) < 1e-9);
});

// Порядок разрешения споров — один на все три источника притяжки.
test("рука пользователя старше подсказки программы, а угол — самый младший", () => {
  const base = withGuides(scene());
  const view = viewOf();
  // Ломаная идёт от (0,2; 0,2) вправо; своя вертикальная направляющая на 0,3.
  const points = [{ x: 0.1, y: 0.2 }, { x: 0.2, y: 0.2 }];
  // Курсор почти на направляющей и почти горизонтально от последней вершины.
  const cursor = { x: 0.3 + 2 / PLAN.width, y: 0.2 + 5 / PLAN.height };
  const snap = draftSnap(points, cursor, PLAN, view, { planGuides: base.guides });

  assert.equal(snap.point.x, 0.3, "своя направляющая не удержала ось");
  assert.equal(snap.point.y, 0.2, "угол не довёл свободную ось до горизонтали");
  assert.equal(snap.angle, 0);
  assert.ok(snap.held.v, "не сказано, какая направляющая сработала");

  // Спор: направляющая пользователя держит ось, косой угол её не трогает.
  const slanted = draftSnap(points, { x: 0.3 + 1 / PLAN.width, y: 0.35 }, PLAN, view, { planGuides: base.guides });
  assert.equal(slanted.point.x, 0.3, "косой магнит сдвинул точку с направляющей пользователя");

  // Без своих направляющих правило прежнее: магнит доводит до ровного угла.
  const plain = draftSnap(points, cursor, PLAN, view, {});
  assert.equal(plain.point.y, 0.2);
  assert.notEqual(plain.point.x, 0.3, "без направляющих ось держать нечем");
});

// Первая вершина ломаной и контура. Магнита угла у неё нет и быть не может —
// тянуть её не от чего, — но направляющие пользователя к этому отношения не
// имеют: они нарисованы на плане ещё до первого клика, и приём заказчика
// начинается как раз с первой точки. Пока пустой черновик выходил раньше, чем
// дело доходило до `draftSnap`, она садилась под сырой курсор: промах до порога
// перекрестия, и увидеть его нечем — предпросмотра до первого клика нет.
test("первая вершина садится на перекрестие так же, как все следующие", () => {
  const base = withGuides(scene());
  const view = viewOf();
  // Мимо перекрестия на 12 px по обеим осям: дальше порога одиночной
  // направляющей и ближе порога перекрестия — ровно тот промах, который
  // пользователь считает попаданием.
  const gap = 12;
  assert.ok(gap > GUIDE_HIT_PX && gap < GUIDE_CROSS_PX, "пример не тот: " + gap);
  const miss = { x: 0.3 + gap / PLAN.width, y: 0.4 + gap / PLAN.height };

  const first = canvasDraftPoint(null, miss, PLAN, view, { planGuides: base.guides });
  assert.equal(first.point.x, 0.3, "первая вершина не села на вертикальную направляющую");
  assert.equal(first.point.y, 0.4, "первая вершина не села на горизонтальную направляющую");
  // Пустой черновик — то же самое: дверь одна.
  assert.deepEqual(canvasDraftPoint({ points: [] }, miss, PLAN, view, { planGuides: base.guides }).point, first.point);
  // Магнит угла у неё по-прежнему молчит: угла нет, пока нет предыдущей вершины.
  assert.equal(first.angle, 0);
  assert.equal(first.snapped, false);
  assert.deepEqual(first.guides, []);

  // Alt — свободная рука, и первая вершина слушается его так же, как остальные.
  const free = canvasDraftPoint(null, miss, PLAN, view, { planGuides: base.guides, free: true });
  assert.deepEqual(free.point, miss);
  // Направляющих нет вовсе — первой вершине садиться не на что, и это не ошибка.
  assert.deepEqual(canvasDraftPoint(null, miss, PLAN, view, {}).point, miss);

  // Остальные пути притяжки не изменились: у второй вершины работает и
  // направляющая пользователя, и магнит угла.
  const next = canvasDraftPoint({ points: [{ x: 0.1, y: 0.4 }] }, miss, PLAN, view, { planGuides: base.guides });
  assert.equal(next.point.x, 0.3);
  assert.equal(next.point.y, 0.4);
});

test("свободная рука снимает и направляющие пользователя", () => {
  const base = withGuides(scene());
  const cursor = { x: 0.3 + 2 / PLAN.width, y: 0.4 + 2 / PLAN.height };
  const free = draftSnap([{ x: 0.1, y: 0.1 }], cursor, PLAN, viewOf(), { planGuides: base.guides, free: true });
  assert.deepEqual(free.point, cursor);
  assert.deepEqual(free.held, { h: null, v: null });
});

// Холста в тестах нет: рисованию подставляется заглушка, которая записывает
// только штрихи. Тот же приём, что у отпечатка направляющих черновика.
const strokeProbe = () => {
  const seen = [];
  let path = null;
  const impl = {
    canvas: { width: BOX.width, height: BOX.height },
    getTransform: () => ({ a: 1 }),
    measureText: (value) => ({ width: String(value).length * 7 }),
    beginPath: () => {
      path = [];
    },
    moveTo: (x, y) => path && path.push({ x, y }),
    lineTo: (x, y) => path && path.push({ x, y }),
    stroke: () => {
      if (path && path.length === 2) seen.push({ from: path[0], to: path[1] });
      path = null;
    },
  };
  return {
    seen,
    ctx: new Proxy(impl, { get: (object, key) => (key in object ? object[key] : () => {}), set: () => true }),
  };
};

// Направляющие — вспомогательное, а не часть чертежа: на распечатке у
// монтажника им делать нечего. `drawScheme` о них не знает вовсе, и это не
// договорённость, а устройство: рисует их только холст.
test("направляющих нет в том, что уходит в PNG, в печать и в лист «Схема»", () => {
  const base = withGuides(scene());
  const added = addMark(base.project, {
    schemeId: base.schemeId,
    typeId: base.project.markTypes[0].id,
    points: [{ x: 0.5, y: 0.5 }],
  });
  const scheme = added.project.schemes[0];
  assert.equal(schemeGuides(added.project, base.schemeId).length, 2, "пример не тот: направляющие должны быть");

  const paper = strokeProbe();
  drawScheme(paper.ctx, {
    project: added.project,
    scheme,
    image: null,
    filter: null,
    view: viewOf(),
    legend: false,
  });
  const across = paper.seen.filter(
    (line) => Math.abs(line.from.x - line.to.x) > BOX.width * 0.8 || Math.abs(line.from.y - line.to.y) > BOX.height * 0.8,
  );
  assert.deepEqual(across, [], "через весь лист прошла линия — похоже на направляющую");

  // А холст их рисует — значит заглушка их видит, и проверка выше не пустая.
  const screen = strokeProbe();
  drawSchemeGuides(screen.ctx, base.guides, scheme, viewOf(), BOX);
  assert.equal(screen.seen.length, 2, "холст не нарисовал направляющие");
});

// Заказчик: «по вертикальной линейке горизонтальную линию, а по горизонтальной
// — вертикальную». В тикете 59 это было записано наоборот, и перетаскивание
// работало зеркально — правило считает `rulerAxis`, и оно одно на
// перетаскивание и на двойной клик.
test("левая линейка даёт горизонтальную направляющую, верхняя — вертикальную", () => {
  // Верхняя полоса: клик где угодно по ширине ставит вертикальную.
  assert.equal(rulerAxis({ x: 300, y: 4 }), "v");
  assert.equal(rulerAxis({ x: 300, y: RULER_SIZE }), "v");
  // Левая полоса: горизонтальную.
  assert.equal(rulerAxis({ x: 4, y: 300 }), "h");
  assert.equal(rulerAxis({ x: RULER_SIZE, y: 300 }), "h");
  // Угол, где полосы сходятся, отдан верхней — решать его пополам было бы
  // гаданием.
  assert.equal(rulerAxis({ x: 3, y: 3 }), "v");
  // Сам план линейке не принадлежит.
  assert.equal(rulerAxis({ x: RULER_SIZE + 1, y: RULER_SIZE + 1 }), null);
  assert.equal(rulerAxis(null), null);
});

// ——— что уходит в кадр ————————————————————————————————————————————————
//
// Дефект, ради которого этот тест написан: направляющую под рукой было видно
// толще, но за курсором она не ехала — прыгала на место только по отпусканию.
// Причина — кадр читал направляющие прямо из состояния, а промежуточное
// положение переноса лежит в отдельном объекте, том же, что у меток. Итоговое
// положение при этом было верным, поэтому проверка «по объекту» дефект и
// пропустила: смотреть надо на то, что холст отдаёт кадру.
test("кадр берёт направляющие из промежуточного объекта, пока идёт перенос", () => {
  const base = withGuides(scene());
  const scheme = base.scheme;
  const state = { project: base.project, guidesShown: true };
  const horizontal = base.guides.find((guide) => guide.axis === "h");

  // Переноса нет — кадр видит то же, что объект.
  assert.deepEqual(
    canvasFrameGuides(state, null, scheme).map((guide) => [guide.axis, guide.at]),
    [
      ["h", 0.4],
      ["v", 0.3],
    ],
  );

  // Идёт перенос: промежуточный объект — тот же, что у переноса метки.
  const preview = moveSchemeGuide(base.project, base.schemeId, horizontal.id, 0.75).project;
  const framed = canvasFrameGuides(state, preview, scheme);
  assert.equal(
    framed.find((guide) => guide.id === horizontal.id).at,
    0.75,
    "кадр показывает направляющую на старом месте — значит за курсором она не поедет",
  );
  // Соседняя при этом не поехала, а состояние не тронуто: перенос ещё не принят.
  assert.equal(framed.find((guide) => guide.axis === "v").at, 0.3);
  assert.equal(schemeGuides(state.project, base.schemeId).find((guide) => guide.id === horizontal.id).at, 0.4);

  // Спрятанные направляющие в кадр не уходят вовсе — ни свои, ни промежуточные.
  assert.deepEqual(canvasFrameGuides({ project: base.project, guidesShown: false }, preview, scheme), []);
  assert.deepEqual(canvasFrameGuides(state, preview, null), []);
});
