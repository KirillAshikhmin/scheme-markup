// Заставка загрузки (правка без автопилота, 2026-11-20). Слова заказчика: «пока
// все скрипты на странице загружаются… пусть рисуется заглушка с полосой
// прогресса (реалистичной) и разными подписями… справа в углу… 3д модели
// оборудования… вращаются по очереди».
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildPage, splashFrom } from "../build.js";
import { SPLASH_MARKS, splashMark } from "../src/splash.js";
import { strings } from "../src/strings.js";

const template = readFileSync(new URL("../src/splash.html", import.meta.url), "utf8");

test("заставка собирается из словаря: заголовок, подписи и размер страницы — данными сборки", () => {
  const html = splashFrom(template, 123456.4);
  assert.ok(html.includes('id="splash"'));
  assert.ok(html.includes(strings.app.title));
  for (const step of strings.splash.steps) assert.ok(html.includes(JSON.stringify(step)), step + ": подпись не доехала");
  assert.ok(html.includes("var PAGE_BYTES = 123456;"));
  assert.ok(!html.includes("{{"), "в заставке осталось место подстановки");
  assert.ok(strings.splash.steps.length >= 8, "подписей мало — они начнут повторяться на глазах");
  // Скрипт заставки разбирается сам по себе: он работает раньше бандла.
  const script = html.slice(html.indexOf("<script>") + 8, html.lastIndexOf("</script>"));
  assert.doesNotThrow(() => new Function(script));
});

test("на обеих страницах заставка стоит до разметки приложения и до бандла", async () => {
  const { html, view } = await buildPage();
  for (const [name, page] of [["index.html", html], ["view.html", view]]) {
    const at = page.indexOf('id="splash"');
    assert.ok(at > 0, name + ": заставки нет");
    assert.equal(page.indexOf('id="splash"', at + 1), -1, name + ": заставка вклеена дважды");
    assert.ok(at < page.indexOf('id="app"'), name + ": заставка стоит после приложения");
    assert.ok(page.indexOf("window.schemeSplash") < page.lastIndexOf("<script>"), name + ": скрипт заставки не раньше бандла");
    assert.ok(!page.includes("<!-- splash:"), name + ": отметка шаблона осталась в странице");
  }
});

test("шаги бандла доходят до заставки, а без неё молча никуда не идут", () => {
  assert.equal(splashMark("done"), false);
  const seen = [];
  globalThis.window = { schemeSplash: { mark: (name) => seen.push(name) } };
  try {
    for (const name of SPLASH_MARKS) assert.equal(splashMark(name), true);
    assert.equal(splashMark("чужое"), false);
    assert.deepEqual(seen, ["parsed", "start", "panels", "done"]);
    globalThis.window.schemeSplash = { mark: () => { throw new Error("сломана"); } };
    assert.equal(splashMark("done"), false);
  } finally {
    delete globalThis.window;
  }
});
