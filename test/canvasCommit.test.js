// Опции команды отмены. Это единственная дверь, через которую идут все правки
// объекта, и один раз она уже пропустила ошибку молча: четвёртым аргументом
// передавали список выделения, а ждала она объект — выделение подменялось
// прежним, ручки «+» у поставленной метки не появлялись, и так четыре таска.
// Опечатка в ключе (`selecton`) даст ровно то же молчание, поэтому разбор
// опций придирчив: неизвестный ключ — отказ, а не подстановка по умолчанию.
import test from "node:test";
import assert from "node:assert/strict";
import { canvasCommitOptions } from "../src/canvas.js";

test("известные ключи проходят как есть", () => {
  const options = { selection: ["a"], schemeId: "s1", patch: { mode: "select" } };
  assert.deepEqual(canvasCommitOptions(options), options);
  assert.deepEqual(canvasCommitOptions(), {});
  assert.deepEqual(canvasCommitOptions(null), {});
});

test("опечатка в ключе — отказ, а не тихая подстановка", () => {
  // В тексте назван ключ, из-за которого отказ: иначе искать его в вызове долго.
  assert.throws(() => canvasCommitOptions({ selecton: ["a"] }), {
    code: "unknownCommitOption",
    message: /selecton/,
  });
});

test("список выделения вместо объекта опций — тоже отказ", () => {
  // Старая форма вызова: `canvasCommit(before, after, label, [markId])`.
  assert.throws(() => canvasCommitOptions(["mark-1"]), { code: "commitOptionsNotObject" });
});
