// Изображения объектов на развёртке (таск 135, требования G187, G190, G191,
// G192).
//
// Что проверяется здесь, а не глазами:
//
//   1. **У каждого типа стартового справочника есть контур.** Значок берётся
//      по имени у типа, а не найдётся — по форме знака; промах в этой
//      лестнице оставил бы стену с кружком вместо кондиционера, и заметить
//      это можно было бы только на той стене, где такой тип стоит.
//   2. **Размер решается числом, а не вкусом.** Крупная вещь рисуется в
//      масштабе стены, мелкая — уменьшённым изображением: ровно это и есть «рядом или прям
//      поверх объекта, если большой».
//   3. **Подрозетники вплотную и одна высота у ряда** — G190 и G191.
//   4. **Умолчания размеров наследуются, а не подставляются** (G192): объект,
//      размеченный до этого таска, оживает без единой правки в нём.
//   5. **Контур — только контур.** В чёрно-белом листе краска становится
//      тушью, и залитый значок стал бы чёрным пятном.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  MARK_DIMENSION_MAX,
  MARK_DIMENSION_SIGNED,
  addMark,
  addScheme,
  addWall,
  createProject,
  defaultTemplate,
  findType,
  markDimensionValue,
  markSizes,
  setMarkWall,
  setPlanOrigin,
  setPlanScale,
  setTypeSizes,
  styleOf,
  typeSizes,
  typeObjectView,
  wallElevation,
} from "../src/model.js";
import {
  drawObjectView,
  objectViewByName,
  objectViewClashes,
  objectViewForShape,
  objectViewNames,
} from "../src/objectViews/registry.js";
import { objectCatalogKeys, objectCatalogRetiredKeys } from "../src/objectCatalog.js";
import { monoContext } from "../src/mono.js";
import {
  ELEVATION_GROWN_QUIET,
  ELEVATION_VIEW_MIN_PX,
  drawElevation,
  elevationViewOf,
  elevationMarkBox,
  elevationRows,
} from "../src/render.js";

// Холст-писец: записывает каждый вызов и каждое присваивание. Тем же приёмом
// в таске 127 сверяли кадр чертежа — отпечаток контура снимается так же.
function scribe() {
  const log = [];
  const ctx = new Proxy(
    { measureText: (value) => ({ width: String(value).length * 6 }) },
    {
      get: (target, key) => {
        if (key in target) return target[key];
        return (...args) => log.push(String(key) + "(" + args.map((value) => (typeof value === "number" ? Math.round(value * 100) / 100 : String(value))).join(",") + ")");
      },
      set: (target, key, value) => {
        log.push(String(key) + "=" + String(value));
        return true;
      },
    },
  );
  return { ctx, log };
}

test("у каждого типа стартового справочника есть контур", () => {
  const template = defaultTemplate();
  const categories = new Map(template.categories.map((item) => [item.id, item]));
  const missing = [];
  for (const type of template.markTypes) {
    const category = categories.get(type.categoryId);
    const shape = type.shape || (category ? category.shape : null);
    const view = objectViewByName(typeObjectView(type)) || objectViewForShape(shape);
    if (!view) missing.push(type.code + " " + type.name + " [" + shape + "]");
  }
  assert.deepEqual(missing, [], "тип без контура: развёртка нарисует ему кружок");
});

// Вентиляция (G206): изображение найдено по знаку, и его размер — тот же, что
// умолчание типа. Разойдись они — на развёртке вещь рисовалась бы одной
// решёткой, а мерилась другой.
test("вентиляция: изображение найдено по знаку и меряется как сам тип", () => {
  const view = objectViewForShape("rect-horizontal-ticks");
  assert.ok(view, "у знака вентиляции нет изображения — развёртка нарисует кружок");
  assert.equal(view.name, "vent");
  const vent = defaultTemplate().markTypes.find((type) => type.code === "ВЕНТ");
  assert.deepEqual(view.mm, { width: vent.sizes.length, height: vent.sizes.width });
  // Решётка: рамка панели, круг рабочего колеса и жалюзи — и ни одна жалюзи
  // за круг не выходит, иначе это решётка поверх кольца, а не одна вещь.
  const circle = view.parts.find((part) => part.kind === "circle");
  assert.ok(circle, "круга рабочего колеса нет");
  for (const part of view.parts.filter((item) => item.kind === "line")) {
    const far = Math.max(
      Math.hypot(part.x1 - circle.cx, part.y1 - circle.cy),
      Math.hypot(part.x2 - circle.cx, part.y2 - circle.cy),
    );
    assert.ok(far <= circle.r, "жалюзи вылезла за круг: " + JSON.stringify(part));
  }
});

