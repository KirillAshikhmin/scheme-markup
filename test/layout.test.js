// Раскладка: широкий экран правит, узкий смотрит.
//
// Решение о режиме и список того, что в режиме доступно, — самое лёгкое место
// для тихого расхождения: правило живёт в одном месте, панели спрашивают его в
// пяти. Поэтому обе половины чистые и проверяются здесь, а не глазами.
import test from "node:test";
import assert from "node:assert/strict";

import {
  LAYOUT_ABILITIES,
  LAYOUT_MODES,
  LAYOUT_NARROW_WIDTH,
  LAYOUT_PHONE_SIDE,
  LAYOUT_TABLET_ABILITIES,
  layoutAllows,
  layoutAllowsState,
  layoutModeFor,
  layoutTabletFor,
} from "../src/app.js";

const phone = { width: 390, height: 844, coarsePointer: true };
// Большой телефон лёжа: 926 px шире порога окна, и без правила короткой
// стороны он превратился бы в редактор.
const phoneTurned = { width: 926, height: 428, coarsePointer: true };
const tabletPortrait = { width: 768, height: 1024, coarsePointer: true };
const tabletLandscape = { width: 1024, height: 768, coarsePointer: true };
const desktop = { width: 1440, height: 900, coarsePointer: false };

test("телефон остаётся просмотром и после поворота", () => {
  assert.equal(layoutModeFor(phone), "mobile");
  // Ширина больше порога окна — решает короткая сторона: это тот же телефон.
  assert.ok(phoneTurned.width > LAYOUT_NARROW_WIDTH);
  assert.equal(layoutModeFor(phoneTurned), "mobile");
  assert.ok(Math.min(phoneTurned.width, phoneTurned.height) <= LAYOUT_PHONE_SIDE);
});

test("планшет стоймя смотрит, лёжа — работает как десктоп", () => {
  assert.equal(layoutModeFor(tabletPortrait), "mobile");
  assert.equal(layoutModeFor(tabletLandscape), "desktop");
});

test("десктоп правит, а суженное окно — тот самый просмотр вблизи", () => {
  assert.equal(layoutModeFor(desktop), "desktop");
  assert.equal(layoutModeFor({ width: 700, height: 900, coarsePointer: false }), "mobile");
  assert.equal(layoutModeFor({ width: LAYOUT_NARROW_WIDTH, height: 900, coarsePointer: false }), "mobile");
  assert.equal(layoutModeFor({ width: LAYOUT_NARROW_WIDTH + 1, height: 900, coarsePointer: false }), "desktop");
});

test("ручной выбор перекрывает экран в обе стороны, пустой замер — нет", () => {
  assert.equal(layoutModeFor(phone, "desktop"), "desktop");
  assert.equal(layoutModeFor(desktop, "mobile"), "mobile");
  assert.equal(layoutModeFor(phone, "чепуха"), "mobile");
  assert.equal(layoutModeFor(phone, null), "mobile");
  // Померить не удалось — не повод прятать панели.
  assert.equal(layoutModeFor({ width: 0, height: 0, coarsePointer: false }), "desktop");
  assert.equal(layoutModeFor(null), "desktop");
});

test("в режиме просмотра доступно смотреть и открывать, но не править", () => {
  // `viewSizes` в этом списке с таска 175 (G272): «в мобильной вёрстке добавь
  // кнопку в шапку „Интерфейс проекта“». Размер меток и подписей, шрифт, слои
  // плана и масштаб — это «как я это вижу», а не правка разметки, и на объекте
  // с телефона их крутят чаще, чем за столом. Раздел левой колонки на узком
  // экране при этом по-прежнему не показывается: дверь к полям одна — кнопка
  // в шапке.
  for (const ability of ["viewPlan", "switchProject", "switchScheme", "markList", "filters", "tables", "exportFiles", "openFile", "viewSizes"]) {
    assert.equal(layoutAllows(ability, "mobile"), true, ability + " должно быть доступно на телефоне");
    assert.equal(layoutAllows(ability, "desktop"), true, ability + " должно быть доступно на десктопе");
  }
  // Связи ушли с узкого экрана по слову заказчика (таск 163, G242) — не
  // потому, что это правка: «спрячь кнопку отображения связей, тогда на
  // смартфоне вся верхняя панель должна уместиться в 1 строку». Стоит в том же
  // списке, потому что проверяется то же самое: кнопки на телефоне нет.
  for (const ability of ["editMarks", "editSchemes", "editRooms", "editProject", "dictionary", "saveFile", "markLinks"]) {
    assert.equal(layoutAllows(ability, "mobile"), false, ability + " не должно быть доступно на телефоне");
    assert.equal(layoutAllows(ability, "desktop"), true, ability + " должно быть доступно на десктопе");
  }
});

