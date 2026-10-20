// Чертёж живёт по правилам меток (таск 187, G280 и G281).
//
// Проверяется чистая половина переноса — та, которая может разойтись молча:
//
//   **строка «что поставит следующий клик»** считается одним местом на окно и
//     на плашку колонки. Разойдись они — человек читал бы в колонке одно, а в
//     окне другое, и поймать это можно было бы только глазом;
//   **три списка** правой колонки: породы те же, что шаги окна, заголовков у
//     групп больше нет (имена стоят в разметке разделов), а строки остались
//     прежними — по ним человек ищет элемент глазами;
//   **разметка и настройки**: три точки монтирования, три раздела, ключи
//     настроек слоёв чертежа. Опечатка в любом из этих имён ничего не ломает и
//     не падает — она молча оставляет колонку пустой.
//
// DOM здесь не поднимается: окно и панели проверяет живой прогон со снимками.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  DRAW_PICKER_STEPS,
  WALL_THICKNESS_PRESETS_MM,
  drawPickerHint,
  drawPickerName,
  drawPickerNote,
  drawPickerStepOf,
} from "../src/panels/drawPicker.js";
import { workshopListGroups, WORKSHOP_ADDING, WORKSHOP_OPENING_DEFAULTS } from "../src/panels/workshop.js";
import { GRID_SETTING, GRID_SNAP_SETTING, PANEL_IDS, SECTION_IDS } from "../src/app.js";
import { strings } from "../src/strings.js";
import {
  addOpening,
  addSchemeObject,
  addScheme,
  addWall,
  createProject,
  wallName,
} from "../src/model.js";

const MARKUP = readFileSync(new URL("../src/index.html", import.meta.url), "utf8");

function scene() {
  const made = addScheme(createProject(), { name: "1 этаж", imageId: "скан", width: 2400, height: 1600 });
  const schemeId = made.scheme.id;
  const wall = addWall(made.project, {
    schemeId,
    aMm: { x: 0, y: 0 },
    bMm: { x: 4000, y: 0 },
    thicknessMm: 100,
  });
  const opening = addOpening(wall.project, {
    wallId: wall.wall.id,
    kind: "door",
    atMm: 500,
    widthMm: 900,
    heightMm: 2100,
    heightAboveFloorMm: 0,
  });
  const object = addSchemeObject(opening.project, {
    schemeId,
    catalogKey: "radiator",
    shape: "rect",
    atMm: { x: 1000, y: 500 },
    turnDeg: 0,
    widthMm: 1200,
    depthMm: 100,
    heightMm: 500,
    heightAboveFloorMm: 150,
  });
  return { project: object.project, schemeId, wall: wall.wall, opening: opening.opening, object: object.schemeObject };
}

// ——— окно «Что добавить» ————————————————————————————————————————————————

test("шаги окна — те же три породы, что занятия чертежа и списки колонки", () => {
  assert.deepEqual(DRAW_PICKER_STEPS, ["walls", "openings", "objects"]);
  // Порядок задан заказчиком (G176) и повторён в трёх местах: занятие, шаг
  // окна, раздел колонки. Разойдись они — «Добавление» включало бы не то, что
  // горит в окне.
  assert.deepEqual([...WORKSHOP_ADDING], [...DRAW_PICKER_STEPS]);
  assert.equal(drawPickerName("walls"), strings.workshop.toolWalls);
  assert.equal(drawPickerName("openings"), strings.workshop.toolOpenings);
  assert.equal(drawPickerName("objects"), strings.workshop.toolObjects);
  assert.equal(drawPickerHint("objects"), strings.workshop.toolObjectsHint);
  // Неизвестное слово раскрывает стены: окно обязано показать хоть один шаг.
  assert.equal(drawPickerStepOf("edit"), "walls");
  assert.equal(drawPickerStepOf(undefined), "walls");
  assert.equal(drawPickerStepOf("objects"), "objects");
});

test("строка шага говорит, что поставит следующий клик", () => {
  const settings = {
    walls: { thicknessMm: 150 },
    openings: { kind: "door", sizes: WORKSHOP_OPENING_DEFAULTS },
    objects: { key: "radiator", way: "rect" },
  };
  assert.equal(drawPickerNote("walls", settings), "толщина 150 мм");
  const opening = drawPickerNote("openings", settings);
  assert.ok(opening.includes(strings.openingKinds.door), "в строке проёма не назван вид: " + opening);
  assert.ok(opening.includes("900"), "в строке проёма нет ширины: " + opening);
  assert.ok(opening.includes("2100"), "в строке проёма нет высоты: " + opening);
  const object = drawPickerNote("objects", settings);
  assert.ok(object.includes("Радиатор"), "в строке вещи нет её имени: " + object);
  assert.ok(object.includes(strings.workshop.way_rect), "в строке вещи нет способа: " + object);
});