test("изображение берётся сперва у типа, потом по форме, и ничем не ломается", () => {
  // Имя у типа старше формы: ночник и выход канализации делят `circle-drain`,
  // и без имени один из них нарисовался бы чужой вещью.
  assert.equal(elevationViewOf({ view: "drain", shape: "circle-drain" }).name, "drain");
  assert.equal(elevationViewOf({ view: "nightLight", shape: "circle-drain" }).name, "nightLight");
  // Имени нет — решает форма.
  assert.equal(elevationViewOf({ view: null, shape: "circle-socket" }).name, "socket");
  // Нет ни того ни другого — значка нет, и развёртка рисует нынешний знак:
  // тип, заведённый руками, это обычная жизнь, а не исключение.
  assert.equal(elevationViewOf({ view: null, shape: "star" }), null);
  assert.equal(elevationViewOf({ view: "чепуха", shape: "звезда" }), null);
});

// ——— размер на развёртке (таск 140, дефект D25; таск 179, дефект D42) ——————
//
// Правило одно: **каждая сторона — своя в масштабе, но не меньше минимума**.
// Прежних двух («мельче трёхсот миллиметров — постоянный размер, крупнее — свой»)
// больше нет, и ровно из них вырос дефект: постоянные двадцать две точки на
// короткой стене оборачивались третью метра.
//
// Сам минимум с таска 179 включается **отметкой** (D42: «рисуй всё в реальном
// масштабе»), и тесты ниже ставят её доводом явно: они про границу, а не про
// умолчание. Про умолчание — отдельный тест сразу за ними.

test("D42: умолчание — реальный масштаб, границу снизу включает отметка", () => {
  // Числа живого объекта: полоса во весь экран, стена 2800 по высоте, поле
  // развёртки 216 точек — масштаб 0.0771 точки на миллиметр.
  const scale = 216 / 2800;
  const unit = 1;
  const socket = { shape: "circle-socket", sizeMm: { width: 80, height: 80 } };
  // Без отметки — свой размер: восемьдесят миллиметров дают 6.17 точки.
  const real = elevationMarkBox(socket, scale, unit, true);
  assert.ok(Math.abs(real.width - 80 * scale) < 1e-9, "нарисовано своим размером: " + real.width);
  assert.equal(real.scaled, true, "в масштабе — значит честно");
  assert.equal(real.grown, 1, "подтяжки нет вовсе, и подписи не о чем говорить");
  // С отметкой — ровно прежнее поведение: тринадцать точек, то есть 169 мм
  // вместо восьмидесяти. Это и есть то, на что смотрел заказчик.
  const shown = elevationMarkBox(socket, scale, unit, true, true);
  assert.equal(shown.width, ELEVATION_VIEW_MIN_PX * unit);
  assert.equal(Math.round(shown.width / scale), 169, "тринадцать точек — это 169 мм объекта");
  assert.ok(Math.abs(shown.grown - 169 / 80) < 0.01, "вдвое крупнее себя: " + shown.grown);
  // Крупная вещь не меняется ни с отметкой, ни без неё: жалоба была ровно про
  // это — мелкое растёт, крупное нет, и масштаб на листе перестаёт быть один.
  const fridge = { shape: "circle-thermo", sizeMm: { width: 600, height: 350 } };
  assert.equal(elevationMarkBox(fridge, scale, unit, true).width, elevationMarkBox(fridge, scale, unit, true, true).width);
  // Отметка — это довод, а не настройка модуля: `false` и пропуск значат одно.
  assert.equal(elevationMarkBox(socket, scale, unit, true, false).width, real.width);
});

test("правило одно: вещь в масштабе, но не мельче минимума", () => {
  const scale = 0.05; // точек холста на миллиметр стены
  const unit = 1;
  // Кондиционер 900 × 300: в масштабе это 45 × 15 точек, и влезет он или нет
  // над дверью, видно только так.
  const big = elevationMarkBox({ shape: "circle-thermo", sizeMm: { width: 900, height: 300 } }, scale, unit, true, true);
  assert.equal(big.scaled, true);
  assert.ok(Math.abs(big.width - 45) < 1e-6 && Math.abs(big.height - 15) < 1e-6, JSON.stringify(big));
  // Розетка 80 × 80: в масштабе это четыре точки — не видно ничего, и она
  // подтягивается до минимума. Ровно до минимума, а не до чего-то своего.
  const small = elevationMarkBox({ shape: "circle-socket", sizeMm: { width: 80, height: 80 } }, scale, unit, true, true);
  assert.equal(small.scaled, false);
  assert.equal(small.width, ELEVATION_VIEW_MIN_PX * unit);
  assert.equal(small.height, ELEVATION_VIEW_MIN_PX * unit);
  // Развилки между ними нет: вещь, у которой в масштабе ровно минимум, честна,
  // и ни одного числа в миллиметрах правило больше не знает.
  const edge = elevationMarkBox(
    { shape: "circle-thermo", sizeMm: { width: ELEVATION_VIEW_MIN_PX / scale, height: ELEVATION_VIEW_MIN_PX / scale } },
    scale,
    unit,
    true,
    true,
  );
  assert.equal(edge.scaled, true, "на самом минимуме вещь уже в масштабе");
  assert.equal(edge.width, ELEVATION_VIEW_MIN_PX);
  // Единица бумаги умножает минимум вместе со всем остальным: на листе
  // различимость меряется тем же, чем поля и шрифт.
  const paper = elevationMarkBox({ shape: "circle-socket", sizeMm: { width: 80, height: 80 } }, scale, 4, true, true);
  assert.equal(paper.width, ELEVATION_VIEW_MIN_PX * 4);
  // Отметка снята — ни одного изображения, и знак прежнего размера.
  const plain = elevationMarkBox({ shape: "circle-thermo", sizeMm: { width: 900, height: 300 } }, scale, unit, false);
  assert.equal(plain.view, null);
  assert.equal(plain.width, 18 * unit, "без отметки знак прежнего размера");
});

