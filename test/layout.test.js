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
  layoutAllows,
  layoutModeFor,
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
  for (const ability of ["viewPlan", "switchProject", "switchScheme", "markList", "filters", "tables", "exportFiles", "openFile"]) {
    assert.equal(layoutAllows(ability, "mobile"), true, ability + " должно быть доступно на телефоне");
    assert.equal(layoutAllows(ability, "desktop"), true, ability + " должно быть доступно на десктопе");
  }
  for (const ability of ["editMarks", "editSchemes", "editRooms", "editProject", "dictionary", "viewSizes", "saveFile"]) {
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
