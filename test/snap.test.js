// Магнит направления и направляющие при рисовании линий и контуров — чистые
// функции от точек плана, вида и порогов.
//
// Зачем магнит: этим рисуют светодиодную ленту по периметру комнаты и треки.
// Стены в квартире прямые, инженер каждый раз целится в направление и
// промахивается на пару градусов — на распечатке косина видна. Магнит
// дотягивает почти ровное направление до ровного (шаг 15°), а всё остальное
// оставляет как есть: совсем косые стены в квартирах тоже бывают.
//
// Зачем направляющие: квадрат надо замкнуть ровно в ту вершину, с которой
// начали, а у зигзага верхние точки обязаны стоять на одной высоте. Глазом это
// не поймать, поэтому вершины текущей ломаной ловят курсор сами.
import test from "node:test";
import assert from "node:assert/strict";
import {
  GUIDE_SNAP_PX,
  dashPattern,
  markRadius,
  SNAP_ANGLE_DEG,
  SNAP_STEP_DEG,
  draftGuides,
  draftSnap,
  renderInternals,
  snapSegment,
} from "../src/render.js";

// План не квадратный нарочно: доля по горизонтали и доля по вертикали стоят
// разных пикселей, и угол, посчитанный по долям, — это не тот угол, который
// видит инженер.
const plan = { id: "s", width: 1000, height: 500 };

test("порог магнита — не жадный и не робкий", () => {
  assert.ok(SNAP_ANGLE_DEG > 0, "магнита нет вовсе");
  // Половина шага сетки — порог, при котором свободной руки не остаётся вовсе:
  // любое направление оказалось бы притянуто к ближайшему ровному.
  assert.ok(
    SNAP_ANGLE_DEG < SNAP_STEP_DEG / 2,
    "магнит съедает всё между ровными направлениями: " + SNAP_ANGLE_DEG + " при шаге " + SNAP_STEP_DEG,
  );
});

test("почти горизонтальный отрезок дотягивается до горизонтали", () => {
  // Вправо на 300 пикселей плана и вниз на 10 — это 1,9°.
  const from = { x: 0.2, y: 0.5 };
  const to = { x: 0.5, y: 0.52 };
  const snap = snapSegment(from, to, plan);

  assert.equal(snap.snapped, true);
  assert.equal(snap.angle, 0, "угол после притяжения должен быть ровным");
  assert.equal(snap.point.y, from.y, "поперечная координата не выровнялась");
  assert.equal(snap.point.x, to.x, "продольную координату магнит трогать не должен");
});

test("почти вертикальный отрезок дотягивается до вертикали, вверх — это 90°", () => {
  const from = { x: 0.5, y: 0.8 };
  // Вверх на 200 пикселей плана и вправо на 8 — это 2,3°.
  const up = snapSegment(from, { x: 0.508, y: 0.4 }, plan);
  assert.equal(up.snapped, true);
  assert.equal(up.angle, 90, "вверх — 90°");
  assert.equal(up.point.x, from.x);
  assert.equal(up.point.y, 0.4, "продольную координату магнит трогать не должен");

  // Вниз на 75 пикселей плана и влево на 3 — это 2,3°.
  const down = snapSegment(from, { x: 0.497, y: 0.95 }, plan);
  assert.equal(down.angle, 270, "вниз — 270°");
  assert.equal(down.point.x, from.x);
});

test("наклонный отрезок магнит не трогает, но угол показывает честно", () => {
  // Вправо 300 и вверх 125 пикселей плана — это 22,6°, ровно между ровными
  // направлениями сетки: и до 15°, и до 30° отсюда семь градусов.
  const from = { x: 0.2, y: 0.8 };
  const to = { x: 0.5, y: 0.55 };
  const snap = snapSegment(from, to, plan);

  assert.equal(snap.snapped, false);
  assert.ok(Math.abs(snap.angle - 22.62) < 0.01, "угол считается в пикселях плана, а не в долях: " + snap.angle);
  assert.deepEqual(snap.point, to, "свободный отрезок сдвинулся");
});

// Заказчик: «фиксироваться не только 90 градусов угол, но и 15, 30, 45 и 75
// и т.д. то есть кратно 15». Скос стены и эркер рисуются от руки так же
// неточно, как горизонталь, и магнит обязан держать их тоже.
test("ровные направления идут через 15°, а не через 90°", () => {
  const from = { x: 0.2, y: 0.5 };
  for (const straight of [15, 30, 45, 60, 75, 105, 135, 165, 195, 225, 255, 285, 315, 345]) {
    // Точка ровно на луче, промахнувшаяся на 2° мимо него.
    const radians = ((straight + 2) * Math.PI) / 180;
    const to = {
      x: from.x + (Math.cos(radians) * 200) / plan.width,
      y: from.y - (Math.sin(radians) * 200) / plan.height,
    };
    const snap = snapSegment(from, to, plan);
    assert.equal(snap.snapped, true, straight + "° магнит не поймал");
    assert.equal(snap.angle, straight, "угол после притяжения: " + snap.angle);
    const after = snapSegment(from, snap.point, plan, { free: true });
    assert.ok(Math.abs(after.angle - straight) < 0.001, straight + "°: точка легла мимо луча (" + after.angle + ")");
  }
});

