// Один вид на три режима и память вида (таск 193: G293, G294, G296; дефекты
// D54 и D59).
//
// Что здесь держится — по словам заказчика:
//
//   «сейчас при переключении я не остаюсь там же, точнее не всегда работает и
//    уровень зума меняется. Должно совпадать пиксель в пиксель» (D59);
//   «запоминай выбранный режим и расположение в браузере, что бы при обновлении
//    страницы вид не менялся» (G294);
//   «вместо галки сделай просто пункт в Шаге - Без сетки» (G293).
//
// Поверхности, DOM и хранилище тестами не покрыты нарочно — здесь проверяется
// то, от чего зависит картинка и готовая работа:
//
//   1. **«Пиксель в пиксель» — числом.** Берётся точка чертежа, считаются её
//      экранные координаты у плана и у мастерской после перехода, и они обязаны
//      совпасть. Промах здесь виден только глазами, а стоит он «переключил — и
//      потерял место, в котором работал».
//   2. **Моста нет — молчание.** У схемы без калибровки миллиметра не
//      существует: перенос не делается, и это не ошибка.
//   3. **«Без сетки» в объект не пишется** (G68): шаг остаётся прежним, старый
//      файл открывается как закрывался.
//   4. **Выбор человека старше сохранённого** (D54): режим, выбранный пока
//      объект грузился, память не перебивает.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  addScheme,
  addWall,
  createProject,
  gridStepOf,
  gridStepSet,
  planMmToFraction,
  setPlanOrigin,
  setPlanScale,
  setSchemeAnchor,
} from "../src/model.js";
import { drawDrawingGrid, drawRuler, drawScheme, drawingBridge, drawingUnitBridge, planToScreen, rulerTicks } from "../src/render.js";
import {
  SCREEN_LOOK_VIEWS,
  SCREEN_OPEN_MAX,
  screenPlaceCarry,
  screenPlaceForget,
  screenPlaceFrom,
  screenPlaceLookFrom,
  screenPlaceOpenFrom,
  screenPlaceScreen,
  screenPlaceOf,
  screenPlacePlanRead,
  screenPlacePlanScale,
  screenPlacePlanView,
  screenPlaceRestore,
  screenPlaceSet,
  screenPlaceStored,
  screenPlaceWatch,
} from "../src/screenPlace.js";
import {
  WORKSHOP_GRID_OFF,
  WORKSHOP_UNIT,
  workshopGridChoice,
  workshopGridValue,
} from "../src/panels/workshop.js";
import { viewMemoryEntry, viewMemoryFrom, viewMemoryPatch } from "../src/app.js";
import { volumeOpenAlive } from "../src/panels/volume.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const LEGACY_TEXT = readFileSync(join(HERE, "legacy-project.json"), "utf8").replace(/\n$/, "");

// План 1200 × 800 точек, калибровка по отрезку в шесть метров и привязка
// чертежа в середину — то есть мост «доля ↔ миллиметр» есть целиком.
function planScene(turn = 0) {
  const added = addScheme(createProject(), { name: "1 этаж", imageId: "plan-1", width: 1200, height: 800 });
  let project = setPlanScale(added.project, added.scheme.id, {
    a: { x: 0.1, y: 0.5 },
    b: { x: 0.6, y: 0.5 },
    meters: 6,
  }).project;
  project = setPlanOrigin(project, added.scheme.id, { at: { x: 0.5, y: 0.5 }, turn }).project;
  return { project, schemeId: added.scheme.id, scheme: added.scheme };
}

// Где точка чертежа окажется на экране у каждого из двух полей.
const planScreenOf = (scene, view, mm) =>
  planToScreen(planMmToFraction(scene.project, scene.schemeId, mm), scene.scheme, view);
const drawScreenOf = (view, mm) => planToScreen(mm, WORKSHOP_UNIT, view);

// Вид мастерской по общему месту — та же арифметика, что в `pullPlace`.
const drawViewOf = (box, place) => ({
  zoom: place.pxPerMm,
  offsetX: box.width / 2 - place.x * place.pxPerMm,
  offsetY: box.height / 2 - place.y * place.pxPerMm,
});

test("D59: план и чертёж после перехода совпадают пиксель в пиксель", () => {
  screenPlaceForget();
  const scene = planScene();
  const box = { width: 900, height: 600 };
  // Человек стоит на плане: масштаб свой, кадр сдвинут руками.
  const planView = { zoom: 1.7, offsetX: -240, offsetY: -130 };
  const place = screenPlacePlanRead(scene.project, scene.schemeId, box, planView);
  assert.ok(place, "моста план → миллиметры нет");
  assert.ok(place.pxPerMm > 0, "масштаб не посчитан");
  // Уходим в чертёж: он встаёт по тому же месту и тому же числу точек на
  // миллиметр.
  const drawView = drawViewOf(box, place);
  for (const mm of [
    { x: 0, y: 0 },
    { x: 2500, y: -1200 },
    { x: -3300, y: 800 },
  ]) {
    const onPlan = planScreenOf(scene, planView, mm);
    const onDraw = drawScreenOf(drawView, mm);
    assert.ok(
      Math.abs(onPlan.x - onDraw.x) < 0.5 && Math.abs(onPlan.y - onDraw.y) < 0.5,
      "точка " + JSON.stringify(mm) + " разъехалась: " + JSON.stringify([onPlan, onDraw]),
    );
  }
  // И обратно: из чертежа на план — те же экранные точки.
  const backPlace = { x: 1500, y: -700, pxPerMm: drawView.zoom };
  const backView = screenPlacePlanView(scene.project, scene.schemeId, box, backPlace, planView);
  const backDraw = drawViewOf(box, backPlace);
  assert.ok(Math.abs(backView.zoom - 1.7) < 1e-9, "масштаб плана не вернулся: " + backView.zoom);
  for (const mm of [
    { x: 0, y: 0 },
    { x: 4000, y: 2500 },
  ]) {
    const onPlan = planScreenOf(scene, backView, mm);
    const onDraw = drawScreenOf(backDraw, mm);
    assert.ok(
      Math.abs(onPlan.x - onDraw.x) < 0.5 && Math.abs(onPlan.y - onDraw.y) < 0.5,
      "обратный переход разъехался: " + JSON.stringify([onPlan, onDraw]),
    );
  }
});

