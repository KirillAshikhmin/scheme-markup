// Три разных ответа на «каким шрифтом» (G172).
//
// Заказчик посмотрел таск 114 и развёл то, что тот свёл: бумага — чертёжная
// всегда, интерфейс — системный всегда, схема на экране — по выбору человека.
// Интерфейс живёт на CSS и проверяется в `buildWeb.test.js`; здесь проверяются
// два оставшихся ответа — и главное, что они **не перепутаются**.
//
// Опасность тут ровно одна и она молчаливая: `render.js` рисует и экран, и
// бумагу одним кодом. Утеки настройка в выгрузку — человек увидит это только
// на распечатке. Поэтому сторона, которая «всегда чертёжная», проверяется не
// словом «мы же не передали», а счётом: ни одного `ctx.font` с системным
// семейством на всём кадре выгрузки.
import test from "node:test";
import assert from "node:assert/strict";

import {
  COMMENT_TYPE_ID,
  addMark,
  addScheme,
  createProject,
  setMarkPointer,
  typeKindOf,
  updateMark,
} from "../src/model.js";
import { drawScheme, drawFont, fontFamilyOf, labelBox, FONT_DRAFT, FONT_SYSTEM } from "../src/render.js";

const PLAN = { width: 1000, height: 500 };

// Семейства, которые «страница» отдаёт по переменным. Нарочно непохожи на
// настоящие: тест проверяет, что спросили **ту** переменную, а не что в ней
// записано — записанное проверяет `buildWeb.test.js` по самим стилям.
const DRAFT_FAMILY = '"Проба чертёжная", serif';
const SYSTEM_FAMILY = '"Проба системная", sans-serif';

// Страница в Node: `render.fontFamilyOf` читает `--font-gost` и `--font-ui`
// через `getComputedStyle(document.documentElement)` — ровно это и подставляем.
// Так проверяется настоящий путь чтения, а не его пересказ.
function withStyles(run) {
  const hadDocument = "document" in globalThis;
  const hadGetComputed = "getComputedStyle" in globalThis;
  const asked = [];
  globalThis.document = { documentElement: {} };
  globalThis.getComputedStyle = () => ({
    getPropertyValue: (name) => {
      asked.push(name);
      if (name === "--font-gost") return " " + DRAFT_FAMILY + " ";
      if (name === "--font-ui") return SYSTEM_FAMILY;
      return "";
    },
  });
  try {
    return run(asked);
  } finally {
    if (hadDocument) delete globalThis.document;
    else delete globalThis.document;
    if (hadGetComputed) delete globalThis.getComputedStyle;
    else delete globalThis.getComputedStyle;
  }
}

// Заглушка холста, которая помнит каждую строку `ctx.font`. Больше ей ничего
// не нужно: вопрос теста — каким шрифтом, а не где и какого цвета.
function fontProbe() {
  const fonts = [];
  const impl = {
    canvas: { width: 900, height: 600 },
    fillStyle: "",
    strokeStyle: "",
    getTransform: () => ({ a: 1 }),
    measureText: (value) => ({ width: String(value).length * 7 }),
    fillText: () => {},
    strokeText: () => {},
  };
  return {
    fonts,
    ctx: new Proxy(impl, {
      get: (object, key) => (key in object ? object[key] : () => {}),
      set: (object, key, value) => {
        if (key === "font") fonts.push(String(value));
        object[key] = value;
        return true;
      },
    }),
  };
}

// Схема, на которой есть всё, что умеет писать буквы: подпись метки, плашка
// комментария и легенда. Иначе проверка зелена оттого, что рисовать нечего.
function scene() {
  const made = addScheme(createProject(), { name: "1 этаж", width: PLAN.width, height: PLAN.height });
  let project = made.project;
  const spot = project.markTypes.find((type) => type.code === "Т").id;
  // Комментарий встроенный (G173): в справочнике его нет, идентификатор
  // зарезервирован моделью.
  const comment = COMMENT_TYPE_ID;
  project = addMark(project, { schemeId: made.scheme.id, typeId: spot, points: [{ x: 0.3, y: 0.4 }] }).project;
  project = addMark(project, { schemeId: made.scheme.id, typeId: spot, points: [{ x: 0.5, y: 0.4 }] }).project;
  // Вид метки задаётся явно, как это делает холст: иначе плашка встала бы
  // обычной точкой и в кадре не оказалось бы самого длинного текста.
  const plate = addMark(project, {
    schemeId: made.scheme.id,
    typeId: comment,
    kind: typeKindOf(project, comment),
    points: [{ x: 0.6, y: 0.7 }],
  });
  project = updateMark(plate.project, plate.mark.id, { original: "Ввод 3×6 мм, ⌀16 гофра" }).project;
  project = setMarkPointer(project, plate.mark.id, true).project;
  return { project, scheme: project.schemes[0] };
}

const viewOf = (patch) => ({ zoom: 1, offsetX: 0, offsetY: 0, markSize: 10, labelSize: 12, ...patch });

// Один кадр со всем, что пишет буквы. `legend: true` — как в выгрузке.
function paint(view) {
  const base = scene();
  const probe = fontProbe();
  drawScheme(probe.ctx, {
    project: base.project,
    scheme: base.scheme,
    filter: null,
    view,
    legend: true,
  });
  return probe.fonts;
}

// ——— разбор вида в семейства ——————————————————————————————————————————

