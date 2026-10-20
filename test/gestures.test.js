// Разбор жеста над полотном — чистая функция от события.
//
// Заказчик работает на Mac: двумя пальцами он привык листать, а холст на этот
// жест зумил — браузер шлёт его теми же событиями колеса. Разделить их можно
// только по приметам самого события, и цена ошибки несимметрична: мышью зумят
// каждый день, поэтому «листать» включается только по прямой примете трекпада,
// а всё сомнительное остаётся зумом.
//
// С таска 162 (G241) этот разбор — **один модуль на три поверхности**: план,
// чертёж и окно загрузки плана. Поэтому здесь держится и то, что приметы
// остались теми же, и то, что своего разбора в поверхностях не завелось
// обратно: сверка идёт сканированием исходников.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  GESTURE_CLOSE_MIN,
  gestureDraftClick,
  gestureDraftEnd,
  gesturePinchOf,
  gesturePinchStep,
  gestureWheel,
  gestureWheelKind,
  gestureWheelPinch,
  gestureZoomFactor,
} from "../src/gestures.js";

// Событие колеса: важны только приметы, по которым идёт разделение.
const wheel = (patch) => ({ ctrlKey: false, metaKey: false, deltaMode: 0, deltaX: 0, deltaY: 0, timeStamp: 0, ...patch });

test("щипок на трекпаде — это зум, как бы мелко ни шли шаги", () => {
  // Щипок двумя пальцами приходит колесом с поднятым ctrlKey — примета
  // надёжная, её и слушаем в первую очередь.
  assert.equal(gestureWheelKind(wheel({ ctrlKey: true, deltaY: -2.25 })), "zoom");
  assert.equal(gestureWheelKind(wheel({ ctrlKey: true, deltaY: 0.5, deltaX: 1.5 })), "zoom");
  // Ctrl с колесом мыши означает то же самое.
  assert.equal(gestureWheelKind(wheel({ ctrlKey: true, deltaY: 100 })), "zoom");
});

test("колесо мыши остаётся зумом", () => {
  // Chrome: один щелчок колеса — ровно 100 пикселей, без горизонтали.
  assert.equal(gestureWheelKind(wheel({ deltaY: 100 })), "zoom");
  assert.equal(gestureWheelKind(wheel({ deltaY: -100 })), "zoom");
  // Windows-раскладка драйвера: 120 за щелчок.
  assert.equal(gestureWheelKind(wheel({ deltaY: 120 })), "zoom");
  // Firefox шлёт строки, а не пиксели: строчный режим бывает только у колеса.
  assert.equal(gestureWheelKind(wheel({ deltaMode: 1, deltaY: 3 })), "zoom");
  assert.equal(gestureWheelKind(wheel({ deltaMode: 2, deltaY: 1 })), "zoom");
});

test("двухпальцевый скролл — это прокрутка: горизонталь, дробность и мелкий шаг", () => {
  // По диагонали: горизонтальная составляющая у колеса мыши не появляется.
  assert.equal(gestureWheelKind(wheel({ deltaX: -4, deltaY: 12 })), "pan");
  // Строго вертикально, но дробно — так колесо не умеет.
  assert.equal(gestureWheelKind(wheel({ deltaY: 2.5 })), "pan");
  // Строго вертикально и целым числом, но мелко: щелчок колеса столько не даёт.
  assert.equal(gestureWheelKind(wheel({ deltaY: 7 })), "pan");
  assert.equal(gestureWheelKind(wheel({ deltaY: -3 })), "pan");
});

test("разогнавшийся мах не переключается на зум посреди жеста", () => {
  // Палец разгоняется, и шаги к середине маха становятся крупными и целыми —
  // по приметам это уже колесо. Решение держится, пока идёт тот же жест.
  const start = gestureWheelKind(wheel({ deltaY: 3, timeStamp: 1000 }));
  assert.equal(start, "pan");
  const streak = { kind: start, time: 1000 };
  assert.equal(gestureWheelKind(wheel({ deltaY: 84, timeStamp: 1016 }), streak), "pan");
  assert.equal(gestureWheelKind(wheel({ deltaY: 96, timeStamp: 1032 }), { kind: "pan", time: 1016 }), "pan");

  // После паузы жест считается новым: то же событие — снова колесо и зум.
  assert.equal(gestureWheelKind(wheel({ deltaY: 84, timeStamp: 2000 }), { kind: "pan", time: 1032 }), "zoom");
});