test("масштаб переносится в обе стороны: мера одна — точек на миллиметр", () => {
  const scene = planScene();
  const box = { width: 800, height: 500 };
  // Шесть метров уложены в полплана (600 точек) — то есть сто точек на метр.
  assert.ok(Math.abs(screenPlacePlanScale(scene.project, scene.schemeId, { zoom: 1 }) - 0.1) < 1e-9);
  // Приблизили план вдвое — вдвое выросли и точки на миллиметр.
  assert.ok(Math.abs(screenPlacePlanScale(scene.project, scene.schemeId, { zoom: 2 }) - 0.2) < 1e-9);
  // И обратно: тот же масштаб плана выходит из того же числа точек.
  const view = screenPlacePlanView(scene.project, scene.schemeId, box, { x: 0, y: 0, pxPerMm: 0.2 }, { zoom: 1 });
  assert.ok(Math.abs(view.zoom - 2) < 1e-9, "масштаб посчитан иначе: " + view.zoom);
  // Середина поля смотрит ровно на место.
  const at = planScreenOf(scene, view, { x: 0, y: 0 });
  assert.ok(Math.abs(at.x - box.width / 2) < 0.5 && Math.abs(at.y - box.height / 2) < 0.5);
});

test("повёрнутая подложка: место и масштаб переносятся, оси не путаются", () => {
  for (const turn of [90, 180, 270]) {
    const scene = planScene(turn);
    const box = { width: 900, height: 600 };
    const planView = { zoom: 1.2, offsetX: 40, offsetY: -60 };
    const place = screenPlacePlanRead(scene.project, scene.schemeId, box, planView);
    assert.ok(place, "мост пропал на повороте " + turn);
    // Вернули то же место — середина поля не сдвинулась.
    const back = screenPlacePlanView(scene.project, scene.schemeId, box, place, planView);
    const again = screenPlacePlanRead(scene.project, scene.schemeId, box, back);
    assert.ok(
      Math.abs(again.x - place.x) <= 1 && Math.abs(again.y - place.y) <= 1,
      "поворот " + turn + ": место уехало " + JSON.stringify([place, again]),
    );
    assert.ok(Math.abs(again.pxPerMm - place.pxPerMm) < 1e-9, "поворот " + turn + ": масштаб уехал");
  }
});

test("моста нет — переносить нечем, и это молчание, а не ошибка", () => {
  const box = { width: 900, height: 600 };
  const view = { zoom: 1, offsetX: 0, offsetY: 0 };
  // Схема с подложкой, но без калибровки: миллиметра на ней не существует.
  const bare = addScheme(createProject(), { name: "1 этаж", imageId: "plan-1", width: 1200, height: 800 });
  assert.equal(screenPlacePlanRead(bare.project, bare.scheme.id, box, view), null);
  assert.equal(screenPlacePlanView(bare.project, bare.scheme.id, box, { x: 0, y: 0 }, view), null);
  assert.equal(screenPlacePlanScale(bare.project, bare.scheme.id, view), 0);
  // Схема с калибровкой, но без привязки чертежа — то же самое.
  const scaled = setPlanScale(bare.project, bare.scheme.id, {
    a: { x: 0.1, y: 0.5 },
    b: { x: 0.6, y: 0.5 },
    meters: 6,
  }).project;
  assert.equal(screenPlacePlanRead(scaled, bare.scheme.id, box, view), null);
  // Вырожденное поле (поверхность ещё не измерилась) места не даёт.
  const scene = planScene();
  assert.equal(screenPlacePlanRead(scene.project, scene.schemeId, { width: 0, height: 0 }, view), null);
  // Чужой схемы нет вовсе.
  assert.equal(screenPlacePlanRead(scene.project, "нет такой", box, view), null);
});

test("память вида: что ложится в настройки и что из них поднимается", () => {
  // Числа округляются: в хранилище незачем двадцать знаков дробной части.
  assert.deepEqual(screenPlaceStored({ x: 1500.4, y: -800.6, pxPerMm: 0.123456789 }), {
    x: 1500,
    y: -801,
    pxPerMm: 0.123457,
  });
  // Масштаб необязателен: место из объёма приходит без него.
  assert.deepEqual(screenPlaceStored({ x: 1, y: 2 }), { x: 1, y: 2 });
  // Мусор отбрасывается молча — лучше прежнее поведение, чем поле в NaN.
  for (const bad of [null, {}, { x: "абв", y: 0 }, { x: 1 }, "строка"]) {
    assert.equal(screenPlaceStored(bad), null, "принято негодное: " + JSON.stringify(bad));
    assert.equal(screenPlaceFrom(bad), null);
  }
  // Негодный масштаб не роняет место: оно читается, а приближение остаётся
  // тем, которое выбрал человек. Взгляда в такой записи нет — его пишет объём.
  assert.deepEqual(screenPlaceFrom({ x: 5, y: 6, pxPerMm: -1 }), {
    x: 5,
    y: 6,
    pxPerMm: null,
    look: null,
    open: null,
  });
});

