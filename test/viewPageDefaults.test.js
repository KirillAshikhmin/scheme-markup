// Умолчания страницы просмотра и переключатель связей (таск 07 просмотра,
// G28–G30).
//
// Три слова заказчика: «В просмотре по умолчанию ,без ускорения время должно
// идти, так же делай вид от 1 лица по умолчанию. Так же в просмотре сделай
// кнопку в шапке, как и в редакторе - переключатель связей, что бы стрелки все
// были видны». И «На всех трёх» — о раскладках, на которых стоит кнопка связей.
//
// Здесь проверяется то, что ломается молча: таблица «умение × род × раскладка»
// (кнопка связей пришла в просмотр, а в «Разметке» осталась только на
// компьютере — G242), умолчание ускорения у рода страницы и вид, с которого
// открывается «Объём». Чего здесь нет нарочно: вида шапки на трёх раскладках и
// первого кадра «Объёма» — это живой прогон (правила в `AGENTS.md`).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { LAYOUT_ABILITIES, VIEW_ABILITIES, VIEW_GRANTS, appAllows } from "../src/app.js";
import { APP_CLOCK_SPEED_SETTING, appClockSpeedStart } from "../src/appClock.js";
import { VOLUME_CLOCK_SPEED_DEFAULT, VOLUME_CLOCK_SPEED_REAL, volumeClockSpeedOf } from "../src/clockMath.js";
import { SCREEN_LOOK_VIEWS } from "../src/screenPlace.js";
import { volumeFitsOnArrive, volumeViewStart } from "../src/panels/volume.js";
import { setSetting } from "../src/store.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (...parts) => readFileSync(join(ROOT, ...parts), "utf8");

/** Свежий экземпляр часов: у каждого теста свой хозяин, как после загрузки страницы. */
let fresh = 0;
async function clockModule() {
  fresh += 1;
  return import("../src/appClock.js?defaults=" + fresh);
}

/** Доехали все микрозадания: настройки читаются обещаниями. */
function settled() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

// ——— G30: переключатель связей в шапке просмотра ————————————————————————

test("связи в просмотре даёт перечень умений, а не второе условие в кнопке", () => {
  // Раскладка своего слова не меняла: в «Разметке» кнопка связей по-прежнему
  // только на компьютере — это прежнее решение заказчика (G242, таск 163).
  assert.deepEqual([...LAYOUT_ABILITIES.markLinks], ["desktop"]);
  // Поэтому перечень умений просмотра перестал быть простым пересечением: род
  // страницы **даёт** умение там, где раскладка его не даёт. Выражено это
  // перечнем — вторым таким же, как белый список.
  assert.ok(VIEW_ABILITIES.includes("markLinks"), "связей нет в белом списке просмотра");
  assert.ok(VIEW_GRANTS.includes("markLinks"), "связи не даны роду `view` поверх раскладки");
  for (const ability of VIEW_GRANTS) {
    assert.ok(VIEW_ABILITIES.includes(ability), ability + ": дано умение, которого в просмотре нет вовсе");
  }
  for (const ability of VIEW_GRANTS) {
    assert.ok(ability in LAYOUT_ABILITIES, ability + ": умения нет в таблице раскладок");
  }

  // Все три раскладки: компьютер, планшет в раскладке просмотра и телефон.
  assert.equal(appAllows("markLinks", { app: "view", layout: "desktop" }), true);
  assert.equal(appAllows("markLinks", { app: "view", layout: "mobile", tablet: true }), true);
  assert.equal(appAllows("markLinks", { app: "view", layout: "mobile" }), true);
  // «Разметка» — как была: телефон без кнопки, компьютер с кнопкой.
  assert.equal(appAllows("markLinks", { app: "edit", layout: "mobile" }), false);
  assert.equal(appAllows("markLinks", { app: "edit", layout: "mobile", tablet: true }), false);
  assert.equal(appAllows("markLinks", { app: "edit", layout: "desktop" }), true);
  // Дар — только названному умению: остальное просмотр по-прежнему не даёт, и
  // раскладку он не отменяет ни для одного из прочих умений.
  for (const ability of Object.keys(LAYOUT_ABILITIES)) {
    if (VIEW_GRANTS.includes(ability)) continue;
    const allowed = VIEW_ABILITIES.includes(ability) && LAYOUT_ABILITIES[ability].includes("mobile");
    assert.equal(appAllows(ability, { app: "view", layout: "mobile" }), allowed, ability + ": род `view` на телефоне");
  }
});

