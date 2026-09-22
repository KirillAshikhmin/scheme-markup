// Файлы веб-версии: манифест установки и значок приложения.
//
// Правило сборки — «страница одна и самодостаточна» — здесь получило ровно одно
// исключение: ссылку на манифест. Исключение узкое, и проверяется оно с обеих
// сторон: манифест пропускается, любой другой сосед роняет сборку, пропавшая
// ссылка — тоже (без неё с сайта перестанут предлагать установку, и заметить
// это можно было бы только в браузере).
//
// Значок приложения не рисуется заново: он достаётся из `<link rel="icon">`
// самой страницы. Тест сверяет, что достаётся именно он.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { MANIFEST_FILE, assertSingleFile, iconSvgFrom, manifestJson, maskableSvgFrom } from "../build.js";
import { strings } from "../src/strings.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const template = readFileSync(join(ROOT, "src", "index.html"), "utf8");

const page = (body) =>
  '<link rel="icon" href="data:image/svg+xml,%3Csvg%3E%3C/svg%3E" />' +
  '<link rel="manifest" href="' + MANIFEST_FILE + '" />' +
  body;

test("страница с манифестом и рисунком в адресе проходит", () => {
  assert.doesNotThrow(() => assertSingleFile(page('<a href="#marks">к меткам</a>')));
});

test("любой другой сосед по папке роняет сборку", () => {
  assert.throws(() => assertSingleFile(page('<img src="logo.png" />')), /logo\.png/);
  assert.throws(() => assertSingleFile(page('<link rel="apple-touch-icon" href="icon.svg" />')), /icon\.svg/);
});

test("манифест разрешён только относительной ссылкой", () => {
  // Абсолютный путь увёл бы установку в корень чужого сайта: на GitHub Pages
  // приложение живёт в подпапке.
  assert.throws(() => assertSingleFile('<link rel="manifest" href="/manifest.webmanifest" />'), /manifest/);
  assert.throws(
    () => assertSingleFile('<link rel="manifest" href="https://example.org/manifest.webmanifest" />'),
    /manifest/,
  );
});

test("пропавшая ссылка на манифест — тоже поломка", () => {
  assert.throws(() => assertSingleFile('<link rel="icon" href="data:image/svg+xml,%3Csvg%3E%3C/svg%3E" />'), /установк/i);
});

test("в самой разметке ссылка на манифест стоит и она относительная", () => {
  // Разметка до сборки — не готовая страница (в ней ещё живут `styles.css` и
  // `app.js`, которые сборка вклеивает внутрь), поэтому здесь проверяется
  // только сама ссылка: пропади она — установка отвалится молча.
  const links = [...template.matchAll(/<link[^>]+rel="manifest"[^>]*>/gi)];
  assert.equal(links.length, 1, "ссылка на манифест должна быть ровно одна");
  assert.match(links[0][0], new RegExp('href="' + MANIFEST_FILE + '"'));
});

test("значок приложения — тот же рисунок, что во вкладке", () => {
  const svg = iconSvgFrom(template);
  assert.match(svg, /^<svg\b/);
  assert.match(svg, /<\/svg>$/);
  // Тот же рисунок, а не похожий: тест достаёт адрес значка своим способом и
  // разворачивает его сам.
  const href = template.match(/<link[^>]+rel="icon"[^>]+href="([^"]+)"/i)[1];
  assert.equal(svg, decodeURIComponent(href.replace("data:image/svg+xml,", "")));
  assert.throws(() => iconSvgFrom("<html></html>"), /значок/i);
});

test("манифест называет приложение словами из словаря", () => {
  const manifest = JSON.parse(manifestJson());
  assert.equal(manifest.name, strings.app.title);
  assert.equal(manifest.short_name, strings.app.installShortName);
  assert.equal(manifest.description, strings.app.installDescription);
  assert.ok(manifest.short_name.length <= manifest.name.length, "короткое имя должно быть короче полного");
});

test("манифест отвечает требованиям установки и не привязан к корню сайта", () => {
  const manifest = JSON.parse(manifestJson());
  assert.equal(manifest.display, "standalone");
  assert.equal(manifest.start_url, ".", "адрес запуска относительный: приложение живёт в подпапке");
  assert.equal(manifest.scope, ".");
  assert.ok(Array.isArray(manifest.icons) && manifest.icons.length > 0);
  for (const icon of manifest.icons) {
    assert.equal(icon.src.startsWith("/"), false, "путь значка относительный");
    assert.equal(icon.sizes, "any", "один рисунок на все размеры — он тянется без потерь");
  }
  assert.ok(
    manifest.icons.some((icon) => icon.purpose === "maskable"),
    "без maskable Android обрежет значок по своему усмотрению",
  );
  // Под маску идёт отдельный файл: тот же рисунок, но с полями. Тот же самый
  // означал бы обрез по рамке плана.
  const masked = manifest.icons.find((icon) => icon.purpose === "maskable");
  const plain = manifest.icons.find((icon) => icon.purpose === "any");
  assert.notEqual(masked.src, plain.src);
  // Ориентацию не задаём нарочно: инструментом работают и стоймя, и лёжа.
  assert.equal("orientation" in manifest, false);
  assert.equal("prefer_related_applications" in manifest, false);
});

test("значок под маску — тот же рисунок, отодвинутый от краёв", () => {
  const svg = iconSvgFrom(template);
  const masked = maskableSvgFrom(svg);
  // Рисунок внутри тот же: из него не потерялась ни одна фигура.
  for (const figure of svg.match(/<(?:rect|path|circle)[^>]*>/g)) {
    assert.ok(masked.includes(figure), "фигура потерялась при подготовке значка под маску: " + figure);
  }
  // И он сжат к середине: обрез маской съедает края.
  assert.match(masked, /transform="translate\(6\.4 6\.4\) scale\(0\.6\)"/);
  assert.equal(masked.startsWith("<svg"), true);
  assert.equal(masked.endsWith("</svg>"), true);
  // Вложенного второго <svg> быть не должно: значок не рисуется заново,
  // а переносится содержимым.
  assert.equal(masked.split("<svg").length, 2);
});
