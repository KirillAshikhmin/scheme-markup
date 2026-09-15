// Дата в имени файла — местная, а не UTC.
//
// Файл отдельный и со своей зоной: `node --test` запускает каждый файл своим
// процессом, поэтому подмена TZ здесь не задевает остальные тесты. Зона —
// Москва: разметку правят вечером, и именно вечером UTC-дата отстаёт на сутки.
process.env.TZ = "Europe/Moscow";

import { test } from "node:test";
import assert from "node:assert/strict";
import { projectFileName } from "../src/projectFile.js";

test("вечерняя выгрузка помечена сегодняшним днём пользователя, а не вчерашним по UTC", () => {
  // 16 сентября, 01:19 по Москве — в UTC это ещё 15-е, 22:19.
  const night = new Date("2026-09-15T22:19:00Z");
  assert.equal(night.getDate(), 16);
  assert.equal(projectFileName({ name: "Квартира Оли" }, night), "Квартира Оли-2026-09-16.zip");

  // Полдень сходится в обеих зонах — общий случай не должен сдвинуться.
  assert.equal(
    projectFileName({ name: "Квартира Оли" }, new Date("2026-09-16T09:00:00Z")),
    "Квартира Оли-2026-09-16.zip",
  );
});

test("дата берётся из переданного времени, а не из часов машины", () => {
  const long = new Date("2027-01-01T20:30:00Z");
  assert.equal(projectFileName({ name: "Объект" }, long), "Объект-2027-01-01.zip");
  assert.notEqual(projectFileName({ name: "Объект" }, long), projectFileName({ name: "Объект" }));
});