test("память вида поднимается в общее место и становится чужой записью", () => {
  screenPlaceForget();
  const stamp = screenPlaceRestore("схема-1", { x: 900, y: -300, pxPerMm: 0.4 });
  const place = screenPlaceOf("схема-1");
  assert.deepEqual({ x: place.x, y: place.y, pxPerMm: place.pxPerMm }, { x: 900, y: -300, pxPerMm: 0.4 });
  assert.equal(place.stamp, stamp, "поднятое место обязано быть чужой записью для поверхностей");
  // Негодная запись место не ставит.
  screenPlaceForget();
  assert.equal(screenPlaceRestore("схема-1", { x: null }), 0);
  assert.equal(screenPlaceOf("схема-1"), null);
});

test("о смене места сообщают — на это и пишется память", () => {
  screenPlaceForget();
  screenPlaceScreen(null);
  let heard = 0;
  const stop = screenPlaceWatch(() => {
    heard += 1;
  });
  screenPlaceSet("scheme", "схема-1", { x: 10, y: 20 }, { pxPerMm: 0.5 });
  assert.equal(heard, 1);
  // Поле говорит о месте на каждый кадр: запись, ничего не меняющая, память не
  // будит — иначе в хранилище летело бы по шестьдесят записей в секунду.
  screenPlaceSet("scheme", "схема-1", { x: 10, y: 20 }, { pxPerMm: 0.5 });
  assert.equal(heard, 1);
  screenPlaceSet("scheme", "схема-1", { x: 11, y: 20 }, { pxPerMm: 0.5 });
  assert.equal(heard, 2);
  stop();
  screenPlaceSet("scheme", "схема-1", { x: 12, y: 20 }, { pxPerMm: 0.5 });
  assert.equal(heard, 2, "отписка не сработала");
  screenPlaceForget();
});

test("G294: память вида — карта по объектам, и мусор в ней не страшен", () => {
  assert.deepEqual(viewMemoryFrom(null), {});
  assert.deepEqual(viewMemoryFrom("строка"), {});
  assert.deepEqual(viewMemoryFrom([1, 2]), {});
  const map = viewMemoryFrom({
    "объект-1": { screen: "drawing", schemeId: "схема-7", place: { x: 1.4, y: 2.6, pxPerMm: 0.25 } },
    "объект-2": { screen: "нет такого", schemeId: 42, place: { x: "абв" } },
    "объект-3": { screen: "volume" },
    "объект-4": null,
  });
  assert.deepEqual(map["объект-1"], {
    screen: "drawing",
    schemeId: "схема-7",
    place: { x: 1, y: 3, pxPerMm: 0.25 },
  });
  assert.equal(map["объект-2"], undefined, "чужой режим и чужая схема не должны доехать");
  assert.deepEqual(map["объект-3"], { screen: "volume" });
  assert.equal(map["объект-4"], undefined);
});

test("G294: в память ложатся режим, схема и расположение — и ничего больше", () => {
  const entry = viewMemoryEntry(
    { screen: "volume", schemeId: "схема-1", mode: "add", activeTypeId: "тип-1" },
    { x: 500, y: -250, pxPerMm: 0.3 },
  );
  assert.deepEqual(entry, { screen: "volume", schemeId: "схема-1", place: { x: 500, y: -250, pxPerMm: 0.3 } });
  // Занятие в память не попадает нарочно (G296): вернуться в «Добавление»
  // после обновления страницы значило бы поставить метку первым же кликом.
  assert.equal("mode" in entry, false);
  assert.equal("activeTypeId" in entry, false);
  // Без схемы и без места запись пустая — писать нечего.
  assert.deepEqual(viewMemoryEntry({ screen: "нет такого" }, null), {});
});

test("G294: объект открывается своим видом, а незнакомый — схемой", () => {
  const scene = planScene();
  const project = scene.project;
  const own = { screen: "drawing", schemeId: scene.schemeId };
  assert.deepEqual(viewMemoryPatch(own, project, "desktop"), { screen: "drawing", schemeId: scene.schemeId });
  // Памяти нет — прежнее поведение: схема (таск 153).
  assert.deepEqual(viewMemoryPatch(null, project, "desktop"), { screen: "scheme" });
  // Чужой режим в памяти — тоже схема.
  assert.deepEqual(viewMemoryPatch({ screen: "нет такого" }, project, "desktop"), { screen: "scheme" });
  // Чертежа в просмотре нет вовсе: на узкой раскладке память уводит на схему.
  assert.deepEqual(viewMemoryPatch(own, project, "mobile"), { screen: "scheme", schemeId: scene.schemeId });
  // Объём в просмотре есть — он только смотрит.
  assert.deepEqual(viewMemoryPatch({ screen: "volume" }, project, "mobile"), { screen: "volume" });
  // Схемы уже нет — открывший объект выбрал первую, и память её не перебивает.
  assert.deepEqual(viewMemoryPatch({ screen: "volume", schemeId: "удалённая" }, project, "desktop"), {
    screen: "volume",
  });
});

test("D54: выбор человека старше сохранённого", () => {
  const scene = planScene();
  const entry = { screen: "volume", schemeId: scene.schemeId };
  // Человек успел переключить экран, пока объект грузился: режима в заплатке
  // нет вовсе — ни сохранённого, ни умолчания.
  const patch = viewMemoryPatch(entry, scene.project, "desktop", { picked: true });
  assert.equal("screen" in patch, false, "позднее применение перебило выбор человека");
  // Схема при этом поднимается: её человек не выбирал.
  assert.equal(patch.schemeId, scene.schemeId);
  // А без выбора человека — сохранённый режим.
  assert.equal(viewMemoryPatch(entry, scene.project, "desktop", { picked: false }).screen, "volume");
});