test("D25: на крупном масштабе розетка становится честной, а не остаётся значком", () => {
  // Суть дефекта: прежде нарисованный размер **не зависел от масштаба стены**,
  // и на короткой стене розетка выходила в треть метра. Теперь у неё есть
  // масштаб, на котором она честна, — у постоянного размера такого не бывает.
  const unit = 1;
  const socket = { shape: "circle-socket", sizeMm: { width: 80, height: 80 } };
  const drawnMm = (scale) => elevationMarkBox(socket, scale, unit, true, true).width / scale;
  // Стена подлиннее — масштаб мельче: подтягивать приходится сильнее.
  assert.ok(drawnMm(0.05) > drawnMm(0.1), "на крупном масштабе врать приходится меньше");
  // И есть масштаб, на котором врать не приходится вовсе.
  const honest = elevationMarkBox(socket, 0.2, unit, true, true);
  assert.equal(honest.scaled, true);
  assert.equal(honest.width, 16, "80 мм при 0.2 — шестнадцать точек, и подтягивать нечего");
  // Прежнее правило дало бы здесь свои двадцать две точки, то есть 110 мм
  // вместо восьмидесяти, и это ровно то, на что смотрел заказчик.
  assert.ok(honest.width < 22, "постоянного размера больше нет");
});

test("во сколько раз подтянуто — число, и о сотых долях подпись молчит", () => {
  const unit = 1;
  const socket = { shape: "circle-socket", sizeMm: { width: 80, height: 80 } };
  // В масштабе — ровно единица: врать не о чем.
  assert.equal(elevationMarkBox(socket, 0.2, unit, true, true).grown, 1);
  // Вчетверо мельче минимума — вчетверо и подтянуто.
  const tiny = elevationMarkBox(socket, ELEVATION_VIEW_MIN_PX / 80 / 4, unit, true, true);
  assert.ok(Math.abs(tiny.grown - 4) < 1e-9, "подтяжка считается числом: " + tiny.grown);
  // Полоса во весь экран: розетка выходит в 12.5 точек при минимуме 13 —
  // подтяжка в четыре сотых, и подпись о ней молчит, иначе будет гореть
  // всегда и перестанет читаться там, где вещь крупнее втрое.
  const near = elevationMarkBox(socket, 0.1557, unit, true, true);
  assert.ok(near.grown > 1, "подтяжка всё-таки есть");
  assert.ok(near.grown < ELEVATION_GROWN_QUIET, "о четырёх процентах подпись молчит: " + near.grown);
  // Мера разговора на рисование не влияет: нарисовано всё равно по минимуму.
  assert.equal(near.width, ELEVATION_VIEW_MIN_PX);
});

test("стороны подтягиваются врозь: тонкая вещь не вырастает в полстены", () => {
  // Вертикальная лента 40 × 600. С сохранением пропорции подтягивание по
  // тонкой стороне утроило бы и длинную: вместо шестидесяти четырёх точек
  // почти двести — лента в два метра высотой на стене 2800.
  const scale = 0.107;
  const unit = 1;
  const tape = elevationMarkBox({ shape: "circle-socket", sizeMm: { width: 40, height: 600 } }, scale, unit, true, true);
  assert.equal(tape.width, ELEVATION_VIEW_MIN_PX, "тонкая сторона встала на минимум");
  assert.ok(Math.abs(tape.height - 600 * scale) < 1e-6, "длинная сторона осталась своей: " + tape.height);
  assert.equal(tape.scaled, false, "вещь подтянута — значит не в масштабе");
});

test("крупнее, чем свой размер или минимум, не бывает ни одна вещь справочника", () => {
  // Единственное обещание, которое правило даёт: нарисованное не больше, чем
  // `max(свой размер, минимум)`. Соврать о размере можно только в одну
  // сторону — в сторону различимости, и ровно на столько, сколько ей нужно.
  const template = defaultTemplate();
  for (const unit of [1, 3.5]) {
    for (const scale of [0.01, 0.05, 0.107, 0.3, 2]) {
      for (const type of template.markTypes) {
        const sizes = typeSizes(type);
        const mark = { shape: styleOf({ markTypes: template.markTypes, categories: template.categories }, type.id).shape, view: type.view || type.icon, sizeMm: { width: sizes.length, height: sizes.width } };
        const box = elevationMarkBox(mark, scale, unit, true, true);
        if (!box.view) continue;
        const min = ELEVATION_VIEW_MIN_PX * unit;
        const where = type.code + " при масштабе " + scale + " и единице " + unit;
        assert.ok(box.width <= Math.max(min, sizes.length * scale) + 1e-9, where + ": шире обещанного");
        assert.ok(box.height <= Math.max(min, sizes.width * scale) + 1e-9, where + ": выше обещанного");
        assert.ok(box.width >= min - 1e-9 && box.height >= min - 1e-9, where + ": мельче различимого");
      }
    }
  }
});

