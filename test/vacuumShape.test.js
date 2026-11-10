// Знак «РП» у готового объекта: трапеция шаблона → круг со срезом (таск 280,
// требование G414).
//
// Таск 270 сменил знак робота-пылесоса **в шаблоне**, и у заказчика не
// изменилось ничего: справочник копируется при создании объекта. Ответ
// 2026-11-10 — «Да», то есть точечная миграция при открытии. Здесь проверяется
// ровно то, из-за чего она опасна:
//
//   1. **Условие узкое.** Код «РП» + знак ровно `trapezoid-bar` + своего
//      изображения не названо. Любое из трёх не сошлось — тот же объект по
//      ссылке, без правок и без шага истории.
//   2. **Меняется ровно знак.** Сверка идёт целиком, по всем полям объекта: у
//      настоящего старого объекта расходится **один** путь, и это
//      `markTypes[*].shape` у «РП». Метки, номера, подписи и счётчики — те же.
//   3. **Обе трубы открытия** (файл и база браузера) отвечают одинаково: иначе
//      один объект открывался бы по-разному из архива и из IndexedDB (G68).
//   4. **Робот не пропадает.** Изображение `vacuum` заявляет оба знака, и
//      развёртка с объёмом не замечают смены.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { createProject, migrateVacuumShape, labelOf, styleOf, typeViewName } from "../src/model.js";
import { packProject, unpackProject } from "../src/projectFile.js";
import { projectsMigrateStored } from "../src/panels/projects.js";
import { objectViewForShape } from "../src/objectViews/registry.js";

import { legacyIdsRestored } from "./fixtures/legacyIds.js";

const HERE = dirname(fileURLToPath(import.meta.url));
// Настоящий объект прежней сборки: полный стартовый справочник того времени, в
// нём «РП» трапецией и без имени изображения — ровно так он лежит и в трёх
// объектах заказчика из четырёх.
const LEGACY_TEXT = readFileSync(join(HERE, "legacy-views-project.json"), "utf8");
const legacy = () => JSON.parse(LEGACY_TEXT);

const WAS = "trapezoid-bar";
const NOW = "circle-cut";

const byCode = (project, code) => project.markTypes.find((type) => type.code === code);

// Объект, у которого «РП» заведён как у заказчика, плюс сосед с той же
// трапецией под другим кодом: по нему видно, что миграция смотрит на код.
function scene(patch = {}) {
  return {
    formatVersion: 5,
    id: "object-1",
    name: "Объект",
    categories: [{ id: "cat-1", name: "Бытовая техника", color: "#000000" }],
    markTypes: [
      {
        id: "type-1",
        categoryId: "cat-1",
        code: "РП",
        name: "Робот пылесос",
        shape: WAS,
        kind: "point",
        blockMode: "each",
        channels: 1,
        lineStyle: null,
        sizes: { length: 350, width: 100, depth: 100, heightAboveFloor: 0 },
        order: 40,
        ...patch,
      },
      { id: "type-2", categoryId: "cat-1", code: "ВЫТ", name: "Вытяжка", shape: WAS, kind: "point", channels: 1 },
    ],
    schemes: [],
    marks: [],
    rooms: [],
    outlines: [],
    groups: [],
    counters: {},
  };
}

// Все пути, которыми два объекта расходятся: по ним видно не «что-то
// изменилось», а **что именно**.
function diffPaths(before, after, path = "") {
  if (before === after) return [];
  const both = before && after && typeof before === "object" && typeof after === "object";
  if (!both) return before === after ? [] : [path || "/"];
  if (Array.isArray(before) !== Array.isArray(after)) return [path || "/"];
  const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])];
  const rows = [];
  for (const key of keys) rows.push(...diffPaths(before[key], after[key], path + "/" + key));
  return rows;
}

// ——— условие: три слова, и каждое проверено ——————————————————————————————

test("наследственный «РП» получает круг со срезом, и в типе не меняется больше ни одно поле", () => {
  const project = scene();
  const result = migrateVacuumShape(project);
  assert.equal(result.changed, true);
  assert.equal(result.fixed, 1);
  const was = byCode(project, "РП");
  const now = byCode(result.project, "РП");
  assert.equal(now.shape, NOW);
  assert.deepEqual(diffPaths(project, result.project), ["/markTypes/0/shape"], "миграция задела что-то кроме знака");
  // Поля типа перебраны поимённо: ни одного нового ключа и ни одного ушедшего.
  assert.deepEqual(Object.keys(now), Object.keys(was));
  for (const key of Object.keys(was)) {
    if (key === "shape") continue;
    assert.deepEqual(now[key], was[key], key + ": задето поле типа");
  }
  // Знак читают через модель, и она отдаёт новый — то есть легенда и план
  // рисуют круг.
  assert.equal(styleOf(result.project, now.id).shape, NOW);
  // Исходный объект не тронут: модель возвращает новый, а не правит на месте.
  assert.equal(byCode(project, "РП").shape, WAS);
});