test("щипок посреди прокрутки остаётся зумом, а не тянется серией", () => {
  // Пальцы на трекпаде не отрывали, но начали сводить: ctrlKey важнее серии —
  // иначе зум не включится, пока жест не кончится.
  assert.equal(gestureWheelKind(wheel({ ctrlKey: true, deltaY: -2, timeStamp: 1016 }), { kind: "pan", time: 1000 }), "zoom");
});

// ——— мера масштаба ————————————————————————————————————————————————————
//
// Щипок и колесо приходят одним событием, но мерить их одной мерой нельзя:
// щелчок колеса — это сто пикселей за раз, а щипок сыплет дробными единицами.
// Пока мера была общей, чтобы приблизить пальцами, приходилось долго сводить
// их — заказчик так и сказал: «прям очень не чувствительный».

// Путь жеста: события складываются, множители перемножаются.
const zoomOver = (steps, pinch) =>
  steps.reduce((total, deltaY) => total * gestureZoomFactor(wheel({ deltaY, ctrlKey: pinch }), pinch), 1);

test("щелчок колеса мыши остался прежней мерой", () => {
  // Один щелчок — около четырнадцати процентов масштаба. Эта мера заказчика
  // устраивает, и трогать её было нельзя.
  const notch = gestureZoomFactor(wheel({ deltaY: -100 }), false);
  assert.ok(notch > 1.14 && notch < 1.18, "щелчок колеса изменил свою меру: ×" + notch.toFixed(3));
  assert.ok(Math.abs(1 / gestureZoomFactor(wheel({ deltaY: 100 }), false) - notch) < 1e-9, "вверх и вниз несимметричны");
});

test("щипок на трекпаде двигает масштаб заметно, а не по капле", () => {
  // Жест на треть экрана — это около сотни единиц, разбитых на мелкие шаги.
  const gesture = new Array(40).fill(-2.5);
  assert.ok(zoomOver(gesture, true) >= 2, "щипок на треть экрана почти не приблизил: ×" + zoomOver(gesture, true).toFixed(2));
  // Та же сотня единиц колесом остаётся прежней: у колеса своя мера.
  assert.ok(zoomOver([-100], false) < 1.2, "колесо поехало вслед за щипком");
});

test("резкий щипок не перескакивает весь диапазон масштаба", () => {
  const jerk = gestureZoomFactor(wheel({ deltaY: -400, ctrlKey: true }), true);
  assert.ok(jerk <= 1.5, "одно событие меняет масштаб в " + jerk.toFixed(2) + " раз");
  // Весь диапазон холста — от 0,04 до 24, это 600 крат: одним рывком не пройти.
  assert.ok(Math.log(600) / Math.log(jerk) >= 10, "диапазон пролетает меньше чем за десяток событий");
  assert.ok(gestureZoomFactor(wheel({ deltaY: 400, ctrlKey: true }), true) >= 1 / 1.5);
});

test("мелкий щипок не застревает на месте", () => {
  const tiny = gestureZoomFactor(wheel({ deltaY: -0.5, ctrlKey: true }), true);
  assert.ok(tiny > 1, "самый мелкий шаг щипка не двигает масштаб вовсе");
  // Полсотни таких шагов — это уже заметное глазу приближение.
  assert.ok(zoomOver(new Array(50).fill(-0.5), true) > 1.2, "мелкими шагами масштаб не набирается");
});

test("Ctrl с колесом мыши мерится по-колесному, а не как щипок", () => {
  // Щипок узнаётся по мелкому дробному шагу; Ctrl+колесо шлёт те же сто целых.
  assert.equal(gestureWheelPinch(wheel({ ctrlKey: true, deltaY: -2.5 })), true);
  assert.equal(gestureWheelPinch(wheel({ ctrlKey: true, deltaY: -7 })), true);
  assert.equal(gestureWheelPinch(wheel({ ctrlKey: true, deltaY: -100 })), false);
  assert.equal(gestureWheelPinch(wheel({ ctrlKey: true, deltaMode: 1, deltaY: -3 })), false);
  assert.equal(gestureWheelPinch(wheel({ deltaY: -2.5 })), false, "без ctrlKey это прокрутка, а не щипок");
});


// ——— одна дверь и одно правило (таск 162, требование G241) ——————————————