test("G293: «Без сетки» — пункт списка, и в объект от него не пишется ничего", () => {
  // Значение пункта не число нарочно: ноль в списке читался бы шагом.
  assert.equal(WORKSHOP_GRID_OFF, "off");
  assert.notEqual(WORKSHOP_GRID_OFF, "0");
  // Что стоит в списке: «Без сетки» или шаг объекта.
  assert.equal(workshopGridValue(false, 100), WORKSHOP_GRID_OFF);
  assert.equal(workshopGridValue(true, 100), "100");
  assert.equal(workshopGridValue(undefined, 250), "250", "умолчание — сетка показана");
  // Что выбрали.
  assert.deepEqual(workshopGridChoice(WORKSHOP_GRID_OFF), { shown: false });
  assert.deepEqual(workshopGridChoice("500"), { shown: true, stepMm: 500 });
  for (const bad of ["", "абв", "0", "-100", null]) {
    assert.equal(workshopGridChoice(bad), null, "принято негодное: " + JSON.stringify(bad));
  }
  // G68: выбор «Без сетки» объекта не касается — шаг у него остаётся прежним.
  const scene = planScene();
  const project = addWall(scene.project, {
    schemeId: scene.schemeId,
    aMm: { x: 0, y: 0 },
    bMm: { x: 3000, y: 0 },
    thicknessMm: 100,
  }).project;
  assert.equal(gridStepSet(project), false, "шага в объекте и не было");
  assert.equal(gridStepOf(project), 100);
  // Старый файл со своим шагом читается им же и после «Без сетки»: выбор живёт
  // в настройках браузера, а не в `view.gridStepMm`.
  const legacy = JSON.parse(LEGACY_TEXT);
  legacy.view = { ...legacy.view, gridStepMm: 250 };
  assert.equal(gridStepOf(legacy), 250);
  assert.equal(workshopGridValue(false, gridStepOf(legacy)), WORKSHOP_GRID_OFF, "«Без сетки» не показалось");
  assert.equal(legacy.view.gridStepMm, 250, "объект тронут выбором «Без сетки»");
  assert.equal(workshopGridValue(true, gridStepOf(legacy)), "250", "вернулись к сетке — шаг тот же");
});

// ——— сетка и линейка: оба поля рисуют один и тот же слой ————————————————

// Холст-писец: записывает каждый вызов и каждое присваивание. Тот же приём, что
// в `test/projectSite.test.js` и `test/drawingHandles.test.js`.
function scribe(log) {
  const impl = { measureText: (value) => ({ width: String(value).length * 6 }) };
  return new Proxy(impl, {
    get: (target, key) =>
      key in target ? target[key] : (...args) => log.push(String(key) + "(" + args.join(",") + ")"),
    set: (target, key, value) => ((target[key] = value), log.push(String(key) + "=" + String(value)), true),
  });
}

test("G293: сетка рисуется и на плане, и в чертеже — одним слоем", () => {
  const scene = planScene();
  const box = { width: 900, height: 600 };
  const planView = { zoom: 1, offsetX: 0, offsetY: 0 };
  // На плане: мост даёт `drawingBridge` — тот же, которым на подложку ложится
  // чертёж. Сто точек на метр при `zoom: 1` — метровая сетка видна.
  const plan = [];
  const planLines = drawDrawingGrid(scribe(plan), drawingBridge(scene.project, scene.scheme, planView), box, 1000);
  assert.ok(planLines > 0, "на плане сетка не нарисовалась");
  assert.ok(plan.some((call) => call.startsWith("stroke(")), "линии не обведены");
  // В чертеже: тот же слой, мост мастерской. Масштаб подобран тот же —
  // значит и линий столько же.
  const draw = [];
  const drawLines = drawDrawingGrid(scribe(draw), drawingUnitBridge({ zoom: 0.1, offsetX: 0, offsetY: 0 }), box, 1000);
  assert.equal(drawLines, planLines, "поля нарисовали разное число линий");
  // Моста нет — слой молчит: кадр не меняется ни на пиксель.
  const quiet = [];
  assert.equal(drawDrawingGrid(scribe(quiet), null, box, 1000), 0);
  assert.equal(quiet.length, 0);
  // «Без сетки» — то же молчание: шаг ноль.
  assert.equal(drawDrawingGrid(scribe(quiet), drawingUnitBridge({ zoom: 1 }), box, 0), 0);
  assert.equal(quiet.length, 0);
});

test("G68: кадр без сетки не меняется ни на вызов — выгрузки её не просят", () => {
  const scene = planScene();
  const box = { width: 900, height: 600 };
  const view = { zoom: 1, offsetX: 0, offsetY: 0 };
  const options = { project: scene.project, scheme: scene.scheme, filter: {}, view, selectedIds: [] };
  const without = [];
  drawScheme(scribe(without), { ...options });
  const nulled = [];
  drawScheme(scribe(nulled), { ...options, grid: null });
  assert.deepEqual(nulled, without, "`grid: null` что-то нарисовал");
  const off = [];
  drawScheme(scribe(off), { ...options, grid: { stepMm: 0, box } });
  assert.deepEqual(off, without, "нулевой шаг что-то нарисовал");
  const on = [];
  drawScheme(scribe(on), { ...options, grid: { stepMm: 1000, box } });
  assert.ok(on.length > without.length, "сетка на плане не появилась");
});

