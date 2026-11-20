// Дерево порядка на вырожденной сцене (правка 2026-11-21, дефект заказчика:
// «Maximum call stack size exceeded» в `volumeOrderNode` на большом объекте).
// У выпуклого тела каждая грань оставляет все остальные по одну сторону, и
// дерево вырождается в цепочку глубиной в число граней. Сборка, вставка и
// обход обязаны пройти её без рекурсии.
import test from "node:test";
import assert from "node:assert/strict";
import { volumeOrderAll, volumeOrderInsert, volumeOrderTree, volumeOrderWalk } from "../src/volume/order.js";

function ringFaces(count, radius = 5000) {
  const faces = [];
  for (let at = 0; at < count; at += 1) {
    const a = (at * Math.PI * 2) / count;
    const b = ((at + 1) * Math.PI * 2) / count;
    const ax = Math.cos(a) * radius;
    const ay = Math.sin(a) * radius;
    const bx = Math.cos(b) * radius;
    const by = Math.sin(b) * radius;
    const mid = (a + b) / 2;
    faces.push({
      p: [{ x: ax, y: ay, z: 0 }, { x: bx, y: by, z: 0 }, { x: bx, y: by, z: 1000 }, { x: ax, y: ay, z: 1000 }],
      n: { x: Math.cos(mid), y: Math.sin(mid), z: 0 },
      rgb: [200, 200, 200],
    });
  }
  return faces;
}

function depthOf(tree) {
  let deepest = 0;
  const stack = tree ? [[tree, 1]] : [];
  while (stack.length > 0) {
    const [node, depth] = stack.pop();
    if (depth > deepest) deepest = depth;
    if (node.front) stack.push([node.front, depth + 1]);
    if (node.back) stack.push([node.back, depth + 1]);
  }
  return deepest;
}

const DEEP = process.env.VOLUME_ORDER_DEEP === "1";

// Сама проверка идёт в дочернем процессе с урезанным стеком (`--stack-size`):
// на обычном стеке Node глубины в девятьсот узлов хватает и рекурсии, а у
// браузера заказчика на настоящем объекте — нет.
test("дерево порядка глубиной в сотни узлов строится, дополняется и обходится на малом стеке", { skip: DEEP }, async () => {
  const { spawnSync } = await import("node:child_process");
  const { fileURLToPath } = await import("node:url");
  const run = spawnSync(process.execPath, ["--stack-size=120", fileURLToPath(import.meta.url)], {
    env: { ...process.env, VOLUME_ORDER_DEEP: "1" },
    encoding: "utf8",
  });
  assert.equal(run.status, 0, "на малом стеке дерево не собралось:\n" + String(run.stdout).slice(-1500));
});

test("дерево порядка: сборка, вставка и обход без рекурсии", { skip: !DEEP }, () => {
  const count = 12000;
  const faces = ringFaces(count);
  const tree = volumeOrderTree(faces);
  // Сцена и правда глубокая: иначе тест ничего не держит.
  assert.ok(depthOf(tree) > 500, "дерево неглубокое: " + depthOf(tree));
  assert.equal(tree.count, count);
  const eye = { x: 0, y: 0, z: 500 };
  assert.equal(volumeOrderWalk(tree, eye).length, count);
  assert.equal(volumeOrderAll(tree).length, count);
  // Вставка идёт по той же глубине.
  const extra = { p: [{ x: -100, y: -100, z: 500 }, { x: 100, y: -100, z: 500 }, { x: 100, y: 100, z: 500 }, { x: -100, y: 100, z: 500 }], n: { x: 0, y: 0, z: 1 }, rgb: [1, 2, 3] };
  const more = volumeOrderInsert(tree, [extra]);
  assert.equal(more.count, count + 1);
  assert.equal(volumeOrderWalk(more, eye).length, count + 1);
  // Готовое дерево вставкой не тронуто.
  assert.equal(tree.count, count);
});
