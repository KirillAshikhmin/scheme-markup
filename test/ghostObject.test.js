// Призрак вещи под рукой рисуется тем же кодом, что и вставшая вещь
// (таск 168, G248).
//
// Заказчик призрака не видел: «при размещении объекта на чертеже сразу
// отрисовывай его при перемещении курсора по чертежу, что бы было понятно как и
// куда ставится, а то просто тыкаешь и куда-то рядом встало». Нарисован он был
// с таска 164 — но своим кодом: голый пунктирный контур без заливки, а числа
// поперёк середины габарита. Вставшая вещь выглядела иначе: лиловая заливка и
// сплошной контур. Показанное и полученное не совпадали ни видом, ни местом
// строки, и на пёстром плане тонкая вещь пропадала под собственной строкой — у
// радиатора 1200 × 100 габарит выходит 90 × 7 точек экрана, а строка размеров
// 75 × 12.
//
// Имени над габаритом нет больше ни у призрака, ни у вставшей вещи (таск 258,
// G399): подписи вещей убраны с чертежа совсем. Правило G248 от этого только
// окрепло — назови себя призрак, он снова обещал бы не то, что встанет.
//
// Холста в Node нет, и проверяется не картинка, а то, из чего она сложилась:
// кадр призрака обязан состоять из тех же вызовов, что кадр вещи, кроме
// названных трёх примет призрака — полсилы цвета, пунктир и обрамляющая пара
// `save`/`restore`. Один лишний `fillStyle` — и призрак снова начнёт обещать
// не то.
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
  const placed = frameOf(radiator, {});
  const ghost = frameOf(radiator, { ghost: true });
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

test("у призрака есть заливка — то, чего у прежнего не было", () => {
  const ghost = frameOf(radiator, { ghost: true });
  assert.ok(ghost.some((line) => line.startsWith("fillStyle=rgba(102, 57, 186")), "габарит призрака не залит");
  assert.ok(ghost.some((line) => line.includes("fill()")), "заливка не нарисована");
  // Пунктир снимается до конца кадра: штрихом держится только контур вещи, а
  // ступени лестницы под ним рисуются сплошными.
  assert.ok(ghost.lastIndexOf("setLineDash([])") > ghost.indexOf("setLineDash([5,4])"), "пунктир остался на холсте");
});

test("таск 258: вещь на чертеже не подписана — ни вставшая, ни призрак", () => {
  // Слова заказчика: «У объектов на чертеже сейчас подписи, которые не скрыть и
  // не перенести, их надо бы вообще убрать». Ни одной буквы на холст: ни имени,
  // ни верха над полом, ни подложки под ними. Имя вещи человек читает в строке
  // списка, в плашке выделенной вещи и в карточке связанной метки.
  for (const options of [{}, { ghost: true }]) {
    const frame = frameOf(radiator, options);
    const words = frame.filter((line) => line.startsWith("fillText(") || line.startsWith("strokeText("));
    assert.deepEqual(words, [], "вещь на чертеже снова подписана: " + words.join(" | "));
  }
  // И старый довод `name` подписи не возвращает: его не существует вовсе.
  const named = frameOf(radiator, { name: "Радиатор" });
  assert.deepEqual(named, frameOf(radiator, {}), "довод `name` снова что-то рисует");
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
  const placed = frameOf(band, {});
  const ghost = frameOf(band, { ghost: true });
  assert.deepEqual(
    ghost.filter((line) => !ghostMarks(line)),
    placed.filter((line) => !ghostMarks(line)),
  );
});