test("подрозетники идут вплотную и одной высотой на ряд", () => {
  // Три розетки одной группы, расставленные на плане с разбросом в пару
  // сантиметров, и чужая метка рядом.
  const marks = [
    { id: "c", label: "Р3", groupId: "g", groupLabel: "Р1Р2Р3", fromMm: 1180, heightMm: 300 },
    { id: "a", label: "Р1", groupId: "g", groupLabel: "Р1Р2Р3", fromMm: 1100, heightMm: 300 },
    { id: "b", label: "Р2", groupId: "g", groupLabel: "Р1Р2Р3", fromMm: 1140, heightMm: 300 },
    { id: "x", label: "В1", groupId: null, fromMm: 2000, heightMm: 900 },
  ];
  const rows = elevationRows(marks);
  assert.equal(rows.length, 2, "группа — один ряд, одиночка — свой");
  const row = rows[0];
  assert.deepEqual(row.members.map((mark) => mark.id), ["a", "b", "c"], "порядок — вдоль стены, как на плане");
  assert.equal(row.label, "Р1Р2Р3", "подпись у ряда общая, а не три подряд");
  assert.equal(row.heightMm, 300);
  assert.equal(row.centreMm, 1140, "ряд встаёт серединой туда, где середина группы");
  // Одиночка остаётся собой и своей подписью.
  assert.deepEqual(rows[1].members.map((mark) => mark.id), ["x"]);
  assert.equal(rows[1].label, "В1");
});

test("у ряда высота по нижнему объекту", () => {
  // Заказчик: «2 блока розеток мы в одну группу не собираем, это всегда 2
  // группы разных». Если такая группа всё же попалась — берём нижнюю и не
  // городим разбора.
  const rows = elevationRows([
    { id: "a", label: "Р1", groupId: "g", groupLabel: "Р1Р2", fromMm: 100, heightMm: 900 },
    { id: "b", label: "Р2", groupId: "g", groupLabel: "Р1Р2", fromMm: 200, heightMm: 300 },
  ]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].heightMm, 300);
});

test("умолчания размеров наследуются, а не подставляются в метку", () => {
  const base = createProject();
  const socket = base.markTypes.find((type) => type.code === "Р");
  const scheme = addScheme(base, { name: "1", imageId: "p", width: 1000, height: 1000 });
  const added = addMark(scheme.project, {
    schemeId: scheme.scheme.id,
    typeId: socket.id,
    kind: "point",
    points: [{ x: 0.5, y: 0.5 }],
  });
  // Метка чистая: поля размеров у неё пустые, умолчание в неё не подставлено.
  // Это и есть разница между наследованием и подстановкой — поправил
  // умолчание у типа, и метка поехала за ним.
  for (const field of ["length", "width", "heightAboveFloor"]) {
    assert.equal(added.mark[field], null, field + " подставлен в метку, а не унаследован");
  }
  // А прочитать размеры можно: они пришли у типа.
  const sizes = markSizes(added.project, added.mark);
  assert.equal(sizes.heightAboveFloor, 300);
  assert.equal(sizes.heightAboveFloorOwn, false, "высота унаследована, и это видно");
  // Поправили умолчание у типа — поехали все его метки разом. Ради этого
  // наследование и выбрано: объект заказчика оживает без правки меток.
  const raised = setTypeSizes(added.project, socket.id, { heightAboveFloor: 350 }).project;
  assert.equal(markSizes(raised, added.mark).heightAboveFloor, 350);
  // Своё значение у метки старше умолчания.
  const own = { ...added.mark, heightAboveFloor: 1100 };
  assert.equal(markSizes(raised, own).heightAboveFloor, 1100);
  assert.equal(markSizes(raised, own).heightAboveFloorOwn, true);
});

test("G68: пустые умолчания убирают поле у типа, а не обнуляют его", () => {
  const project = createProject();
  const socket = project.markTypes.find((type) => type.code === "Р");
  const cleared = setTypeSizes(project, socket.id, {
    length: "",
    width: "",
    depth: "",
    heightAboveFloor: "",
  }).project;
  const type = findType(cleared, socket.id);
  assert.ok(!Object.prototype.hasOwnProperty.call(type, "sizes"), "тип стал ровно таким, каким был до таска");
  // Ноль — это значение, а не пустота: метка в полу стоит на нуле.
  const floor = setTypeSizes(project, socket.id, { heightAboveFloor: 0 }).project;
  assert.equal(findType(floor, socket.id).sizes.heightAboveFloor, 0);
});