test("колесо отдаёт готовый ответ: что это, что запомнить, куда сдвинуть, во сколько раз", () => {
  // Трекпад: листаем как прокрутка — в ту же сторону, что и стрелки. Жест
  // вниз показывает то, что ниже, поэтому содержимое уезжает вверх.
  const scroll = gestureWheel(wheel({ deltaX: -4, deltaY: 12, timeStamp: 1000 }), null);
  assert.equal(scroll.kind, "pan");
  assert.deepEqual([scroll.panX, scroll.panY], [4, -12]);
  // Память о серии возвращается готовой: поверхность её только хранит.
  assert.deepEqual(scroll.streak, { kind: "pan", time: 1000 });

  // Колесо: множитель тот же, что у прежней меры.
  const notch = gestureWheel(wheel({ deltaY: -100 }), null);
  assert.equal(notch.kind, "zoom");
  assert.equal(notch.factor, gestureZoomFactor(wheel({ deltaY: -100 }), false));

  // Щипок на трекпаде мерится своей мерой — и дверь берёт её сама, без второго
  // вопроса «а это щипок?».
  const pinch = gestureWheel(wheel({ ctrlKey: true, deltaY: -2.5 }), null);
  assert.equal(pinch.kind, "zoom");
  assert.equal(pinch.factor, gestureZoomFactor(wheel({ deltaY: -2.5 }), true));

  // Серия тянется через дверь так же, как через примету.
  const held = gestureWheel(wheel({ deltaY: 84, timeStamp: 1016 }), scroll.streak);
  assert.equal(held.kind, "pan");
});

test("щипок двумя пальцами: во сколько развели — во столько приблизили, и середина везёт", () => {
  const start = gesturePinchOf([
    { x: 100, y: 100 },
    { x: 200, y: 100 },
  ]);
  assert.equal(start.distance, 100);
  assert.deepEqual(start.center, { x: 150, y: 100 });
  // Развели вдвое и увели середину на десять точек вправо.
  const step = gesturePinchStep(start, [
    { x: 110, y: 100 },
    { x: 310, y: 100 },
  ]);
  assert.equal(step.factor, 2);
  assert.equal(step.panX, 60);
  assert.equal(step.panY, 0);
  assert.deepEqual(step.pinch.center, { x: 210, y: 100 });
  // Одного пальца на щипок не хватает — и выдумывать второй нельзя.
  assert.equal(gesturePinchOf([{ x: 0, y: 0 }]), null);
  assert.equal(gesturePinchStep(null, [{ x: 0, y: 0 }]), null);
  // Первый шаг без прошлого состояния масштаб не трогает.
  assert.equal(
    gesturePinchStep(null, [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
    ]).factor,
    1,
  );
  // Пальцы в одной точке: масштаб не уходит в бесконечность.
  const zero = gesturePinchStep({ distance: 0, center: { x: 0, y: 0 } }, [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
  ]);
  assert.equal(zero.factor, 1);
});

