// Колесо или трекпад — чистая функция от события.
//
// Заказчик работает на Mac: двумя пальцами он привык листать, а холст на этот
// жест зумил — браузер шлёт его теми же событиями колеса. Разделить их можно
// только по приметам самого события, и цена ошибки несимметрична: мышью зумят
// каждый день, поэтому «листать» включается только по прямой примете трекпада,
// а всё сомнительное остаётся зумом.
import test from "node:test";
import assert from "node:assert/strict";
import { canvasWheelKind } from "../src/canvas.js";

// Событие колеса: важны только приметы, по которым идёт разделение.
const wheel = (patch) => ({ ctrlKey: false, metaKey: false, deltaMode: 0, deltaX: 0, deltaY: 0, timeStamp: 0, ...patch });

test("щипок на трекпаде — это зум, как бы мелко ни шли шаги", () => {
  // Щипок двумя пальцами приходит колесом с поднятым ctrlKey — примета
  // надёжная, её и слушаем в первую очередь.
  assert.equal(canvasWheelKind(wheel({ ctrlKey: true, deltaY: -2.25 })), "zoom");
  assert.equal(canvasWheelKind(wheel({ ctrlKey: true, deltaY: 0.5, deltaX: 1.5 })), "zoom");
  // Ctrl с колесом мыши означает то же самое.
  assert.equal(canvasWheelKind(wheel({ ctrlKey: true, deltaY: 100 })), "zoom");
});

test("колесо мыши остаётся зумом", () => {
  // Chrome: один щелчок колеса — ровно 100 пикселей, без горизонтали.
  assert.equal(canvasWheelKind(wheel({ deltaY: 100 })), "zoom");
  assert.equal(canvasWheelKind(wheel({ deltaY: -100 })), "zoom");
  // Windows-раскладка драйвера: 120 за щелчок.
  assert.equal(canvasWheelKind(wheel({ deltaY: 120 })), "zoom");
  // Firefox шлёт строки, а не пиксели: строчный режим бывает только у колеса.
  assert.equal(canvasWheelKind(wheel({ deltaMode: 1, deltaY: 3 })), "zoom");
  assert.equal(canvasWheelKind(wheel({ deltaMode: 2, deltaY: 1 })), "zoom");
});

test("двухпальцевый скролл — это прокрутка: горизонталь, дробность и мелкий шаг", () => {
  // По диагонали: горизонтальная составляющая у колеса мыши не появляется.
  assert.equal(canvasWheelKind(wheel({ deltaX: -4, deltaY: 12 })), "pan");
  // Строго вертикально, но дробно — так колесо не умеет.
  assert.equal(canvasWheelKind(wheel({ deltaY: 2.5 })), "pan");
  // Строго вертикально и целым числом, но мелко: щелчок колеса столько не даёт.
  assert.equal(canvasWheelKind(wheel({ deltaY: 7 })), "pan");
  assert.equal(canvasWheelKind(wheel({ deltaY: -3 })), "pan");
});

test("разогнавшийся мах не переключается на зум посреди жеста", () => {
  // Палец разгоняется, и шаги к середине маха становятся крупными и целыми —
  // по приметам это уже колесо. Решение держится, пока идёт тот же жест.
  const start = canvasWheelKind(wheel({ deltaY: 3, timeStamp: 1000 }));
  assert.equal(start, "pan");
  const streak = { kind: start, time: 1000 };
  assert.equal(canvasWheelKind(wheel({ deltaY: 84, timeStamp: 1016 }), streak), "pan");
  assert.equal(canvasWheelKind(wheel({ deltaY: 96, timeStamp: 1032 }), { kind: "pan", time: 1016 }), "pan");

  // После паузы жест считается новым: то же событие — снова колесо и зум.
  assert.equal(canvasWheelKind(wheel({ deltaY: 84, timeStamp: 2000 }), { kind: "pan", time: 1032 }), "zoom");
});

test("щипок посреди прокрутки остаётся зумом, а не тянется серией", () => {
  // Пальцы на трекпаде не отрывали, но начали сводить: ctrlKey важнее серии —
  // иначе зум не включится, пока жест не кончится.
  assert.equal(canvasWheelKind(wheel({ ctrlKey: true, deltaY: -2, timeStamp: 1016 }), { kind: "pan", time: 1000 }), "zoom");
});