test("контур рисуется только обводкой — в чёрно-белом он останется контуром", () => {
  for (const name of objectViewNames()) {
    const { ctx, log } = scribe();
    drawObjectView(ctx, objectViewByName(name), { x: 0, y: 0, width: 40, height: 40 }, "#d1242f");
    const painted = log.join(" ");
    assert.ok(painted.includes("stroke()"), name + ": контур не обведён");
    assert.ok(!/\bfill\(\)/.test(painted), name + ": значок залит — в туши станет чёрным пятном");
    assert.ok(painted.includes("strokeStyle=#d1242f"), name + ": значок не взял цвет метки");
  }
});

test("значок каждого типа отличим от соседей по своему отпечатку", () => {
  // Отпечаток — тот же приём, что у форм знаков (`shapes.test.js`): два
  // разных прибора, нарисованных одинаково, на бумаге неразличимы, а поймать
  // это глазами на тридцати значках дорого.
  const prints = new Map();
  for (const name of objectViewNames()) {
    const { ctx, log } = scribe();
    drawObjectView(ctx, objectViewByName(name), { x: 0, y: 0, width: 40, height: 40 }, "#000000");
    const print = log.filter((entry) => !entry.includes("=")).join("|");
    assert.ok(!prints.has(print), name + " рисуется так же, как " + prints.get(print));
    prints.set(print, name);
  }
  assert.ok(prints.size >= 25, "значков должно быть за два десятка: " + prints.size);
});

test("развёртка несёт размеры и группу, а план остаётся со знаками", () => {
  let project = createProject();
  const scheme = addScheme(project, { name: "1 этаж", imageId: "p", width: 1200, height: 800 });
  project = setPlanScale(scheme.project, scheme.scheme.id, {
    a: { x: 0.1, y: 0.5 },
    b: { x: 0.6, y: 0.5 },
    meters: 6,
  }).project;
  project = setPlanOrigin(project, scheme.scheme.id, { at: { x: 0.1, y: 0.1 }, turn: 0 }).project;
  const wall = addWall(project, {
    schemeId: scheme.scheme.id,
    aMm: { x: 0, y: 0 },
    bMm: { x: 4000, y: 0 },
    thicknessMm: 100,
  });
  project = wall.project;
  const socket = project.markTypes.find((type) => type.code === "Р");
  const mark = addMark(project, {
    schemeId: scheme.scheme.id,
    typeId: socket.id,
    kind: "point",
    points: [{ x: 0.2, y: 0.105 }],
  });
  project = setMarkWall(mark.project, mark.mark.id, { wallId: wall.wall.id, atMm: 1000 }).project;
  const both = ["left", "right"].map((side) => wallElevation(project, wall.wall.id, side));
  const elevation = both.find((item) => item.marks.length > 0);
  assert.ok(elevation, "метка не попала ни на одну сторону стены");
  const shown = elevation.marks[0];
  assert.equal(shown.heightMm, 300, "высота пришла у типа");
  assert.deepEqual(shown.sizeMm, { width: 80, height: 80 });
  assert.equal(shown.heightOwn, false);
  // Форма знака на плане не изменилась ни на букву: план трогать нельзя.
  assert.equal(styleOf(project, socket.id).shape, "circle-socket");
});

test("в чёрно-белом развёртка идёт тушью, и контуры остаются контурами", () => {
  // Отметка «чёрно-белый» оборачивает холст (`mono.js`), и значки проходят
  // через ту же подставку, что остальной лист: вторым путём рисования они не
  // идут. Проверяется это красками, а не обещанием.
  let project = createProject();
  const scheme = addScheme(project, { name: "1 этаж", imageId: "p", width: 1200, height: 800 });
  project = setPlanScale(scheme.project, scheme.scheme.id, {
    a: { x: 0.1, y: 0.5 },
    b: { x: 0.6, y: 0.5 },
    meters: 6,
  }).project;
  project = setPlanOrigin(project, scheme.scheme.id, { at: { x: 0.1, y: 0.1 }, turn: 0 }).project;
  const wall = addWall(project, {
    schemeId: scheme.scheme.id,
    aMm: { x: 0, y: 0 },
    bMm: { x: 4000, y: 0 },
    thicknessMm: 100,
  });
  project = wall.project;
  for (const code of ["Р", "К"]) {
    const type = project.markTypes.find((item) => item.code === code);
    const mark = addMark(project, {
      schemeId: scheme.scheme.id,
      typeId: type.id,
      kind: "point",
      points: [{ x: code === "Р" ? 0.2 : 0.3, y: 0.105 }],
    });
    project = setMarkWall(mark.project, mark.mark.id, { wallId: wall.wall.id, atMm: code === "Р" ? 1000 : 2000 }).project;
  }
  const elevation = ["left", "right"]
    .map((side) => wallElevation(project, wall.wall.id, side))
    .find((item) => item.marks.length > 1);
  assert.ok(elevation, "обе метки должны попасть на одну сторону");

  const paintsOf = (wrap) => {
    const seen = [];
    const base = new Proxy(
      { measureText: (value) => ({ width: String(value).length * 6 }) },
      {
        get: (target, key) => (key in target ? target[key] : () => {}),
        set: (target, key, value) => {
          if (key === "strokeStyle" || key === "fillStyle") seen.push(String(value));
          return true;
        },
      },
    );
    drawElevation(wrap ? monoContext(base) : base, elevation, { x: 0, y: 0, width: 800, height: 300 }, { views: true });
    return [...new Set(seen)];
  };

  const colour = paintsOf(false);
  assert.ok(colour.length >= 4, "на цветном листе красок несколько: " + colour.join(" "));
  const ink = paintsOf(true);
  assert.deepEqual(
    [...ink].sort(),
    ["#000000", "#ffffff"],
    "в чёрно-белом остаются только тушь и бумага: " + ink.join(" "),
  );
});

