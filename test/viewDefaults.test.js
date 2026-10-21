// Умолчание размеров знака и подписи — одно на сборку (находка 3 разбора
// механик).
//
// Чисел было три набора: `DEFAULT_VIEW` модели (16 и 20), свои у отрисовки
// (10 и 12) и свои же инлайном у ползунков и у холста. Два из них — те самые
// прежние, которые заказчик отверг: «Прежние 12 пикселей давали 1,9 мм, и
// проверяющий выгрузил схему, так и не узнав, что регулятор вообще есть».
//
// Путь к ним живой: `createProject` поле `view` заводит, а приёмка
// загруженного файла (`adoptLoadedProject`) растекает `...source` и своего
// `view` не добавляет. На объекте без этого поля отрисовка брала отвергнутый
// кегль, а раздел «Размеры» падал: там защищались от «нет объекта», а не от
// «объект без `view`».
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { DEFAULT_VIEW, createProject, projectViewSizes } from "../src/model.js";
import { renderInternals } from "../src/render.js";
import { adoptLoadedProject } from "../src/autosave.js";

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = join(here, "..", "src");

test("новый объект получает умолчание и носит его в себе", () => {
  const project = createProject({ name: "Квартира" });
  assert.deepEqual(projectViewSizes(project), { markSize: 16, labelSize: 20 });
  assert.equal(project.view.markSize, DEFAULT_VIEW.markSize);
  assert.equal(project.view.labelSize, DEFAULT_VIEW.labelSize);
});

test("объект без поля view рисуется умолчанием, а не отвергнутыми 10 и 12", () => {
  const bare = { ...createProject({ name: "Чужой файл" }) };
  delete bare.view;
  assert.deepEqual(projectViewSizes(bare), { markSize: 16, labelSize: 20 });
  // Пустое и неполное поле — то же самое: `view: {}` приходит от сборки руками,
  // а одно число из двух — от правки файла.
  assert.deepEqual(projectViewSizes({ view: {} }), { markSize: 16, labelSize: 20 });
  assert.deepEqual(projectViewSizes({ view: { markSize: 9 } }), { markSize: 9, labelSize: 20 });
  assert.equal(projectViewSizes(null).labelSize, 20);
});

test("приёмка загруженного файла без view не роняет чтение размеров", () => {
  // Ровно тот объект, на котором падал раздел «Размеры»: поля `view` нет, и
  // раньше `state.project.view` отдавал `undefined`, а `.markSize` на нём —
  // `TypeError` с английским текстом в плашке.
  const source = { ...createProject({ name: "Объект из архива" }) };
  delete source.view;
  const adopted = adoptLoadedProject({ project: source, images: new Map() });
  assert.equal(adopted.project.view, undefined, "приёмка поля не заводит — объект не правится (G68)");
  assert.deepEqual(projectViewSizes(adopted.project), { markSize: 16, labelSize: 20 });
});

test("отрисовка без view берёт то же умолчание", () => {
  const empty = renderInternals.renderView({});
  assert.equal(empty.markSize, DEFAULT_VIEW.markSize);
  assert.equal(empty.labelSize, DEFAULT_VIEW.labelSize);
  // `undefined` в поле — не значение: растекание чужого `view` приносило его, и
  // радиус знака отвечал `NaN` (таск 138).
  const spread = renderInternals.renderView({ markSize: undefined, labelSize: undefined, zoom: 1 });
  assert.equal(spread.markSize, DEFAULT_VIEW.markSize);
  assert.equal(spread.labelSize, DEFAULT_VIEW.labelSize);
  assert.ok(Number.isFinite(renderInternals.labelFontSize(renderInternals.renderView({}))));
});

test("G68: у объекта со своими числами не меняется ничего", () => {
  // Объект прежней сборки, у которого в `view` записаны те самые 10 и 12.
  // Умолчание его не касается: свои числа старше любого умолчания.
  const legacy = JSON.parse(readFileSync(join(here, "legacy-drawing-project.json"), "utf8"));
  assert.deepEqual(legacy.view, { zoom: 1, offsetX: 0, offsetY: 0, markSize: 10, labelSize: 12 });
  assert.deepEqual(projectViewSizes(legacy), { markSize: 10, labelSize: 12 });
  const view = renderInternals.renderView(legacy.view);
  assert.equal(view.markSize, 10);
  assert.equal(view.labelSize, 12);
});

test("второго умолчания в исходниках нет", () => {
  // Сканированием, а не доверием: разойдись числа снова — объект без `view`
  // опять уехал бы в печать отвергнутым кеглем, и прогон бы об этом молчал.
  const files = ["render.js", "canvas.js", "exporter.js", join("panels", "tools.js")];
  for (const name of files) {
    const text = readFileSync(join(srcDir, name), "utf8");
    const lines = text.split("\n");
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      if (line.trimStart().startsWith("//") || line.trimStart().startsWith("*")) continue;
      assert.ok(
        !/markSize:\s*\d/.test(line) || /DEFAULT_VIEW/.test(line),
        `${name}:${index + 1} — размер знака числом мимо DEFAULT_VIEW: ${line.trim()}`,
      );
      assert.ok(
        !/labelSize:\s*\d/.test(line) || /DEFAULT_VIEW/.test(line),
        `${name}:${index + 1} — размер подписи числом мимо DEFAULT_VIEW: ${line.trim()}`,
      );
      assert.ok(
        !/markSize\s*\|\|\s*\d/.test(line),
        `${name}:${index + 1} — своё умолчание размера знака: ${line.trim()}`,
      );
    }
  }
});