test("G293: линейка чертежа мерит миллиметры и ходит в минус", () => {
  // У подложки деления стоят только там, где есть картинка. У чертежа краёв
  // нет: лист бесконечен в обе стороны, и миллиметры бывают отрицательными.
  const box = { width: 800, height: 500 };
  const view = { zoom: 0.1, offsetX: 400, offsetY: 250 };
  const bounded = rulerTicks(WORKSHOP_UNIT, view, box);
  const open = rulerTicks(WORKSHOP_UNIT, view, box, { bounded: false });
  assert.ok(open.top.length > bounded.top.length, "лист без краёв не дал делений: " + open.top.length);
  assert.ok(open.top.some((tick) => tick.at < 0), "в минус линейка чертежа не пошла");
  assert.ok(open.step >= 100, "деления чертежа — круглые миллиметры: " + open.step);
  // И рисуется та же линейка тем же кодом.
  const log = [];
  drawRuler(scribe(log), WORKSHOP_UNIT, view, box, { bounded: false });
  assert.ok(log.some((call) => call.startsWith("fillRect(")), "полоса линейки не залита");
});

// ——— D61: последнее движение человека старше вида ————————————————————————
//
// Слова заказчика: «если схему или чертёж сдвинуть и переключиться на другой
// вариант то кидает туда, где стоит камера в Объёме. Последнее движение на
// любом из 3 видов должно сохраняться».
//
// Отметки `stamp` для этого мало: она отвечает «чья запись», а спор был о том,
// **чья рука**. Объём, собранный один раз, живёт дальше за кадром и писал место
// камеры на всякую смену режима — в том числе на «Схема → Чертёж», где объёма
// не было ни до, ни после.

test("D61: пишет только то поле, которое на экране", () => {
  screenPlaceForget();
  screenPlaceScreen("scheme");
  // Человек двигает схему.
  const moved = screenPlaceSet("scheme", "с-1", { x: 1000, y: 500 }, { pxPerMm: 0.2 });
  // Объём жив за кадром и говорит, где камера, — его не слушают.
  const ignored = screenPlaceSet("volume", "с-1", { x: -9000, y: -9000 });
  assert.equal(ignored, moved, "запись из погасшего поля сдвинула отметку");
  assert.deepEqual(
    { x: screenPlaceOf("с-1").x, y: screenPlaceOf("с-1").y },
    { x: 1000, y: 500 },
    "место схемы перебито камерой",
  );
  // И мастерская, пока она не на экране, тоже молчит.
  screenPlaceSet("drawing", "с-1", { x: 3, y: 4 }, { pxPerMm: 1 });
  assert.equal(screenPlaceOf("с-1").x, 1000);
  assert.equal(screenPlaceOf("с-1").pxPerMm, 0.2, "и масштаб её не достался");
  screenPlaceForget();
  screenPlaceScreen(null);
});

test("D61: четыре порядка — последнее движение показывается всегда", () => {
  const scheme = "с-1";
  const read = () => {
    const place = screenPlaceOf(scheme);
    return place ? { x: place.x, y: place.y, pxPerMm: place.pxPerMm } : null;
  };
  screenPlaceForget();

  // 1. Сдвинул схему → ушёл в чертёж: чертёж встаёт по схеме.
  screenPlaceScreen("scheme");
  screenPlaceSet("scheme", scheme, { x: 1200, y: -300 }, { pxPerMm: 0.2 });
  screenPlaceScreen("drawing");
  assert.deepEqual(read(), { x: 1200, y: -300, pxPerMm: 0.2 }, "чертёж встал не по схеме");

  // 2. Сдвинул чертёж → вернулся на схему: схема встаёт по чертежу.
  screenPlaceSet("drawing", scheme, { x: -800, y: 900 }, { pxPerMm: 0.35 });
  screenPlaceScreen("scheme");
  assert.deepEqual(read(), { x: -800, y: 900, pxPerMm: 0.35 }, "схема встала не по чертежу");

  // 3. Побывал в объёме и не трогал камеру: возврат по последнему движению
  //    руки — объём пишет то же место, на которое пришёл.
  screenPlaceScreen("volume");
  screenPlaceSet("volume", scheme, { x: -800, y: 900 });
  screenPlaceScreen("scheme");
  assert.deepEqual(read(), { x: -800, y: 900, pxPerMm: 0.35 }, "объём перебил место, никуда не ходив");

  // 4. Подвинул камеру в объёме → ушёл на схему: схема встаёт по камере (G276),
  //    и масштаб при этом остаётся прежним — камера им не владеет.
  screenPlaceScreen("volume");
  screenPlaceSet("volume", scheme, { x: 2500, y: 2500 });
  screenPlaceScreen("scheme");
  assert.deepEqual(read(), { x: 2500, y: 2500, pxPerMm: 0.35 }, "схема не пошла за камерой");

  // И снова сдвиг схемы старше камеры: объём за кадром больше не спорит.
  screenPlaceSet("scheme", scheme, { x: 10, y: 20 }, { pxPerMm: 0.35 });
  screenPlaceSet("volume", scheme, { x: 2500, y: 2500 });
  screenPlaceScreen("drawing");
  assert.deepEqual(read(), { x: 10, y: 20, pxPerMm: 0.35 }, "камера снова оказалась старше руки");
  screenPlaceForget();
  screenPlaceScreen(null);
});

test("D61: память вида поднимается мимо хозяина — ей спорить не с кем", () => {
  screenPlaceForget();
  // Страница только поднялась: на экране схема, а поднимается вид, которым
  // человек закончил прошлый сеанс, — чертёж со своим местом.
  screenPlaceScreen("scheme");
  const stamp = screenPlaceRestore("с-1", { x: 4000, y: -2000, pxPerMm: 0.5 });
  assert.ok(stamp > 0, "память не доехала до общего места");
  assert.deepEqual(
    { x: screenPlaceOf("с-1").x, y: screenPlaceOf("с-1").y, pxPerMm: screenPlaceOf("с-1").pxPerMm },
    { x: 4000, y: -2000, pxPerMm: 0.5 },
  );
  screenPlaceForget();
  screenPlaceScreen(null);
});