// ——— изображения описаны данными (таск 139, требование G198) ——————————
//
// Переделка «рисование → описание» касается всех тридцати двух изображений
// сразу, и тихая потеря в одном из них не покраснеет ни от попарной
// различимости (она про то, что изображения разные), ни от глаз (их тридцать
// два). Поэтому вид каждого сверяется с тем, каким он был **до** переделки:
// отпечаток снят на прежнем коде и лежит в `objectViews-before.json`.

const PRINTS_BEFORE = JSON.parse(
  readFileSync(new URL("./fixtures/objectViews-before.json", import.meta.url), "utf8"),
);
const PRINTS_AFTER = JSON.parse(
  readFileSync(new URL("./fixtures/objectViews-after.json", import.meta.url), "utf8"),
);

// Два прямоугольника: квадратный и вытянутый три к одному. Второй ловит то,
// что зависит от сторон, — скругления и пропорции.
function printOf(name) {
  const log = [];
  const ctx = new Proxy(
    {},
    {
      get: (target, key) => (...args) =>
        log.push(
          String(key) +
            "(" +
            args.map((value) => (typeof value === "number" ? Math.round(value * 1000) / 1000 : String(value))).join(",") +
            ")",
        ),
      set: () => true,
    },
  );
  drawObjectView(ctx, objectViewByName(name), { x: 0, y: 0, width: 40, height: 40 }, "#000");
  log.push("—");
  drawObjectView(ctx, objectViewByName(name), { x: 10, y: 20, width: 90, height: 30 }, "#000");
  return log;
}

// Три изображения, у которых капля: единственное место во всех тридцати двух,
// где примитивов не хватало. Кривая Безье заменена шестью отрезками — это
// заявленное упрощение (G198: «не хватает примитива — упрощается изображение,
// а не растёт набор»), и список держит его честным: разойтись имеет право
// только эта тройка.
const SIMPLIFIED = ["dehumidifier", "leak", "waterOutlet"];

// Изображения выключателей, **перерисованные по слову заказчика** (таск 14
// сценариев, G14): «поправь модель выключателя да и изображение его, сделав
// рамку сильно меньше, буквально пару миллиметров, что бы кнопки были больше».
// Отпечатки «до» и «после» сняты на прежних клавишах, и разойтись с ними имеет
// право ровно эта четвёрка — список держит перерисовку заявленной, а новый вид
// проверяется числами в `volumeHighlight.test.js` (рамка ≈ 2 мм, клавиши во всё
// лицо). Любое другое изображение по-прежнему обязано совпасть со снимком.
const REDRAWN_G14 = ["switch1", "switch2", "switch3", "switchToggle"];

// Изображения, заведённые **после** переделки в данные: отпечатка «до» у них
// нет и быть не может — сверять их не с чем. Список именной нарочно: новое имя
// без строки здесь красит прогон, и тихо проскочить мимо сверки «до» нельзя.
//
// `vent` — вентиляция санузла, таск 147 (G206).
// `mirror` — круглое зеркало подсветки, таск 177 (G262).
// `chandelier` — люстра, таск 216 (G323): до него она делила изображение и
// тело с плафоном и была в кадре шайбой.
const ADDED_AFTER = ["vent", "mirror", "chandelier"];

// Вещи встроенного каталога (таск 154). Они живут в том же реестре, что
// изображения меток, и отпечатка «до» у них тоже нет и быть не может —
// поэтому список отдельный: по нему видно, что реестр вырос каталогом, а не
// тем, что кто-то тихо дорисовал метке второй значок.
const ADDED_OBJECTS = objectCatalogKeys();

// Вещи, **ушедшие из каталога в метки** (таск 186, G279): телевизор и
// полотенцесушитель. Изображения у них те же, что были у вещей, — переехали
// они только семьёй (`objects` → `things`), — и отпечатка «до» у них нет по той
// же причине, что у остальных вещей каталога. Список отдельный, потому что в
// ключах каталога их больше нет, а в реестре они есть: по ним открываются
// чертежи, где такая вещь уже стоит.
const MOVED_TO_MARKS = objectCatalogRetiredKeys();