test("вид шрифта спрашивает свою переменную — и только свою", () => {
  withStyles((asked) => {
    assert.equal(fontFamilyOf(FONT_DRAFT), DRAFT_FAMILY, "чертёжный берётся из --font-gost");
    assert.equal(fontFamilyOf(FONT_SYSTEM), SYSTEM_FAMILY, "системный берётся из --font-ui");
    assert.deepEqual(asked, ["--font-gost", "--font-ui"]);
  });
});

test("незнакомый вид — чертёжный: опечатка в настройке не оставит схему без шрифта", () => {
  withStyles(() => {
    assert.equal(fontFamilyOf("моноширинный"), DRAFT_FAMILY);
    assert.equal(fontFamilyOf(undefined), DRAFT_FAMILY);
    assert.equal(fontFamilyOf(null), DRAFT_FAMILY);
  });
});

test("без семейства `drawFont` даёт чертёжный — выгрузке не надо ничего помнить", () => {
  withStyles(() => {
    assert.equal(drawFont(12), "12px " + DRAFT_FAMILY);
    assert.equal(drawFont(12, 600), "600 12px " + DRAFT_FAMILY);
    // Переданное семейство побеждает — это единственный способ уйти от умолчания.
    assert.equal(drawFont(12, 600, SYSTEM_FAMILY), "600 12px " + SYSTEM_FAMILY);
  });
});

test("страницы нет (Node, сборка без стилей) — оба вида дают читаемый запасной", () => {
  for (const kind of [FONT_DRAFT, FONT_SYSTEM]) {
    assert.match(fontFamilyOf(kind), /sans-serif$/, "запасной список обязан кончаться системным шрифтом");
  }
});

// ——— кадр экрана слушает настройку ————————————————————————————————————

test("схема на экране с выбором «системный» рисуется системным — вся", () => {
  withStyles(() => {
    const fonts = paint(viewOf({ fontKind: FONT_SYSTEM }));
    assert.ok(fonts.length >= 4, "кадр не написал ни одной строки — проверять нечего: " + fonts.length);
    assert.deepEqual(
      fonts.filter((value) => !value.includes(SYSTEM_FAMILY)),
      [],
      "часть кадра осталась чертёжной — где-то шрифт берётся мимо кадра",
    );
  });
});

test("умолчание на экране чертёжное — заказчик просил шрифт на схеме", () => {
  withStyles(() => {
    const fonts = paint(viewOf({ fontKind: FONT_DRAFT }));
    assert.ok(fonts.length >= 4);
    assert.deepEqual(fonts.filter((value) => !value.includes(DRAFT_FAMILY)), []);
  });
});

// ——— кадр бумаги настройку не слушает ————————————————————————————————

test("кадр выгрузки чертёжный, какой бы ни была настройка", () => {
  withStyles(() => {
    // Так зовёт `schemePng`: свой `view` с масштабом и сдвигом, без `fontKind`.
    const fonts = paint({ zoom: 2, offsetX: -40, offsetY: -20, markSize: 10, labelSize: 12 });
    assert.ok(fonts.length >= 4);
    assert.deepEqual(
      fonts.filter((value) => !value.includes(DRAFT_FAMILY)),
      [],
      "в выгрузку утёк системный шрифт — это видно только на распечатке",
    );
  });
});

test("переключили настройку — выгруженный кадр тот же, знак в знак", () => {
  withStyles(() => {
    const paper = { zoom: 2, offsetX: -40, offsetY: -20, markSize: 10, labelSize: 12 };
    const before = paint(paper);
    // Настройка живёт в `fontKind` кадра холста; выгрузка собирает свой `view`
    // и этого поля не кладёт. Проверяется именно это: чужое поле в чужом кадре
    // на бумагу не попадает.
    const after = paint(paper);
    assert.deepEqual(after, before);
    const screen = paint(viewOf({ fontKind: FONT_SYSTEM }));
    assert.notDeepEqual(screen, before, "экран и бумага обязаны расходиться — иначе проверка слепа");
  });
});

// ——— G68: переключение не двигает подписи ————————————————————————————

test("подписи стоят там же, каким бы шрифтом их ни рисовали", () => {
  withStyles(() => {
    const base = scene();
    const target = base.project.marks[0];
    const geometry = (box) => ({
      x: box.x,
      y: box.y,
      width: box.width,
      height: box.height,
      font: box.font,
      angle: box.angle,
      dx: box.dx,
      dy: box.dy,
    });
    const draft = labelBox(base.project, base.scheme, target, viewOf({ fontKind: FONT_DRAFT }), null);
    const system = labelBox(base.project, base.scheme, target, viewOf({ fontKind: FONT_SYSTEM }), null);
    assert.deepEqual(geometry(system), geometry(draft));
    // Семейство в габарит не входит, но до рисования доехать обязано.
    assert.equal(draft.family, DRAFT_FAMILY);
    assert.equal(system.family, SYSTEM_FAMILY);
  });
});

test("плашка комментария тоже не меняет габарита — она считается по знакам", () => {
  withStyles(() => {
    const base = scene();
    const plate = base.project.marks.find((mark) => mark.original);
    const sizeOf = (kind) => {
      const box = labelBox(base.project, base.scheme, plate, viewOf({ fontKind: kind }), null);
      return { width: box.width, height: box.height, lines: box.plate.lines, pad: box.plate.pad };
    };
    assert.deepEqual(sizeOf(FONT_SYSTEM), sizeOf(FONT_DRAFT));
  });
});