test("нечего показать — строка молчит, а не выдумывает число", () => {
  assert.equal(drawPickerNote("objects", { objects: { key: null } }), strings.drawPicker.noteEmpty);
  assert.equal(drawPickerNote("walls", { walls: {} }), strings.drawPicker.noteEmpty);
  assert.equal(drawPickerNote("openings", { openings: { kind: "door", sizes: {} } }), strings.drawPicker.noteEmpty);
  // Довода нет вовсе — не падаем: плашка колонки зовёт эту же строку на каждом
  // кадре, в том числе до того, как чертёж открыт.
  assert.equal(drawPickerNote("walls"), strings.drawPicker.noteEmpty);
});

test("частые толщины — целые миллиметры по возрастанию, и сотня среди них", () => {
  assert.ok(WALL_THICKNESS_PRESETS_MM.length >= 5);
  for (const value of WALL_THICKNESS_PRESETS_MM) {
    assert.ok(Number.isInteger(value) && value > 0, "толщина не целая: " + value);
  }
  const sorted = [...WALL_THICKNESS_PRESETS_MM].sort((a, b) => a - b);
  assert.deepEqual(WALL_THICKNESS_PRESETS_MM, sorted, "плитки толщин стоят не по порядку");
  // Умолчание чертежа обязано быть среди плиток: иначе открытое окно не
  // подсвечивало бы ни одной.
  assert.ok(WALL_THICKNESS_PRESETS_MM.includes(100));
});

// ——— три списка правой колонки ——————————————————————————————————————————

test("списков три, по породе на каждый, и своего заголовка у группы больше нет", () => {
  const { project, schemeId, wall, opening, object } = scene();
  const groups = workshopListGroups(project, schemeId);
  assert.deepEqual(
    groups.map((group) => group.kind),
    ["wall", "opening", "object"],
  );
  for (const group of groups) {
    assert.equal("title" in group, false, "у группы остался свой заголовок — имя раздела стоит в разметке");
  }
  const [walls, openings, objects] = groups;
  assert.deepEqual(walls.rows.map((row) => row.id), [wall.id]);
  assert.deepEqual(openings.rows.map((row) => row.id), [opening.id]);
  assert.deepEqual(objects.rows.map((row) => row.id), [object.id]);
  // Имя стены то же, что на чертеже и в развёртке: второго имени у неё нет.
  assert.ok(walls.rows[0].label.includes(wallName(project, wall.id)));
  assert.ok(openings.rows[0].note.includes(wallName(project, wall.id)), "проём не назвал свою стену");
  assert.ok(objects.rows[0].label.includes("Радиатор"));
});

test("без схемы списки пусты, а не падают", () => {
  assert.deepEqual(workshopListGroups(null, null), []);
  assert.deepEqual(workshopListGroups(createProject(), null), []);
});

// ——— разметка и настройки ————————————————————————————————————————————————

test("у трёх списков своя точка монтирования, свой раздел и своё имя", () => {
  const ids = [
    [PANEL_IDS.drawWalls, SECTION_IDS.drawWalls, strings.panels.drawWalls],
    [PANEL_IDS.drawOpenings, SECTION_IDS.drawOpenings, strings.panels.drawOpenings],
    [PANEL_IDS.drawObjects, SECTION_IDS.drawObjects, strings.panels.drawObjects],
  ];
  for (const [mount, section, name] of ids) {
    assert.ok(MARKUP.includes('id="' + mount + '"'), "в разметке нет точки монтирования " + mount);
    assert.ok(MARKUP.includes('data-section-id="' + section + '"'), "в разметке нет раздела " + section);
    assert.ok(MARKUP.includes('data-section="' + section + '"'), "раздел " + section + " нечем свернуть");
    assert.ok(typeof name === "string" && name.length > 0, "у раздела " + section + " нет имени");
  }
  // Прежний единый список ушёл — ни точки монтирования, ни ключа строки.
  assert.ok(!MARKUP.includes('id="panel-draw-list"'));
  assert.ok(!MARKUP.includes("panels.drawList"));
  assert.equal(strings.panels.drawList, undefined);
});

test("слои чертежа помнятся настройками браузера, а не объектом", () => {
  // Ключи разные и непустые: один ключ на две отметки погасил бы сетку вместе
  // с притяжкой у всех, кто уже работает.
  assert.equal(typeof GRID_SETTING, "string");
  assert.equal(typeof GRID_SNAP_SETTING, "string");
  assert.notEqual(GRID_SETTING, GRID_SNAP_SETTING);
  assert.ok(GRID_SETTING.length > 0 && GRID_SNAP_SETTING.length > 0);
});