test("порог — 4°: три градуса магнит забирает, пять оставляет руке", () => {
  const from = { x: 0.2, y: 0.5 };
  const rayTo = (degrees) => {
    const radians = (degrees * Math.PI) / 180;
    return {
      x: from.x + (Math.cos(radians) * 300) / plan.width,
      y: from.y - (Math.sin(radians) * 300) / plan.height,
    };
  };
  assert.equal(snapSegment(from, rayTo(33), plan).snapped, true, "3° мимо тридцати магнит обязан забрать");
  assert.equal(snapSegment(from, rayTo(35), plan).snapped, false, "5° мимо тридцати — это рука, а не промах");
});

// Притяжение косого направления — та же проекция на луч, что у горизонтали:
// продольная координата остаётся под курсором, поперечная возвращается на луч.
// Поворот с сохранением длины увёл бы конец отрезка из-под руки.
test("косой магнит проецирует на луч, а не поворачивает отрезок", () => {
  const from = { x: 0.2, y: 0.8 };
  const radians = (43 * Math.PI) / 180;
  const to = { x: from.x + (Math.cos(radians) * 400) / plan.width, y: from.y - (Math.sin(radians) * 400) / plan.height };
  const snap = snapSegment(from, to, plan);

  assert.equal(snap.snapped, true);
  assert.equal(snap.angle, 45);
  // Длина после притяжения — проекция прежней на луч: 400 × cos 2°.
  const length = Math.hypot((snap.point.x - from.x) * plan.width, (snap.point.y - from.y) * plan.height);
  assert.ok(Math.abs(length - 400 * Math.cos((2 * Math.PI) / 180)) < 0.01, "длина не проекция: " + length);
});

test("магнит снимается на лету и отпускает почти ровный отрезок", () => {
  const from = { x: 0.2, y: 0.5 };
  const to = { x: 0.5, y: 0.52 };
  const free = snapSegment(from, to, plan, { free: true });

  assert.equal(free.snapped, false);
  assert.deepEqual(free.point, to, "при снятом магните точка обязана остаться под курсором");
  // Угол виден и без магнита: он же и подсказывает, насколько инженер промахнулся.
  assert.ok(Math.abs(free.angle - 358.1) < 0.1, "угол свободного отрезка: " + free.angle);
});

test("отрезка ещё нет — магниту не за что тянуть", () => {
  const point = { x: 0.3, y: 0.3 };
  const snap = snapSegment(point, point, plan);
  assert.equal(snap.snapped, false);
  assert.deepEqual(snap.point, point);
});

// Холста в тестах нет, поэтому рисованию подставляется заглушка: она принимает
// любые вызовы и записывает только напечатанное. Это тот же приём, которым
// проверяется легенда.
const drawProbe = () => {
  const target = {
    texts: [],
    measureText: (value) => ({ width: String(value).length * 7 }),
    fillText: (value, x, y) => target.texts.push({ value, x, y }),
  };
  return new Proxy(target, {
    get: (object, key) => (key in object ? object[key] : () => {}),
    set: () => true,
  });
};

const drawnAngle = (draft, color = "#1F6FEB") => {
  const ctx = drawProbe();
  renderInternals.drawDraft(ctx, plan, draft, { zoom: 1, offsetX: 0, offsetY: 0, markSize: 10, labelSize: 12 }, color);
  return ctx.texts;
};

// Заказчик просил, чтобы при рисовании был виден текущий градус. Стоит он у
// курсора, а не в углу холста: инженер смотрит на конец линии, и по числу в
// углу не понять, к какому отрезку оно относится.
test("при рисовании у курсора виден градус, и сработавший магнит по нему заметен", () => {
  const from = { x: 0.2, y: 0.5 };
  const snap = snapSegment(from, { x: 0.5, y: 0.52 }, plan);

  const magnet = drawnAngle({ points: [from], cursor: snap.point, snapped: true });
  assert.equal(magnet.length, 1, "подсказки угла у курсора нет");
  assert.ok(magnet[0].value.includes("0°"), "градус не написан: " + magnet[0].value);
  // Курсор в долях 0,5 — это 500 пикселей плана; подсказка стоит рядом с ним.
  assert.ok(Math.abs(magnet[0].x - 500) < 40, "подсказка уехала от курсора: " + magnet[0].x);

  // Тот же отрезок без магнита читается иначе — иначе непонятно, почему линия
  // не идёт за рукой.
  const byHand = drawnAngle({ points: [from], cursor: snap.point, snapped: false });
  assert.ok(byHand[0].value.includes("0°"));
  assert.notEqual(byHand[0].value, magnet[0].value, "сработавший магнит ничем не отличается от свободной руки");

  // Наклонный отрезок показывает свой настоящий угол: 300 вправо и 150 вверх.
  const slanted = drawnAngle({ points: [from], cursor: { x: 0.5, y: 0.2 }, snapped: false });
  assert.ok(slanted[0].value.includes("27°"), "угол наклонного отрезка: " + slanted[0].value);
});