test("неизвестное умение считается правкой: опечатка прячет кнопку, а не пускает правку", () => {
  assert.equal(layoutAllows("editEverything", "mobile"), false);
  assert.equal(layoutAllows("editEverything", "desktop"), false);
  assert.equal(layoutAllows("viewPlan", "чужой режим"), false);
});

test("в таблице умений нет выдуманных режимов", () => {
  for (const [ability, modes] of Object.entries(LAYOUT_ABILITIES)) {
    assert.ok(Array.isArray(modes) && modes.length > 0, ability + ": режимы не перечислены");
    for (const mode of modes) {
      assert.ok(LAYOUT_MODES.includes(mode), ability + ": неизвестный режим " + mode);
    }
    assert.ok(modes.includes("desktop"), ability + ": на широком экране доступно всё");
  }
});

// ——— планшет в раскладке просмотра (слепая приёмка, F2) ——————————————————
//
// Планшет стоймя 820×1180 с сенсором открывал «Сценарии» как телефон: всё, что
// уже 860 точек, — раскладка просмотра, и правки там не было. Заказчик (раунд
// 5): компьютер и планшет — полностью, телефон — список с «Активный»,
// просмотр и журнал. Раскладка у планшета прежняя — прочие режимы правил не
// меняют; планшет отличает короткая сторона больше телефонной.

const tabletTall = { width: 820, height: 1180, coarsePointer: true };

test("планшет — короткая сторона больше телефонной, в любой ориентации; раскладка у него прежняя", () => {
  assert.equal(layoutModeFor(tabletTall), "mobile", "раскладка планшета стоймя поменялась");
  for (const view of [tabletTall, { width: 1180, height: 820, coarsePointer: true }, tabletPortrait, tabletLandscape]) {
    assert.equal(layoutTabletFor(view), true, view.width + "×" + view.height + " — планшет");
  }
  for (const view of [phone, phoneTurned, { width: LAYOUT_PHONE_SIDE, height: 900, coarsePointer: true }]) {
    assert.equal(layoutTabletFor(view), false, view.width + "×" + view.height + " — телефон");
  }
  assert.equal(layoutTabletFor({ width: LAYOUT_PHONE_SIDE + 1, height: 900, coarsePointer: false }), true);
  assert.equal(layoutTabletFor(null), false);
  assert.equal(layoutTabletFor({ width: 0, height: 0 }), false);
});

test("планшет в просмотре правит сценарии, остальные умения у него — телефонные; «Активный» — и на телефоне", () => {
  const tablet = { layout: "mobile", tablet: true };
  const phoneState = { layout: "mobile", tablet: false };
  assert.equal(layoutAllowsState("editScenarios", tablet), true, "планшет не правит сценарии");
  assert.equal(layoutAllowsState("editScenarios", phoneState), false);
  assert.equal(layoutAllowsState("editScenarios", { layout: "mobile" }), false, "неизвестный экран — телефон");
  assert.equal(layoutAllowsState("editScenarios", { layout: "desktop" }), true);
  assert.deepEqual([...LAYOUT_TABLET_ABILITIES], ["editScenarios"]);
  for (const ability of Object.keys(LAYOUT_ABILITIES)) {
    if (LAYOUT_TABLET_ABILITIES.includes(ability)) continue;
    assert.equal(layoutAllowsState(ability, tablet), layoutAllows(ability, "mobile"), ability + ": у планшета не телефонное правило");
  }
  assert.equal(layoutAllowsState("toggleScenarios", phoneState), true, "телефон не включает сценарии");
  assert.equal(layoutAllowsState("toggleScenarios", { layout: "desktop" }), true);
  assert.equal(layoutAllowsState("unknownAbility", tablet), false);
});