test("своего разбора жеста у поверхностей не осталось ни у одной", () => {
  // Правило одно, и держит это сверка исходников: вернись разбор в панель
  // второй раз — и план с чертежом снова разойдутся, а глазами такое ловится
  // только жестом на живой странице.
  const sources = {
    "src/canvas.js": readFileSync(new URL("../src/canvas.js", import.meta.url), "utf8"),
    "src/panels/workshop.js": readFileSync(new URL("../src/panels/workshop.js", import.meta.url), "utf8"),
    "src/panels/schemes.js": readFileSync(new URL("../src/panels/schemes.js", import.meta.url), "utf8"),
    // Объём — четвёртая поверхность с таска 195: колесо и трекпад в обзоре
    // разбирает та же дверь, своего `deltaY` у него не осталось (G299).
    "src/panels/volume.js": readFileSync(new URL("../src/panels/volume.js", import.meta.url), "utf8"),
  };
  for (const [name, source] of Object.entries(sources)) {
    const code = source
      .split("\n")
      .filter((line) => !line.trim().startsWith("//") && !line.trim().startsWith("*"))
      .join("\n");
    assert.ok(!/deltaY/.test(code), name + ": поверхность снова читает deltaY сама");
    assert.ok(!/deltaMode/.test(code), name + ": поверхность снова читает deltaMode сама");
    assert.ok(!/Math\.exp/.test(code), name + ": в поверхности своя мера масштаба");
    assert.ok(/gestureWheel\(/.test(code), name + ": поверхность не зовёт общую дверь колеса");
    assert.ok(/gesturePinchStep\(/.test(code), name + ": у поверхности свой щипок по касаниям");
  }
  // Объём ходил сюда за щипком с таска 174, а с таска 195 — и за колесом
  // (G299): двухпальцевый свайп трекпада в обзоре возит карту, щипок и колесо
  // мыши приближают. Своя мера щипка (`touchGap`) не вернулась.
  const volume = sources["src/panels/volume.js"];
  assert.ok(!/function touchGap/.test(volume), "своя мера щипка вернулась в объём");
  // Применяет объём ответ по-своему, и это не дублирование: у него колесо
  // отодвигает камеру, а не меняет масштаб полотна.
  assert.ok(/aroundZoom\(step\.factor\)/.test(volume), "зум обзора считает не множитель двери");
  assert.ok(/volumeAroundPan\(around, viewport\(\), step\.panX, step\.panY\)/.test(volume), "сдвиг обзора идёт не ходом двери");
});

// ——— черновик ломаной: клик и двойной клик (таск 167, G247) ———————————————

// Черновик из трёх вершин: буква «Г» с концами подальше друг от друга, чтобы
// порог попадания не накрыл обе сразу.
const draft3 = [
  { x: 100, y: 100 },
  { x: 300, y: 100 },
  { x: 300, y: 260 },
];

test("клик в концевую вершину вершины не добавляет", () => {
  // Это первая половина двойного клика, которым черновик заканчивают: добавь
  // она вершину — у замкнутого контура появилась бы лишняя точка в углу.
  assert.equal(gestureDraftClick(draft3, { x: 303, y: 263 }, 9), "last");
  assert.equal(gestureDraftClick(draft3, { x: 104, y: 97 }, 9), "first");
  // В стороне — обычная вершина.
  assert.equal(gestureDraftClick(draft3, { x: 150, y: 220 }, 9), "add");
  // Мимо порога — тоже вершина: порог экранный, и в него надо попасть.
  assert.equal(gestureDraftClick(draft3, { x: 100, y: 115 }, 9), "add");
  // Пустого черновика не бывает — но и спросить про него не грех.
  assert.equal(gestureDraftClick([], { x: 0, y: 0 }, 9), "add");
});

test("у черновика из одной вершины концы — одна и та же точка", () => {
  // И это ещё не замыкание: первая она же и последняя, а замыкать нечего.
  assert.equal(gestureDraftClick([{ x: 100, y: 100 }], { x: 100, y: 100 }, 9), "last");
  assert.equal(gestureDraftEnd([{ x: 100, y: 100 }], { x: 100, y: 100 }, 9), "finish");
});

test("двойной клик: по первой замыкает, по последней заканчивает, в стороне не значит ничего", () => {
  assert.equal(gestureDraftEnd(draft3, { x: 100, y: 100 }, 9), "close");
  assert.equal(gestureDraftEnd(draft3, { x: 300, y: 260 }, 9), "finish");
  // Главное отличие от прежнего чертежа: двойной клик в стороне — просто две
  // вершины подряд, рисование продолжается. Прежде чертёж на любой двойной клик
  // отвечал «контур не замкнут».
  assert.equal(gestureDraftEnd(draft3, { x: 200, y: 200 }, 9), "none");
});

test("замыкать меньше чем тремя вершинами нечего", () => {
  assert.equal(GESTURE_CLOSE_MIN, 3);
  const two = [
    { x: 100, y: 100 },
    { x: 300, y: 100 },
  ];
  // Клик по первой вершине пары — это «закончить», а не «замкнуть»: отрезок
  // площади не огораживает. Ломаной метки этого хватает, контуру вещи — нет, и
  // отказывает он уже сам.
  assert.equal(gestureDraftEnd(two, { x: 100, y: 100 }, 9), "finish");
  assert.equal(gestureDraftEnd(two, { x: 300, y: 100 }, 9), "finish");
});

test("порог попадания даёт поверхность, и он экранный", () => {
  // На плане кружок вершины растёт с масштабом, в чертеже ручка постоянная —
  // поэтому число приходит доводом, а не живёт здесь. Нулевой порог означает
  // «ровно в точку».
  assert.equal(gestureDraftEnd(draft3, { x: 118, y: 100 }, 20), "close");
  assert.equal(gestureDraftEnd(draft3, { x: 118, y: 100 }, 9), "none");
  assert.equal(gestureDraftClick(draft3, { x: 100, y: 100 }, 0), "first");
  assert.equal(gestureDraftClick(draft3, { x: 101, y: 100 }, 0), "add");
});

test("жест черновика разбирают общей дверью и план, и чертёж", () => {
  // Та же сверка исходников, что у колеса, и по той же причине: заказчик просил
  // свести этот жест дважды (таски 137 и 167). Вернись разбор в поверхность — и
  // контур снова разойдётся с ломаной, а глазами это ловится только жестом.
  for (const name of ["src/canvas.js", "src/panels/workshop.js"]) {
    const code = readFileSync(new URL("../" + name, import.meta.url), "utf8");
    assert.ok(/gestureDraftClick\(/.test(code), name + ": вершину черновика ставит свой разбор");
    assert.ok(/gestureDraftEnd\(/.test(code), name + ": черновик заканчивается своим разбором");
  }
});