test("сосед с той же трапецией под другим кодом остаётся трапецией", () => {
  const after = migrateVacuumShape(scene()).project;
  assert.equal(byCode(after, "ВЫТ").shape, WAS, "миграция пошла по знаку, а не по коду");
});

test("своё изображение — выбор человека: ни `view`, ни `icon` не перетолковываются", () => {
  for (const patch of [{ view: "vacuum" }, { view: "robotVacuum" }, { icon: "vacuum" }]) {
    const project = scene(patch);
    const result = migrateVacuumShape(project);
    assert.equal(result.project, project, JSON.stringify(patch) + ": тип со своим изображением тронут");
    assert.equal(result.changed, false);
    assert.equal(result.fixed, 0);
  }
});

test("другой знак не трогается, и уже круглый — тоже", () => {
  for (const shape of [NOW, "circle-ring", "square", null]) {
    const project = scene({ shape });
    assert.equal(migrateVacuumShape(project).project, project, String(shape) + ": знак переписан");
  }
});

test("объекту без «РП», без справочника и вовсе пустому миграция ничего не делает", () => {
  const plain = { markTypes: [{ id: "t", code: "Т", shape: WAS }] };
  assert.equal(migrateVacuumShape(plain).project, plain);
  for (const value of [null, undefined, {}, { markTypes: null }]) {
    const result = migrateVacuumShape(value);
    assert.equal(result.project, value);
    assert.equal(result.changed, false);
  }
});

test("второй проход ничего не переписывает: миграция идемпотентна", () => {
  const once = migrateVacuumShape(scene()).project;
  assert.equal(migrateVacuumShape(once).project, once, "знак сменился второй раз");
});

test("новый объект миграции не замечает: в шаблоне знак уже круглый, и изображение названо", () => {
  const fresh = createProject();
  assert.equal(byCode(fresh, "РП").shape, NOW);
  assert.equal(migrateVacuumShape(fresh).project, fresh);
});

// ——— обе трубы открытия ——————————————————————————————————————————————————

test("обе трубы открытия меняют знак «РП» одинаково", async () => {
  const file = await packProject(legacy(), new Map());
  const loaded = (await unpackProject(file)).project;
  const stored = projectsMigrateStored(legacy());
  assert.equal(byCode(loaded, "РП").shape, NOW, "труба файла знак не сменила");
  assert.equal(byCode(stored, "РП").shape, NOW, "труба базы знак не сменила");
  assert.equal(JSON.stringify(loaded.markTypes), JSON.stringify(stored.markTypes), "трубы перевели справочник по-разному");
  // Второе открытие объекта из базы — тот же объект по ссылке: правка одна и
  // один раз.
  assert.equal(projectsMigrateStored(stored), stored);
});

test("рука назвала изображение — обе трубы оставляют трапецию", async () => {
  const chosen = () => {
    const project = legacy();
    const type = byCode(project, "РП");
    type.view = "vacuum";
    return project;
  };
  const loaded = (await unpackProject(await packProject(chosen(), new Map()))).project;
  const stored = projectsMigrateStored(chosen());
  assert.equal(byCode(loaded, "РП").shape, WAS, "труба файла переписала выбор человека");
  assert.equal(byCode(stored, "РП").shape, WAS, "труба базы переписала выбор человека");
});

// ——— G68: у настоящего старого объекта расходится один путь ————————————————

test("G68: старый объект открывается прежним, кроме знака «РП» — ровно одно поле", () => {
  const before = legacy();
  const stored = projectsMigrateStored(before);
  // Открытие нумерует объект (ADR 030), поэтому имена возвращаются прежними:
  // сверка говорит о разметке, а не о перенумерации.
  const same = legacyIdsRestored(before, stored);
  const at = before.markTypes.findIndex((type) => type.code === "РП");
  assert.ok(at >= 0);
  assert.deepEqual(
    diffPaths({ ...before, formatVersion: null }, { ...same, formatVersion: null }),
    ["/markTypes/" + at + "/shape"],
    "открытие тронуло не только знак «РП»",
  );
  // То же самое другими словами — по тому, что видит человек: метки, номера и
  // подписи не шевельнулись ни одной.
  assert.deepEqual(same.marks, before.marks);
  assert.deepEqual(same.counters, before.counters);
  assert.deepEqual(
    stored.marks.map((mark) => labelOf(stored, mark.id)),
    before.marks.map((mark) => labelOf(before, mark.id)),
  );
});

// ——— робот на развёртке и в объёме остаётся ———————————————————————————————

test("изображение `vacuum` заявляет оба знака, и смена знака его не уносит", () => {
  // G68 таска 270: трапеция осталась в реестре за роботом нарочно — иначе у
  // готового объекта пропали бы рисунок на развёртке и тело в объёме.
  assert.equal(objectViewForShape(WAS).name, "vacuum");
  assert.equal(objectViewForShape(NOW).name, "vacuum");
  const before = legacy();
  const type = byCode(before, "РП");
  assert.equal(typeViewName(before, type.id), "vacuum");
  const after = migrateVacuumShape(before).project;
  assert.equal(typeViewName(after, byCode(after, "РП").id), "vacuum", "смена знака унесла робота");
});