test("вершина ещё не сдвинулась — градус не пишется", () => {
  const from = { x: 0.2, y: 0.5 };
  assert.deepEqual(drawnAngle({ points: [from], cursor: from, snapped: false }), []);
});

// ——— направляющие ————————————————————————————————————————————————————
//
// Порог направляющей — в пикселях экрана, поэтому дальше везде явный вид.
// Зум 1 и нулевое смещение выбраны нарочно: экранная точка совпадает с
// пикселем плана, и в примерах видно, куда именно целится рука.
const view = (patch) => ({ zoom: 1, offsetX: 0, offsetY: 0, markSize: 10, labelSize: 12, ...patch });

// Доля плана из пикселей плана — примеры считаются в пикселях, как их видит рука.
const at = (x, y) => ({ x: x / plan.width, y: y / plan.height });

test("квадрат замыкается ровно: направляющая от первой вершины держит, магнит доводит", () => {
  // Три угла квадрата 400×300 поставлены, рука ведёт четвёртый и промахивается
  // на 5 пикселей вбок и на 12 вниз.
  const square = [at(200, 100), at(600, 100), at(600, 400)];
  const snap = draftSnap(square, at(205, 412), plan, view());

  assert.deepEqual(
    snap.guides.map((guide) => guide.axis),
    ["v"],
    "вертикальной направляющей от первой вершины не видно",
  );
  assert.equal(snap.guides[0].at, square[0], "направляющая идёт не через первую вершину");
  assert.equal(snap.point.x, square[0].x, "точка не села на направляющую: угол не замкнётся");
  assert.equal(snap.point.y, square[2].y, "верх и низ квадрата разошлись");
  assert.equal(snap.angle, 180, "замыкающая стенка не горизонтальна");
  assert.equal(snap.snapped, true, "подсказка обязана сказать, что угол ровный");
});

test("зигзаг получает ровные верхние точки", () => {
  // Два зубца поставлены, рука ведёт вершину третьего и промахивается на
  // 5 пикселей выше прежней вершины.
  const zigzag = [at(100, 400), at(250, 100), at(400, 400)];
  const snap = draftSnap(zigzag, at(556, 105), plan, view());

  assert.deepEqual(
    snap.guides.map((guide) => guide.axis),
    ["h"],
    "горизонтальной направляющей по верхней точке не видно",
  );
  assert.equal(snap.point.y, zigzag[1].y, "верхние точки зигзага разошлись по высоте");
  // Косой магнит увёл бы точку вдоль направляющей, не дав взамен ровного угла,
  // — при пойманной направляющей он молчит, и точка остаётся под рукой.
  assert.equal(snap.point.x, 556 / plan.width, "точка уехала из-под курсора вдоль направляющей");
});

test("порог направляющей — в пикселях экрана и одинаков на любом зуме", () => {
  // Первая вершина держит вертикаль, вторая — горизонталь, третья тянется под
  // рукой и в источники не входит.
  const drawn = [at(200, 100), at(600, 400), at(800, 250)];
  const near = GUIDE_SNAP_PX - 1;
  const far = GUIDE_SNAP_PX + 3;
  for (const zoom of [0.5, 1, 4]) {
    // Промах меряется по экрану, поэтому он задан в экранных пикселях и на
    // каждом масштабе переводится в свою долю плана.
    const hit = draftGuides(drawn, offBy(200, 400, near, near, zoom), plan, view({ zoom }));
    assert.deepEqual(
      hit.guides.map((guide) => guide.axis),
      ["h", "v"],
      "на зуме " + zoom + " направляющие потерялись",
    );
    const miss = draftGuides(drawn, offBy(200, 400, far, far, zoom), plan, view({ zoom }));
    assert.deepEqual(miss.guides, [], "на зуме " + zoom + " направляющая поймала слишком далёкий курсор");
  }
});

// Доля плана для точки, отстоящей от пикселя плана (x, y) на столько-то
// **экранных** пикселей при данном масштабе.
function offBy(x, y, dx, dy, zoom) {
  return { x: (x * zoom + dx) / (plan.width * zoom), y: (y * zoom + dy) / (plan.height * zoom) };
}

