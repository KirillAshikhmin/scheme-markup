// Разделы палитры фигур. Порядок фигур задаёт палитра, а разделы только
// расставляют по ней границы — и разойтись эти двое могут молча: добавили
// фигуру в конец палитры, а раздел ей не назвали, и в сетке она встала под
// чужим заголовком или без него.
import test from "node:test";
import assert from "node:assert/strict";

import { SHAPE_PALETTE } from "../src/model.js";
import { SHAPE_GROUPS, shapeGroups } from "../src/panels/types.js";
import { strings } from "../src/strings.js";

test("разделы покрывают палитру целиком и не меняют её порядок", () => {
  const groups = shapeGroups();
  assert.deepEqual(
    groups.flatMap((group) => group.shapes),
    SHAPE_PALETTE,
    "порядок фигур в разделах разошёлся с палитрой",
  );
  assert.deepEqual(
    groups.filter((group) => !group.key).map((group) => group.shapes),
    [],
    "фигура осталась без раздела: добавь её в SHAPE_GROUPS",
  );
  assert.equal(groups.length, SHAPE_GROUPS.length);
});

test("у каждого раздела есть название и хотя бы одна фигура", () => {
  for (const group of shapeGroups()) {
    assert.ok(group.shapes.length > 0, "пустой раздел: " + group.key);
    assert.equal(typeof strings.shapeGroups[group.key], "string", "раздел без названия: " + group.key);
  }
  const dead = Object.keys(strings.shapeGroups).filter(
    (key) => !SHAPE_GROUPS.some((group) => group.key === key),
  );
  assert.deepEqual(dead, [], "название есть, а такого раздела нет");
});

test("забытая фигура не пропадает из сетки, а встаёт группой без заголовка", () => {
  const groups = shapeGroups([...SHAPE_PALETTE, "circle-unknown"]);
  const last = groups[groups.length - 1];
  assert.equal(last.key, null);
  assert.deepEqual(last.shapes, ["circle-unknown"]);
});

// Заголовки нужны, чтобы семью было видно с одного взгляда. Раздел в пол-окна
// этого не даёт, а раздел из одной фигуры съедает ряд ради подписи.
test("разделы соразмерны: ни один не занимает больше трети палитры", () => {
  const groups = shapeGroups();
  const biggest = Math.max(...groups.map((group) => group.shapes.length));
  assert.ok(biggest <= Math.ceil(SHAPE_PALETTE.length / 2.5), "раздел разросся: " + biggest);
  const tiny = groups.filter((group) => group.shapes.length < 2).map((group) => group.key);
  assert.deepEqual(tiny, [], "раздел из одной фигуры: подпись дороже самой фигуры");
});