test("кнопка связей поднимется на второй странице и спросит одну дверь прав", () => {
  // Панель монтируется только там, где для неё есть узел (`mountPanel` молча
  // проходит мимо отсутствующего), поэтому точка монтирования и есть ответ на
  // «есть ли кнопка в шапке просмотра».
  assert.match(read("src", "view.html"), /id="header-links"/);
  const panel = read("src", "panels", "links.js");
  assert.match(panel, /appAllows\(\s*"markLinks"/, "кнопка спрашивает не ту дверь");
  assert.ok(
    !/\bappKind\s*\(/.test(panel),
    "право выражено перечнем умений, а не вторым условием в самой кнопке",
  );
  // Стрелки по всему плану зажигает холст, и спрашивает он то же умение: иначе
  // кнопка горела бы, а связей на плане не было.
  assert.match(read("src", "canvas.js"), /appAllows\(\s*"markLinks"/);
});

// ——— G28: часы просмотра идут без ускорения ————————————————————————————

test("умолчание ускорения — у рода страницы: в просмотре ×1, в «Разметке» ×60", () => {
  assert.equal(appClockSpeedStart("view"), VOLUME_CLOCK_SPEED_REAL);
  assert.equal(appClockSpeedStart("edit"), VOLUME_CLOCK_SPEED_DEFAULT);
  // Чужое слово — «Разметка»: опечатка не отнимает у инженера его умолчание.
  assert.equal(appClockSpeedStart("чужое"), VOLUME_CLOCK_SPEED_DEFAULT);
  assert.equal(appClockSpeedStart(undefined), VOLUME_CLOCK_SPEED_DEFAULT);
  // Пустое хранилище умолчания страницы не перетирает: прежде всякое
  // неизвестное слово становилось ×60 — то есть умолчанием «Разметки».
  assert.equal(volumeClockSpeedOf(null, VOLUME_CLOCK_SPEED_REAL), VOLUME_CLOCK_SPEED_REAL);
  assert.equal(volumeClockSpeedOf("быстро", VOLUME_CLOCK_SPEED_REAL), VOLUME_CLOCK_SPEED_REAL);
  assert.equal(volumeClockSpeedOf(240, VOLUME_CLOCK_SPEED_REAL), 240);
  // Прежний довод один — прежний ответ: умолчание «Разметки».
  assert.equal(volumeClockSpeedOf(null), VOLUME_CLOCK_SPEED_DEFAULT);
});

test("на странице просмотра время идёт, а не стоит, и идёт как настоящее", async () => {
  await setSetting(APP_CLOCK_SPEED_SETTING, null);
  const app = await clockModule();
  app.appClockUseKind("view");
  const nowMs = 7_000_000;
  const clock = app.appClockNow(nowMs);
  assert.equal(clock.speed, VOLUME_CLOCK_SPEED_REAL, "в просмотре ускорения нет");
  assert.equal(clock.fixed, false, "время идёт, а не стоит");
  // Секунда настоящего времени — секунда на часах объекта.
  assert.ok(Math.abs(app.appClockSimMs(nowMs + 1000) - app.appClockSimMs(nowMs) - 1000) < 1e-3);
  app.appClockWatch(() => {});
  await settled();
  assert.equal(app.appClockRead().speed, VOLUME_CLOCK_SPEED_REAL, "приезд пустой настройки вернул ×60");
});

test("выбранное человеком ускорение переживает перезаход и умолчанием не перетирается", async () => {
  await setSetting(APP_CLOCK_SPEED_SETTING, 240);
  const app = await clockModule();
  app.appClockUseKind("view");
  app.appClockWatch(() => {});
  await settled();
  assert.equal(app.appClockRead().speed, 240, "выбор человека старше умолчания страницы");
  assert.equal(app.appClockNow().speed, 240, "идущие часы пошли с ним");
  // У «Разметки» умолчание прежнее, и приезд настроек его не меняет.
  await setSetting(APP_CLOCK_SPEED_SETTING, null);
  const edit = await clockModule();
  edit.appClockUseKind("edit");
  edit.appClockWatch(() => {});
  await settled();
  assert.equal(edit.appClockRead().speed, VOLUME_CLOCK_SPEED_DEFAULT);
});

// ——— G29: «Объём» просмотра открывается от первого лица ————————————————

test("в просмотре «Объём» открывается от первого лица, в «Разметке» — обзором", () => {
  assert.equal(volumeViewStart("view"), "person");
  assert.equal(volumeViewStart("edit"), "around");
  assert.equal(volumeViewStart(undefined), "around");
  for (const kind of ["view", "edit"]) {
    assert.ok(SCREEN_LOOK_VIEWS.includes(volumeViewStart(kind)), kind + ": вид не из тех, что помнит запись");
  }
  // Вид берётся у рода страницы один раз, при сборке поверхности.
  assert.match(read("src", "panels", "volume.js"), /volumeViewStart\(appKind\(\)\)/);
});

test("первый кадр показывает всю схему только обзору и только без памяти взгляда", () => {
  // «Вся схема» — решение таска 146 («показать заказчику» начинается с общего
  // вида), и оно обязано молчать там, где вид открылся первым лицом: иначе
  // `fit()` вернул бы обзор силой и умолчание просмотра не дожило бы до кадра.
  assert.equal(volumeFitsOnArrive({ empty: false, looked: false, view: "around" }), true);
  assert.equal(volumeFitsOnArrive({ empty: false, looked: false, view: "person" }), false);
  // Взгляд помнят (таск 227) — кадр его не перебивает ни в одном виде.
  assert.equal(volumeFitsOnArrive({ empty: false, looked: true, view: "around" }), false);
  assert.equal(volumeFitsOnArrive({ empty: false, looked: true, view: "person" }), false);
  // Пустой сцене рамку считать нечем.
  assert.equal(volumeFitsOnArrive({ empty: true, looked: false, view: "around" }), false);
});