test("переделка в данные не тронула вид: со снимком «до» разошлись только заявленные изображения", () => {
  const names = objectViewNames();
  assert.equal(
    names.length,
    32 + ADDED_AFTER.length + ADDED_OBJECTS.length + MOVED_TO_MARKS.length,
    "изображений стало другое число: " + names.length,
  );
  const changed = [];
  for (const name of names) {
    const was = PRINTS_BEFORE[name];
    if (ADDED_AFTER.includes(name) || ADDED_OBJECTS.includes(name) || MOVED_TO_MARKS.includes(name)) {
      assert.ok(!was, name + ": изображение названо новым, а отпечаток «до» у него есть");
      continue;
    }
    assert.ok(was, name + ": отпечатка «до» нет — сверять не с чем");
    if (JSON.stringify(was) !== JSON.stringify(printOf(name))) changed.push(name);
  }
  assert.deepEqual(
    changed.sort(),
    [...SIMPLIFIED, ...REDRAWN_G14].sort(),
    "вид изменился не только у заявленного упрощения и перерисовки — это и есть тихая потеря",
  );
});

test("у каждой вещи каталога есть изображение, и с метками они именами не спорят", () => {
  // Плитка выбора без картинки — пустая клетка: вещь в каталоге есть, а
  // показать её нечем. Поймать это глазами на двух десятках плиток дорого.
  const without = objectCatalogKeys().filter((key) => !objectViewByName(key));
  assert.deepEqual(without, [], "вещь каталога без изображения");
  // И у ушедших в метки изображение осталось: без него прежний чертёж, где
  // такая вещь стоит, рисовал бы пустой габарит (G68).
  for (const key of objectCatalogRetiredKeys()) {
    assert.ok(objectViewByName(key), key + ": у ушедшей в метки вещи пропало изображение");
  }
  assert.deepEqual(objectViewClashes(), [], "два семейства заняли одно имя — изображение досталось чужому");
});

test("упрощение капли названо и ограничено: кривых в описаниях не осталось ни одной", () => {
  for (const name of SIMPLIFIED) {
    const painted = printOf(name).join(" ");
    assert.ok(!painted.includes("quadraticCurveTo"), name + ": кривая осталась");
    assert.ok(!painted.includes("bezierCurveTo"), name + ": кривая осталась");
  }
  // И во всех остальных кривых не было и нет.
  for (const name of objectViewNames()) {
    const painted = printOf(name).join(" ");
    assert.ok(!/CurveTo/.test(painted), name + ": в описании кривая");
  }
});

test("описания — записи известных видов, и видов пять", () => {
  const kinds = new Set();
  for (const name of objectViewNames()) {
    const view = objectViewByName(name);
    assert.ok(Array.isArray(view.parts) && view.parts.length > 0, name + ": описания нет");
    assert.ok(typeof view.draw !== "function", name + ": осталась функция рисования — описание не отдаётся данными");
    for (const part of view.parts) {
      assert.ok(part && typeof part === "object", name + ": примитив не запись");
      kinds.add(part.kind);
    }
  }
  assert.deepEqual([...kinds].sort(), ["arc", "circle", "line", "poly", "rect"], "набор примитивов вырос");
});

test("описание читается без холста: объём получит ту же геометрию", () => {
  // Смысл переделки: по описанию можно посчитать габарит, не рисуя. Если
  // контур кондиционера не уместился в свой прямоугольник, выдавить его на
  // глубину тоже не выйдет.
  for (const name of objectViewNames()) {
    const view = objectViewByName(name);
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    const see = (x, y) => {
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    };
    for (const part of view.parts) {
      if (part.kind === "rect") {
        see(part.x, part.y);
        see(part.x + part.width, part.y + part.height);
      } else if (part.kind === "circle") {
        see(part.cx - part.r, part.cy - part.r);
        see(part.cx + part.r, part.cy + part.r);
      } else if (part.kind === "arc") {
        // У дуги габарит считается по её углам, а не по всей окружности:
        // купол светильника занимает половину круга, и мерить его целым
        // кругом значило бы находить выход за рамку там, где его нет.
        const from = Math.min(part.from, part.to);
        const to = Math.max(part.from, part.to);
        const angles = [from, to];
        for (let turn = -4; turn <= 4; turn += 1) {
          for (const quarter of [0, Math.PI / 2, Math.PI, (Math.PI * 3) / 2]) {
            const angle = quarter + turn * Math.PI * 2;
            if (angle >= from && angle <= to) angles.push(angle);
          }
        }
        for (const angle of angles) see(part.cx + Math.cos(angle) * part.r, part.cy + Math.sin(angle) * part.r);
        if (part.close) see(part.cx, part.cy);
      } else if (part.kind === "line") {
        see(part.x1, part.y1);
        see(part.x2, part.y2);
      } else if (part.kind === "poly") {
        for (const [x, y] of part.points) see(x, y);
      }
    }
    assert.ok(minX >= -0.55 && maxX <= 0.55, name + ": описание вылезло за свой прямоугольник по ширине");
    assert.ok(minY >= -0.55 && maxY <= 0.55, name + ": описание вылезло за свой прямоугольник по высоте");
  }
});

test("отпечатки держат вид и дальше: каждое изображение совпадает со своим снимком", () => {
  for (const name of objectViewNames()) {
    // Перерисованные выключатели (G14) со старым снимком расходиться обязаны:
    // совпади они — перерисовка не доехала до изображения.
    if (REDRAWN_G14.includes(name)) {
      assert.notDeepEqual(printOf(name), PRINTS_AFTER[name], name + ": изображение выключателя не перерисовано");
      continue;
    }
    assert.deepEqual(printOf(name), PRINTS_AFTER[name], name + ": вид изменился");
  }
});

