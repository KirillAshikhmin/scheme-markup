// Колесо или трекпад — чистая функция от события.
//
// Заказчик работает на Mac: двумя пальцами он привык листать, а холст на этот
// жест зумил — браузер шлёт его теми же событиями колеса. Разделить их можно
// только по приметам самого события, и цена ошибки несимметрична: мышью зумят
// каждый день, поэтому «листать» включается только по прямой примете трекпада,
// а всё сомнительное остаётся зумом.
import test from "node:test";
import assert from "node:assert/strict";
import { canvasPinchWheel, canvasWheelKind, canvasZoomFactor } from "../src/canvas.js";

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

// ——— мера масштаба ————————————————————————————————————————————————————
//
// Щипок и колесо приходят одним событием, но мерить их одной мерой нельзя:
// щелчок колеса — это сто пикселей за раз, а щипок сыплет дробными единицами.
// Пока мера была общей, чтобы приблизить пальцами, приходилось долго сводить
// их — заказчик так и сказал: «прям очень не чувствительный».

// Путь жеста: события складываются, множители перемножаются.
const zoomOver = (steps, pinch) =>
  steps.reduce((total, deltaY) => total * canvasZoomFactor(wheel({ deltaY, ctrlKey: pinch }), pinch), 1);

test("щелчок колеса мыши остался прежней мерой", () => {
  // Один щелчок — около четырнадцати процентов масштаба. Эта мера заказчика
  // устраивает, и трогать её было нельзя.
  const notch = canvasZoomFactor(wheel({ deltaY: -100 }), false);
  assert.ok(notch > 1.14 && notch < 1.18, "щелчок колеса изменил свою меру: ×" + notch.toFixed(3));
  assert.ok(Math.abs(1 / canvasZoomFactor(wheel({ deltaY: 100 }), false) - notch) < 1e-9, "вверх и вниз несимметричны");
});

test("щипок на трекпаде двигает масштаб заметно, а не по капле", () => {
  // Жест на треть экрана — это около сотни единиц, разбитых на мелкие шаги.
  const gesture = new Array(40).fill(-2.5);
  assert.ok(zoomOver(gesture, true) >= 2, "щипок на треть экрана почти не приблизил: ×" + zoomOver(gesture, true).toFixed(2));
  // Та же сотня единиц колесом остаётся прежней: у колеса своя мера.
  assert.ok(zoomOver([-100], false) < 1.2, "колесо поехало вслед за щипком");
});

test("резкий щипок не перескакивает весь диапазон масштаба", () => {
  const jerk = canvasZoomFactor(wheel({ deltaY: -400, ctrlKey: true }), true);
  assert.ok(jerk <= 1.5, "одно событие меняет масштаб в " + jerk.toFixed(2) + " раз");
  // Весь диапазон холста — от 0,04 до 24, это 600 крат: одним рывком не пройти.
  assert.ok(Math.log(600) / Math.log(jerk) >= 10, "диапазон пролетает меньше чем за десяток событий");
  assert.ok(canvasZoomFactor(wheel({ deltaY: 400, ctrlKey: true }), true) >= 1 / 1.5);
});

test("мелкий щипок не застревает на месте", () => {
  const tiny = canvasZoomFactor(wheel({ deltaY: -0.5, ctrlKey: true }), true);
  assert.ok(tiny > 1, "самый мелкий шаг щипка не двигает масштаб вовсе");
  // Полсотни таких шагов — это уже заметное глазу приближение.
  assert.ok(zoomOver(new Array(50).fill(-0.5), true) > 1.2, "мелкими шагами масштаб не набирается");
});

test("Ctrl с колесом мыши мерится по-колесному, а не как щипок", () => {
  // Щипок узнаётся по мелкому дробному шагу; Ctrl+колесо шлёт те же сто целых.
  assert.equal(canvasPinchWheel(wheel({ ctrlKey: true, deltaY: -2.5 })), true);
  assert.equal(canvasPinchWheel(wheel({ ctrlKey: true, deltaY: -7 })), true);
  assert.equal(canvasPinchWheel(wheel({ ctrlKey: true, deltaY: -100 })), false);
  assert.equal(canvasPinchWheel(wheel({ ctrlKey: true, deltaMode: 1, deltaY: -3 })), false);
  assert.equal(canvasPinchWheel(wheel({ deltaY: -2.5 })), false, "без ctrlKey это прокрутка, а не щипок");
});
