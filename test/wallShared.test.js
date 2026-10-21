// Выделенная стена — одна на план и на чертёж (находка 13 разбора механик).
//
// Хранилищ два: состояние сеанса `selectedWallId` (его читают холст и полоса
// развёртки) и своё `selected` внутри чертежа. Связь была односторонней —
// чертёж писал наружу, а обратно не читал, и об этом в коде был написан абзац
// «выделение у чертежа и у плана общее». Выделил стену на плане, перешёл в
// «Чертёж» — «Стена не выделена», и стену приходилось искать мышью заново.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { workshopWallAdopt } from "../src/panels/workshop.js";

const srcDir = join(dirname(fileURLToPath(import.meta.url)), "..", "src");

test("стена с плана подхватывается чертежом", () => {
  assert.deepEqual(
    workshopWallAdopt({ wantId: "w1", haveId: null, onScheme: true, tool: "edit" }),
    { kind: "select", id: "w1", mode: false },
  );
});

test("в «Добавлении» занятие сперва переводится в «Выделение»", () => {
  // Выделенное живёт только в «Выделении»: `setTool` снимает его нарочно —
  // иначе поля стены перебивали бы умолчания проёма.
  assert.deepEqual(
    workshopWallAdopt({ wantId: "w1", haveId: null, onScheme: true, tool: "openings" }),
    { kind: "select", id: "w1", mode: true },
  );
});

test("общее опустело — выделение снимается", () => {
  // Полосу развёртки закрыли крестиком, не выходя из чертежа: выделение стены
  // это она и есть.
  assert.deepEqual(workshopWallAdopt({ wantId: null, haveId: "w1", onScheme: false, tool: "edit" }), {
    kind: "clear",
  });
});

test("совпало — не трогаем ничего", () => {
  assert.equal(workshopWallAdopt({ wantId: "w1", haveId: "w1", onScheme: true, tool: "edit" }), null);
  assert.equal(workshopWallAdopt({ wantId: null, haveId: null, onScheme: false, tool: "walls" }), null);
  assert.equal(workshopWallAdopt(), null);
});

test("чужой схемы стена не подхватывается", () => {
  // `selectedWallId` сеансовый и живёт поверх схем; выделять в чертеже можно
  // только то, что лежит на его листе.
  assert.equal(workshopWallAdopt({ wantId: "w9", haveId: null, onScheme: false, tool: "edit" }), null);
});

test("подхват зовётся на обе двери: смену выделения и возвращение в чертёж", () => {
  // Смена экрана `selectedWallId` не меняет, и своей ветки он не поднял бы —
  // ровно тот случай, с которого находка и начинается.
  const text = readFileSync(join(srcDir, "panels", "workshop.js"), "utf8");
  assert.ok(/if \("selectedWallId" in changed\) adoptWall\(state\);/.test(text), "ветка подписки пропала");
  const screenAt = text.indexOf('if ("screen" in changed && state.screen === "drawing") {');
  assert.ok(screenAt > 0, "ветка возвращения в чертёж пропала");
  assert.ok(
    text.slice(screenAt, screenAt + 600).includes("adoptWall(state)"),
    "на возвращении в чертёж выделенное на плане не подхватывается",
  );
});