// ——— выступ от стены (таск 139, требование G197) ——————————————————————

test("выступ заполнен у всех типов стартового справочника", () => {
  const template = defaultTemplate();
  const without = template.markTypes.filter((type) => typeSizes(type).depth === null);
  assert.deepEqual(without.map((type) => type.code), [], "тип без выступа от стены");
  // Три правила, по которым брались числа, проверяются тремя образцами.
  const depthOf = (code) => typeSizes(template.markTypes.find((type) => type.code === code)).depth;
  assert.equal(depthOf("Р"), 10, "механизм в подрозетнике выходит рамкой");
  assert.equal(depthOf("К"), 200, "внутренний блок сплита выступает корпусом");
  assert.equal(depthOf("Т"), 0, "точечный светильник в потолке от стены не выступает");
  assert.equal(depthOf("Щ"), -30, "встраиваемый щит утоплен — это минус, а не отдельное свойство");
});

test("минус принимает только выступ, и только он", () => {
  assert.equal(MARK_DIMENSION_SIGNED.join(","), "depth");
  assert.equal(markDimensionValue(-30, "depth"), -30);
  assert.equal(markDimensionValue("-30", "depth"), -30);
  // Остальные три по-прежнему не меньше нуля: отрицательной длины не бывает.
  for (const field of ["length", "width", "heightAboveFloor"]) {
    assert.throws(() => markDimensionValue(-1, field), /\S/, field + " принял минус");
  }
  // Потолок меряется по модулю: утопленное на сто метров — тоже опечатка.
  assert.throws(() => markDimensionValue(-MARK_DIMENSION_MAX - 1, "depth"), /\S/);
});

test("выступ наследуется и правится как остальные размеры", () => {
  const project = createProject();
  const socket = project.markTypes.find((type) => type.code === "Р");
  const scheme = addScheme(project, { name: "1", imageId: "p", width: 1000, height: 1000 });
  const added = addMark(scheme.project, {
    schemeId: scheme.scheme.id,
    typeId: socket.id,
    kind: "point",
    points: [{ x: 0.5, y: 0.5 }],
  });
  assert.equal(markSizes(added.project, added.mark).depth, 10);
  assert.equal(markSizes(added.project, added.mark).depthOwn, false);
  // Утопили эту одну розетку — у типа ничего не изменилось.
  const own = { ...added.mark, depth: -5 };
  assert.equal(markSizes(added.project, own).depth, -5);
  assert.equal(markSizes(added.project, own).depthOwn, true);
  assert.equal(typeSizes(findType(added.project, socket.id)).depth, 10);
});

test("G68: имя изображения читается по обоим именам", () => {
  // Поле звалось `icon`, пока изображения звались значками (таск 135).
  // Объект, заведённый между тасками, своих уточнённых изображений не теряет.
  assert.equal(typeObjectView({ view: "drain" }), "drain");
  assert.equal(typeObjectView({ icon: "drain" }), "drain");
  assert.equal(typeObjectView({ view: "drain", icon: "nightLight" }), "drain", "новое имя старше");
  assert.equal(typeObjectView({}), null);
  assert.equal(typeObjectView(null), null);
});

test("выступ на развёртку не попадает: он перпендикулярен листу", () => {
  // Проверка, что ничего не сломалось: четвёртый размер в данных развёртки не
  // появился, и рисуется она ровно тем же, чем рисовалась.
  let project = createProject();
  const scheme = addScheme(project, { name: "1 этаж", imageId: "p", width: 1200, height: 800 });
  project = setPlanScale(scheme.project, scheme.scheme.id, {
    a: { x: 0.1, y: 0.5 },
    b: { x: 0.6, y: 0.5 },
    meters: 6,
  }).project;
  project = setPlanOrigin(project, scheme.scheme.id, { at: { x: 0.1, y: 0.1 }, turn: 0 }).project;
  const wall = addWall(project, {
    schemeId: scheme.scheme.id,
    aMm: { x: 0, y: 0 },
    bMm: { x: 4000, y: 0 },
    thicknessMm: 100,
  });
  project = wall.project;
  const socket = project.markTypes.find((type) => type.code === "Р");
  const mark = addMark(project, {
    schemeId: scheme.scheme.id,
    typeId: socket.id,
    kind: "point",
    points: [{ x: 0.2, y: 0.105 }],
  });
  project = setMarkWall(mark.project, mark.mark.id, { wallId: wall.wall.id, atMm: 1000 }).project;
  const elevation = ["left", "right"]
    .map((side) => wallElevation(project, wall.wall.id, side))
    .find((item) => item.marks.length > 0);
  const shown = elevation.marks[0];
  assert.deepEqual(shown.sizeMm, { width: 80, height: 80 }, "на листе у вещи две стороны, а не три");
  assert.equal(shown.depthMm, undefined, "выступ в данные развёртки не просочился");
});
