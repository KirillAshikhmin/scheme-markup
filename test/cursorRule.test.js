// Курсор отвечает на один вопрос одинаково на плане и в чертеже (находка 6
// разбора механик).
//
// Ответы были противоположны: план знал **только про режим** (`default` в
// «Выделении», `crosshair` во всём остальном) и не спрашивал, что под рукой;
// чертёж знал только про то, что под рукой, в наведении. Выбран ответ «и про
// режим, и про то, что под рукой», в порядке: панорама → ожидание точки →
// попадание → пусто.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  CURSOR_IDLE,
  CURSOR_MOVE,
  CURSOR_PAN,
  CURSOR_PLACE,
  CURSOR_PRESS,
  CURSOR_PULL,
  cursorFor,
} from "../src/render.js";

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = join(here, "..", "src");

test("порядок ответов: панорама старше постановки, постановка — попадания", () => {
  // Рука возит лист — что под ней, не значит ничего.
  assert.equal(cursorFor({ pan: true, place: true, move: true }), CURSOR_PAN);
  // Ждут точку — попадание ответа не меняет: клик поставит точку.
  assert.equal(cursorFor({ place: true, move: true, pull: true }), CURSOR_PLACE);
  // «Выделение»: отвечает то, что под рукой.
  assert.equal(cursorFor({ pull: true, move: true }), CURSOR_PULL);
  assert.equal(cursorFor({ press: true, move: true }), CURSOR_PRESS);
  assert.equal(cursorFor({ move: true }), CURSOR_MOVE);
  assert.equal(cursorFor({}), CURSOR_IDLE);
  assert.equal(cursorFor(), CURSOR_IDLE);
});

test("слова курсора — те же, что были у чертежа: человек к ним привык", () => {
  assert.equal(CURSOR_PAN, "grab");
  assert.equal(CURSOR_PLACE, "crosshair");
  assert.equal(CURSOR_PULL, "grab");
  assert.equal(CURSOR_PRESS, "pointer");
  assert.equal(CURSOR_MOVE, "move");
  assert.equal(CURSOR_IDLE, "default");
});

test("второго правила курсора в исходниках нет", () => {
  // Правило, записанное внутри двух обработчиков, уже разошлось один раз.
  for (const name of ["canvas.js", join("panels", "workshop.js")]) {
    const text = readFileSync(join(srcDir, name), "utf8");
    const lines = text.split("\n");
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      if (!/style\.cursor\s*=/.test(line)) continue;
      assert.ok(
        /cursorFor\(/.test(line),
        `${name}:${index + 1} — курсор назначен мимо cursorFor: ${line.trim()}`,
      );
    }
  }
});
