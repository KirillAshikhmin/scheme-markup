// Призрак вещи под рукой рисуется тем же кодом, что и вставшая вещь
// (таск 168, G248).
//
// Заказчик призрака не видел: «при размещении объекта на чертеже сразу
// отрисовывай его при перемещении курсора по чертежу, что бы было понятно как и
// куда ставится, а то просто тыкаешь и куда-то рядом встало». Нарисован он был
// с таска 164 — но своим кодом: голый пунктирный контур без заливки и без
// имени, а числа поперёк середины габарита. Вставшая вещь выглядела иначе:
// лиловая заливка, сплошной контур, имя над габаритом. Показанное и полученное
// не совпадали ни видом, ни местом строки, и на пёстром плане тонкая вещь
// пропадала под собственной подписью — у радиатора 1200 × 100 габарит выходит
// 90 × 7 точек экрана, а строка размеров 75 × 12.
//
// Холста в Node нет, и проверяется не картинка, а то, из чего она сложилась:
// кадр призрака обязан состоять из тех же вызовов, что кадр вещи, кроме
// названных трёх примет призрака — полсилы цвета, пунктир и обрамляющая пара
// `save`/`restore`. Один лишний `fillStyle` или пропавший `fillText` — и
// призрак снова начнёт обещать не то.
import test from "node:test";
import assert from "node:assert/strict";

import { DRAWING_GHOST_ALPHA, DRAWING_GHOST_DASH, drawDrawingObject, drawingUnitBridge } from "../src/render.js";

const viewOf = (patch) => ({ zoom: 1, offsetX: 0, offsetY: 0, markSize: 10, labelSize: 12, ...patch });

// Холст-писец: записывает каждый вызов и каждое присваивание.
function scribe() {
  const log = [];
  const impl = {
    canvas: { width: 1200, height: 900 },
    measureText: (value) => ({ width: String(value).length * 7 }),
    getTransform: () => ({ a: 1 }),
  };
  return {
    log,
    ctx: new Proxy(impl, {
      get(target, key) {
        if (key in target) return target[key];
        return (...args) => log.push(String(key) + "(" + args.map((value) => JSON.stringify(value)).join(",") + ")");
      },
      set(target, key, value) {
        log.push(String(key) + "=" + String(value));
        target[key] = value;
        return true;
      },
    }),
  };
}

const radiator = {
  shape: "rect",
  atMm: { x: 2000, y: 1500 },
  widthMm: 1200,
  depthMm: 100,
  turnDeg: 0,
  heightMm: 500,
  heightAboveFloorMm: 150,
};

function frameOf(object, options) {
  const probe = scribe();
  drawDrawingObject(probe.ctx, drawingUnitBridge(viewOf({ zoom: 0.5 })), object, options);
  return probe.log;
}

// Приметы призрака — и только они. Всё остальное обязано совпасть.
const ghostMarks = (line) =>
  line === "save()" ||
  line === "restore()" ||
  line === "globalAlpha=" + DRAWING_GHOST_ALPHA ||
  line === "setLineDash(" + JSON.stringify(DRAWING_GHOST_DASH) + ")";

test("призрак вещи и вставшая вещь — один и тот же кадр с точностью до пунктира", () => {
  const placed = frameOf(radiator, { name: "Радиатор" });
  const ghost = frameOf(radiator, { name: "Радиатор", ghost: true });
  assert.notDeepEqual(placed, ghost, "призрак ничем не отличается от вещи — его не отличить и глазом");
  assert.deepEqual(
    ghost.filter((line) => !ghostMarks(line)),
    placed.filter((line) => !ghostMarks(line)),
    "призрак рисуется не тем же кодом, что вещь",
  );
  // Названные приметы на месте: вполсилы и пунктиром.
  assert.ok(ghost.includes("globalAlpha=" + DRAWING_GHOST_ALPHA), "призрак не вполсилы");
  assert.ok(ghost.includes("setLineDash(" + JSON.stringify(DRAWING_GHOST_DASH) + ")"), "контур призрака не пунктирный");
  assert.ok(ghost.includes("save()") && ghost.includes("restore()"), "призрак не вернул холст как было");
});

test("у призрака есть и заливка, и имя — то, чего у прежнего не было", () => {
  const ghost = frameOf(radiator, { name: "Радиатор", ghost: true });
  assert.ok(ghost.some((line) => line.startsWith("fillStyle=rgba(102, 57, 186")), "габарит призрака не залит");
  assert.ok(ghost.some((line) => line.includes("fill()")), "заливка не нарисована");
  assert.ok(
    ghost.some((line) => line.includes("fillText(") && line.includes("Радиатор")),
    "призрак не называет вещь по имени",
  );
  // Подпись не пунктирная: штрихом держится только контур.
  const dashOff = ghost.lastIndexOf("setLineDash([])");
  const caption = ghost.findIndex((line) => line.includes("fillText(") && line.includes("Радиатор"));
  assert.ok(dashOff >= 0 && caption > dashOff, "имя вещи написано пунктиром");
});

test("полоса тоже рисуется призраком тем же кодом", () => {
  const band = {
    shape: "polyline",
    pointsMm: [
      { x: 0, y: 0 },
      { x: 2000, y: 0 },
      { x: 2000, y: 900 },
    ],
    depthMm: 600,
  };
  const placed = frameOf(band, { name: "Столешница" });
  const ghost = frameOf(band, { name: "Столешница", ghost: true });
  assert.deepEqual(
    ghost.filter((line) => !ghostMarks(line)),
    placed.filter((line) => !ghostMarks(line)),
  );
});