// ——— G339: взгляд камеры живёт в той же записи, что и место ————————————
//
// Слово заказчика: «направление камеры сохраняй». Разбор, почему взгляд лёг
// сюда, а не во вторую запись рядом, — в голове `screenPlace.js`: место и
// взгляд отвечают на один вопрос «где я и куда смотрю», и хозяин у них один
// (правило T210).

test("G339: что годится во взгляд, а что отбрасывается молча", () => {
  assert.deepEqual(SCREEN_LOOK_VIEWS, ["person", "around"]);
  assert.deepEqual(screenPlaceLookFrom({ view: "person", yaw: 1.5, pitch: -0.2 }), {
    view: "person",
    yaw: 1.5,
    pitch: -0.2,
  });
  // Глаз — только у обзора: у первого лица камера и есть тело.
  assert.deepEqual(screenPlaceLookFrom({ view: "person", yaw: 0, pitch: 0, eye: { dx: 1, dy: 2, z: 3 } }), {
    view: "person",
    yaw: 0,
    pitch: 0,
  });
  assert.deepEqual(screenPlaceLookFrom({ view: "around", yaw: 0.5, pitch: -0.7, eye: { dx: -4000, dy: 1500, z: 9000 } }), {
    view: "around",
    yaw: 0.5,
    pitch: -0.7,
    eye: { dx: -4000, dy: 1500, z: 9000 },
  });
  for (const bad of [null, {}, "строка", { view: "сбоку", yaw: 0, pitch: 0 }, { view: "person", yaw: "абв", pitch: 0 }]) {
    assert.equal(screenPlaceLookFrom(bad), null, "принято негодное: " + JSON.stringify(bad));
  }
  // Негодный глаз не роняет взгляд: направление читается, а камера остаётся
  // там, где её поставил кадр.
  assert.deepEqual(screenPlaceLookFrom({ view: "around", yaw: 0, pitch: -0.5, eye: { dx: "абв", dy: 0, z: 0 } }), {
    view: "around",
    yaw: 0,
    pitch: -0.5,
  });
});

test("G339: взгляд ложится в настройки округлённым и поднимается обратно", () => {
  const stored = screenPlaceStored({
    x: 10.4,
    y: -20.6,
    pxPerMm: 0.1,
    look: { view: "around", yaw: 1.23456789, pitch: -0.73299999, eye: { dx: -4000.4, dy: 1500.6, z: 9123.7 } },
  });
  assert.deepEqual(stored, {
    x: 10,
    y: -21,
    pxPerMm: 0.1,
    look: { view: "around", yaw: 1.2346, pitch: -0.733, eye: { dx: -4000, dy: 1501, z: 9124 } },
  });
  // Поднимается то же самое: круг «записали — прочитали» ничего не теряет.
  assert.deepEqual(screenPlaceFrom(stored).look, stored.look);
  // Места без взгляда в настройках не бывает лишнего ключа.
  assert.equal("look" in screenPlaceStored({ x: 1, y: 2 }), false);
});

test("G339: плоские поля взгляд берегут, объём бережёт масштаб", () => {
  screenPlaceForget();
  screenPlaceScreen("volume");
  // Объём записал место и взгляд — масштаба у него нет вовсе.
  screenPlaceSet("volume", "с-1", { x: 100, y: 200 }, { look: { view: "person", yaw: 1, pitch: -0.1 } });
  assert.deepEqual(screenPlaceOf("с-1").look, { view: "person", yaw: 1, pitch: -0.1 });
  assert.equal(screenPlaceOf("с-1").pxPerMm, null);
  // Ушли на схему: она пишет место и масштаб — и **не трогает** взгляд.
  screenPlaceScreen("scheme");
  screenPlaceSet("scheme", "с-1", { x: 300, y: 400 }, { pxPerMm: 0.25 });
  assert.deepEqual(screenPlaceOf("с-1").look, { view: "person", yaw: 1, pitch: -0.1 }, "схема стёрла взгляд");
  assert.equal(screenPlaceOf("с-1").pxPerMm, 0.25);
  // Чертёж — то же самое.
  screenPlaceScreen("drawing");
  screenPlaceSet("drawing", "с-1", { x: 500, y: 600 }, { pxPerMm: 0.4 });
  assert.deepEqual(screenPlaceOf("с-1").look, { view: "person", yaw: 1, pitch: -0.1 });
  // Вернулись в объём: он пишет новый взгляд, а масштаб плоских бережёт.
  screenPlaceScreen("volume");
  screenPlaceSet("volume", "с-1", { x: 500, y: 600 }, { look: { view: "around", yaw: 2, pitch: -0.7, eye: { dx: -3000, dy: 0, z: 7000 } } });
  assert.deepEqual(screenPlaceOf("с-1").look, { view: "around", yaw: 2, pitch: -0.7, eye: { dx: -3000, dy: 0, z: 7000 } });
  assert.equal(screenPlaceOf("с-1").pxPerMm, 0.4, "объём отнял у плоских масштаб");
  // Правило T210 цело: запись из погасшего объёма не проходит вовсе — ни
  // местом, ни взглядом.
  screenPlaceScreen("scheme");
  screenPlaceSet("volume", "с-1", { x: -9, y: -9 }, { look: { view: "person", yaw: 9, pitch: 0 } });
  assert.deepEqual(screenPlaceOf("с-1").look, { view: "around", yaw: 2, pitch: -0.7, eye: { dx: -3000, dy: 0, z: 7000 } });
  assert.equal(screenPlaceOf("с-1").x, 500);
  // Другая схема — другая камера: чужой взгляд на этаж не переезжает.
  screenPlaceSet("scheme", "с-2", { x: 0, y: 0 }, { pxPerMm: 0.4 });
  assert.equal(screenPlaceOf("с-2").look, null);
  screenPlaceForget();
  screenPlaceScreen(null);
});

