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
//      масштабе стены, мелкая — значком: ровно это и есть «рядом или прям
//      поверх объекта, если большой».
//   3. **Подрозетники вплотную и одна высота у ряда** — G190 и G191.
//   4. **Умолчания размеров наследуются, а не подставляются** (G192): объект,
//      размеченный до этого таска, оживает без единой правки в нём.
//   5. **Контур — только контур.** В чёрно-белом листе краска становится
//      тушью, и залитый значок стал бы чёрным пятном.
import test from "node:test";
import assert from "node:assert/strict";

import {
  addMark,
  addScheme,
  addWall,
  createProject,
  defaultTemplate,
  findType,
  markSizes,
  setMarkWall,
  setPlanOrigin,
  setPlanScale,
  setTypeSizes,
  styleOf,
  wallElevation,
} from "../src/model.js";
import { drawIcon, iconByName, iconForShape, iconNames } from "../src/icons/registry.js";
import { monoContext } from "../src/mono.js";
import { ELEVATION_SCALE_MM, drawElevation, elevationIconOf, elevationMarkBox, elevationRows } from "../src/render.js";

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
    const icon = iconByName(type.icon) || iconForShape(shape);
    if (!icon) missing.push(type.code + " " + type.name + " [" + shape + "]");
  }
  assert.deepEqual(missing, [], "тип без контура: развёртка нарисует ему кружок");
});

test("значок берётся сперва у типа, потом по форме, и ничем не ломается", () => {
  // Имя у типа старше формы: ночник и выход канализации делят `circle-drain`,
  // и без имени один из них нарисовался бы чужой вещью.
  assert.equal(elevationIconOf({ icon: "drain", shape: "circle-drain" }).name, "drain");
  assert.equal(elevationIconOf({ icon: "nightLight", shape: "circle-drain" }).name, "nightLight");
  // Имени нет — решает форма.
  assert.equal(elevationIconOf({ icon: null, shape: "circle-socket" }).name, "socket");
  // Нет ни того ни другого — значка нет, и развёртка рисует нынешний знак:
  // тип, заведённый руками, это обычная жизнь, а не исключение.
  assert.equal(elevationIconOf({ icon: null, shape: "star" }), null);
  assert.equal(elevationIconOf({ icon: "чепуха", shape: "звезда" }), null);
});

test("крупная вещь — в масштабе стены, мелкая — значком", () => {
  const scale = 0.05; // точек холста на миллиметр стены
  const unit = 1;
  // Кондиционер 900 × 300: в масштабе это 45 × 15 точек, и влезет он или нет
  // над дверью, видно только так.
  const big = elevationMarkBox({ shape: "circle-thermo", sizeMm: { width: 900, height: 300 } }, scale, unit, true);
  assert.equal(big.scaled, true);
  assert.ok(Math.abs(big.width - 45) < 1e-6 && Math.abs(big.height - 15) < 1e-6, JSON.stringify(big));
  // Розетка 80 × 80: в масштабе это четыре точки — значок, а не вещь.
  const small = elevationMarkBox({ shape: "circle-socket", sizeMm: { width: 80, height: 80 } }, scale, unit, true);
  assert.equal(small.scaled, false);
  assert.ok(small.width > 80 * scale * 4, "мелкое рисуется читаемым, а не честной точкой");
  // Граница названа числом и проверяется ею же.
  const edge = elevationMarkBox(
    { shape: "circle-thermo", sizeMm: { width: ELEVATION_SCALE_MM, height: 100 } },
    scale,
    unit,
    true,
  );
  assert.equal(edge.scaled, true, "ровно на границе вещь уже рисуется своим размером");
  const under = elevationMarkBox(
    { shape: "circle-thermo", sizeMm: { width: ELEVATION_SCALE_MM - 1, height: 100 } },
    scale,
    unit,
    true,
  );
  assert.equal(under.scaled, false);
  // Отметка снята — ни одного значка, и размер тот же, что был до этого таска.
  const plain = elevationMarkBox({ shape: "circle-thermo", sizeMm: { width: 900, height: 300 } }, scale, unit, false);
  assert.equal(plain.icon, null);
  assert.equal(plain.width, 18 * unit, "без отметки знак прежнего размера");
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
  const cleared = setTypeSizes(project, socket.id, { length: "", width: "", heightAboveFloor: "" }).project;
  const type = findType(cleared, socket.id);
  assert.ok(!Object.prototype.hasOwnProperty.call(type, "sizes"), "тип стал ровно таким, каким был до таска");
  // Ноль — это значение, а не пустота: метка в полу стоит на нуле.
  const floor = setTypeSizes(project, socket.id, { heightAboveFloor: 0 }).project;
  assert.equal(findType(floor, socket.id).sizes.heightAboveFloor, 0);
});

test("контур рисуется только обводкой — в чёрно-белом он останется контуром", () => {
  for (const name of iconNames()) {
    const { ctx, log } = scribe();
    drawIcon(ctx, iconByName(name), { x: 0, y: 0, width: 40, height: 40 }, "#d1242f");
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
  for (const name of iconNames()) {
    const { ctx, log } = scribe();
    drawIcon(ctx, iconByName(name), { x: 0, y: 0, width: 40, height: 40 }, "#000000");
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
    drawElevation(wrap ? monoContext(base) : base, elevation, { x: 0, y: 0, width: 800, height: 300 }, { icons: true });
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