test("направляющих на экране единицы: по одной на ось, и обе — ближайшие", () => {
  // Три вершины на почти одной высоте: ловить обязана ближняя.
  const drawn = [at(100, 100), at(300, 103), at(500, 96), at(700, 300)];
  const guides = draftGuides(drawn, at(720, 102), plan, view()).guides;

  assert.equal(guides.length, 1, "направляющих больше, чем осей: " + guides.length);
  assert.equal(guides[0].axis, "h");
  assert.equal(guides[0].at, drawn[1], "поймала не ближайшая вершина");
});

test("источник направляющих — только текущая ломаная, и последняя вершина в него не входит", () => {
  const drawn = [at(200, 100), at(600, 400)];
  // Рука стоит ровно под последней вершиной: горизонталь и вертикаль от неё
  // держит магнит направления, и направляющая тут не нужна.
  const fromLast = draftGuides(drawn, at(604, 402), plan, view()).guides;
  assert.deepEqual(fromLast, [], "направляющая повисла на вершине, от которой тянется отрезок");

  // Одна вершина — рисовать ещё не от чего.
  assert.deepEqual(draftGuides([at(200, 100)], at(202, 300), plan, view()).guides, []);
});

test("снятый магнит убирает и направляющие: рука рисует свободно", () => {
  const square = [at(200, 100), at(600, 100), at(600, 400)];
  const free = draftSnap(square, at(205, 412), plan, view(), { free: true });

  assert.deepEqual(free.guides, [], "при снятом магните направляющие остались");
  assert.deepEqual(free.point, at(205, 412), "при снятом магните точка обязана остаться под курсором");
  assert.equal(free.snapped, false);
});

test("без направляющих притяжка — прежний магнит направления", () => {
  const drawn = [at(200, 500), at(200, 100)];
  // Почти горизонтально вправо, далеко от всех прежних вершин по вертикали.
  const snap = draftSnap(drawn, at(600, 108), plan, view());
  assert.deepEqual(snap.guides, []);
  assert.equal(snap.point.y, drawn[1].y, "магнит направления перестал работать без направляющих");
  assert.equal(snap.angle, 0);
  assert.equal(snap.snapped, true);
});

// Как направляющая выглядит: полупрозрачный пунктир через всю видимую часть
// холста — и узор мельче любого начертания метки, иначе на пунктирной линии не
// понять, где черновик, а где подсказка.
const strokeProbe = () => {
  const seen = { props: {}, dash: null, lines: [] };
  let path = null;
  const impl = {
    canvas: { width: 1000, height: 500 },
    getTransform: () => ({ a: 1 }),
    measureText: (value) => ({ width: String(value).length * 7 }),
    setLineDash: (pattern) => {
      seen.dash = pattern;
    },
    beginPath: () => {
      path = [];
    },
    moveTo: (x, y) => path && path.push({ x, y }),
    lineTo: (x, y) => path && path.push({ x, y }),
    stroke: () => {
      if (path && path.length === 2) {
        seen.lines.push({ from: path[0], to: path[1], alpha: seen.props.globalAlpha, dash: seen.dash });
      }
      path = null;
    },
    restore: () => {
      seen.dash = null;
    },
  };
  return {
    seen,
    ctx: new Proxy(impl, {
      get: (object, key) => (key in object ? object[key] : () => {}),
      set: (object, key, value) => {
        seen.props[key] = value;
        return true;
      },
    }),
  };
};

test("направляющая — полупрозрачный пунктир через весь холст, мельче пунктира метки", () => {
  const probe = strokeProbe();
  const state = view();
  const zigzag = [at(100, 400), at(250, 100), at(400, 400)];
  const snap = draftSnap(zigzag, at(556, 105), plan, state);
  renderInternals.drawDraft(
    probe.ctx,
    plan,
    { points: zigzag, cursor: snap.point, snapped: snap.snapped, guides: snap.guides },
    state,
    "#1F6FEB",
  );

  assert.equal(probe.seen.lines.length, 1, "направляющих нарисовано не одна: " + probe.seen.lines.length);
  const guide = probe.seen.lines[0];
  assert.equal(guide.from.y, 100, "направляющая идёт не через верхнюю вершину");
  assert.equal(guide.to.y, 100);
  assert.equal(guide.from.x, 0, "направляющая не дотянулась до края холста");
  assert.equal(guide.to.x, 1000);
  assert.ok(guide.alpha > 0 && guide.alpha < 1, "направляющая не полупрозрачная: " + guide.alpha);
  assert.ok(Array.isArray(guide.dash) && guide.dash.length > 0, "направляющая сплошная");
  const mark = dashPattern(markRadius(state));
  assert.ok(
    Math.max(...guide.dash) < Math.min(...mark),
    "пунктир направляющей не отличить от пунктира метки: " + guide.dash + " против " + mark,
  );
});