test("G339: взгляд поднимается из памяти вместе с местом — одной записью", () => {
  screenPlaceForget();
  screenPlaceScreen("scheme");
  const saved = { x: 4000, y: -2000, pxPerMm: 0.5, look: { view: "around", yaw: 1.5708, pitch: -0.733, eye: { dx: -5000, dy: 2000, z: 9000 } } };
  assert.ok(screenPlaceRestore("с-1", saved) > 0);
  const place = screenPlaceOf("с-1");
  assert.deepEqual({ x: place.x, y: place.y, pxPerMm: place.pxPerMm }, { x: 4000, y: -2000, pxPerMm: 0.5 });
  assert.deepEqual(place.look, saved.look, "взгляд не доехал из памяти");
  // Запись в памяти одна: `viewMemoryEntry` кладёт место целиком, со взглядом.
  const entry = viewMemoryEntry({ screen: "volume", schemeId: "с-1" }, place);
  assert.deepEqual(entry.place.look, saved.look);
  assert.equal("look" in entry, false, "взгляд завёл вторую запись рядом с местом");
  screenPlaceForget();
  screenPlaceScreen(null);
});

// ——— G352: что в доме открыто — в той же записи ————————————————————————
//
// Долг таска 227, закрытый по правилу «долг закрывай». Двери и шторы — это не
// свойство дома, а то, как человек настроил показ: в `project.json` от них не
// попадает ничего (G68), а правило «все двери закрыты» (G207) — про новый
// объект, а не про возвращение к своему.

test("G352: что годится в «открыто», а что отбрасывается молча", () => {
  assert.deepEqual(screenPlaceOpenFrom({ doors: ["д1", "д2"], sheers: ["ш1"] }), {
    doors: ["д1", "д2"],
    sheers: ["ш1"],
  });
  // Повторы схлопываются, мусор уходит: ключ — это строка, и только строка.
  assert.deepEqual(screenPlaceOpenFrom({ doors: ["д1", "д1", "", 7, null], sheers: "не список" }), {
    doors: ["д1"],
    sheers: [],
  });
  // Пустое — это ответ «всё закрыто», а не молчание: иначе закрытые двери
  // нечем было бы записать.
  assert.deepEqual(screenPlaceOpenFrom({ doors: [], sheers: [] }), { doors: [], sheers: [] });
  // А молчание — это `null`: кадру нечего сказать, и запись бережёт прежнее.
  for (const bad of [null, undefined, "строка", 7]) assert.equal(screenPlaceOpenFrom(bad), null);
  // Потолок: мусор в настройке не растёт без края.
  const many = Array.from({ length: SCREEN_OPEN_MAX + 50 }, (item, at) => "д" + at);
  assert.equal(screenPlaceOpenFrom({ doors: many }).doors.length, SCREEN_OPEN_MAX);
});

test("G352: открытое пишет объём, плоские поля его берегут", () => {
  screenPlaceForget();
  screenPlaceScreen("volume");
  screenPlaceSet("volume", "с-1", { x: 0, y: 0 }, { open: { doors: ["д1", "д2"], sheers: ["ш1"] } });
  assert.deepEqual(screenPlaceOf("с-1").open, { doors: ["д1", "д2"], sheers: ["ш1"] });
  // Схема двигает место и масштаб — открытое не трогает.
  screenPlaceScreen("scheme");
  screenPlaceSet("scheme", "с-1", { x: 100, y: 200 }, { pxPerMm: 0.3 });
  assert.deepEqual(screenPlaceOf("с-1").open, { doors: ["д1", "д2"], sheers: ["ш1"] });
  // Запись из погасшего объёма не проходит (T210).
  screenPlaceSet("volume", "с-1", { x: 0, y: 0 }, { open: { doors: [], sheers: [] } });
  assert.deepEqual(screenPlaceOf("с-1").open, { doors: ["д1", "д2"], sheers: ["ш1"] });
  // Кадр молчит об открытом (ничего не меняли) — запись остаётся прежней.
  screenPlaceScreen("volume");
  screenPlaceSet("volume", "с-1", { x: 5, y: 5 });
  assert.deepEqual(screenPlaceOf("с-1").open, { doors: ["д1", "д2"], sheers: ["ш1"] });
  // Закрыли всё — так и записано: пустое «открыто» это тоже ответ.
  screenPlaceSet("volume", "с-1", { x: 5, y: 5 }, { open: { doors: [], sheers: [] } });
  assert.deepEqual(screenPlaceOf("с-1").open, { doors: [], sheers: [] });
  // В настройку пустое не кладётся: закрытый дом и так умолчание (G207).
  assert.equal("open" in screenPlaceStored(screenPlaceOf("с-1")), false);
  // Другой этаж — другие двери: запись одна, и чужого знания в ней не бывает.
  screenPlaceSet("volume", "с-1", { x: 5, y: 5 }, { open: { doors: ["д1"], sheers: [] } });
  screenPlaceScreen("scheme");
  screenPlaceSet("scheme", "с-2", { x: 0, y: 0 }, { pxPerMm: 0.3 });
  assert.equal(screenPlaceOf("с-2").open, null, "двери прежнего этажа утекли на новый");
  assert.equal(screenPlaceOf("с-1"), null, "запись одна: прежний этаж в ней не остаётся");
  screenPlaceForget();
  screenPlaceScreen(null);
});

test("G352: мёртвый ключ не ломает сцену и не копится", () => {
  // Дверь стёрли между сеансами: в памяти её ключ есть, в сцене — нет.
  const scene = { doors: ["д1", "д2"], sheers: ["ш1"] };
  assert.deepEqual(volumeOpenAlive(scene, { doors: ["д1", "стёртая"], sheers: ["ш1", "нет такой"] }), {
    doors: ["д1"],
    sheers: ["ш1"],
  });
  // Стопка этажей (таск 202): дверь соседнего этажа — тоже своя.
  const stack = {
    doors: ["д1"],
    sheers: [],
    stackParts: [{ sub: { doors: ["д2"], sheers: ["ш2"] } }, { sub: { doors: ["д3"], sheers: [] } }],
  };
  assert.deepEqual(volumeOpenAlive(stack, { doors: ["д1", "д3", "призрак"], sheers: ["ш2"] }), {
    doors: ["д1", "д3"],
    sheers: ["ш2"],
  });
  // Пустая память и пустая сцена — пустой ответ, а не падение.
  assert.deepEqual(volumeOpenAlive({}, null), { doors: [], sheers: [] });
  assert.deepEqual(volumeOpenAlive(null, { doors: ["д1"] }), { doors: [], sheers: [] });
});

test("G352: открытое ложится в память и поднимается из неё одной записью", () => {
  screenPlaceForget();
  screenPlaceScreen("volume");
  const saved = {
    x: 10,
    y: 20,
    pxPerMm: 0.2,
    look: { view: "person", yaw: 1, pitch: 0 },
    open: { doors: ["д1", "д2"], sheers: ["ш1"] },
  };
  assert.deepEqual(screenPlaceStored(saved).open, { doors: ["д1", "д2"], sheers: ["ш1"] });
  assert.ok(screenPlaceRestore("с-1", saved) > 0);
  assert.deepEqual(screenPlaceOf("с-1").open, saved.open);
  // Вся память объекта — по-прежнему одна запись, и открытое лежит внутри неё.
  const entry = viewMemoryEntry({ screen: "volume", schemeId: "с-1" }, screenPlaceOf("с-1"));
  assert.deepEqual(entry.place.open, saved.open);
  assert.equal("open" in entry, false, "открытое завело вторую запись рядом с местом");
  screenPlaceForget();
  screenPlaceScreen(null);
});

// ——— смена схемы (правка 2026-10-27) ——————————————————————————————————————
//
// «При переключении схем это же пофиксь, у нас же один масштаб. и точка
// привязки есть тоже».

test("смена схемы: место едет по точке привязки, масштаб и взгляд — те же, двери — нет", () => {
  screenPlaceForget();
  screenPlaceScreen(null);
  const first = planScene();
  const second = addScheme(first.project, { name: "2 этаж", imageId: "plan-2", width: 1200, height: 800 });
  // Лестница первого этажа в (2000, 1000), выход второго — в (500, -300).
  let project = setSchemeAnchor(second.project, first.schemeId, { x: 2000, y: 1000 }).project;
  project = setSchemeAnchor(project, second.scheme.id, { x: 500, y: -300 }).project;
  screenPlaceSet("volume", first.schemeId, { x: 2600, y: 1400 }, {
    look: { view: "person", yaw: 1, pitch: -0.2 },
    open: { doors: ["d1"], sheers: [] },
  });
  screenPlaceSet("scheme", first.schemeId, { x: 2600, y: 1400 }, { pxPerMm: 0.35 });
  screenPlaceCarry(project, first.schemeId, second.scheme.id);
  assert.equal(screenPlaceOf(first.schemeId), null, "место осталось у прежней схемы");
  const carried = screenPlaceOf(second.scheme.id);
  // В шестистах миллиметрах вправо и в четырёхстах вниз от лестницы — там же
  // от выхода наверху.
  assert.deepEqual({ x: carried.x, y: carried.y }, { x: 500 + 600, y: -300 + 400 });
  assert.equal(carried.pxPerMm, 0.35, "масштаб не доехал");
  assert.deepEqual(carried.look, { view: "person", yaw: 1, pitch: -0.2 }, "взгляд не доехал");
  assert.equal(carried.open, null, "двери прежней схемы уехали на новую");
  // Без привязок — те же миллиметры (G68: прежние объекты без привязки).
  screenPlaceSet("scheme", second.scheme.id, { x: 10, y: 20 }, { pxPerMm: 0.5 });
  const plain = addScheme(createProject(), { name: "A", imageId: null, width: 100, height: 100 });
  const two = addScheme(plain.project, { name: "B", imageId: null, width: 100, height: 100 });
  screenPlaceSet("scheme", plain.scheme.id, { x: 10, y: 20 }, { pxPerMm: 0.5 });
  screenPlaceCarry(two.project, plain.scheme.id, two.scheme.id);
  assert.deepEqual({ x: screenPlaceOf(two.scheme.id).x, y: screenPlaceOf(two.scheme.id).y }, { x: 10, y: 20 });
  // Отметка новая — поверхности читают перенесённое как чужое место.
  const stamp = screenPlaceOf(two.scheme.id).stamp;
  assert.equal(screenPlaceCarry(two.project, plain.scheme.id, two.scheme.id), stamp, "перенос не со своей схемы что-то сдвинул");
  screenPlaceForget();
});
