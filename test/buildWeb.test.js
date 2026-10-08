// Файлы рядом со страницей: ресурсы самой страницы (шрифт) и файлы веб-версии
// (манифест установки, значки, служебный скрипт).
//
// Правило «результат сборки — единственный файл» снято (ADR 006), и проверка
// ссылок стала другой, но не слабее. Разрешена ровно одна вещь: относительная
// ссылка на файл, который сборка **положила рядом в `dist/`**. Чужой хост,
// абсолютный путь, выход из папки и — главное — имя, которого в `dist/` нет,
// роняют сборку. Последнее важнее всего: опечатка в имени шрифта иначе дала бы
// страницу, которая открылась, но рисует не теми знаками.
//
// Значок приложения не рисуется заново: он достаётся из `<link rel="icon">`
// самой страницы. Тест сверяет, что достаётся именно он.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  MANIFEST_FILE,
  PAGE_FILE,
  assertLocalLinks,
  iconSvgFrom,
  listAssets,
  manifestJson,
  maskableSvgFrom,
  workerScript,
} from "../build.js";
import { strings } from "../src/strings.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const template = readFileSync(join(ROOT, "src", "index.html"), "utf8");
const styles = readFileSync(join(ROOT, "src", "styles.css"), "utf8");
const FONT_FILE = "assets/gost-type-a.ttf";
// Имя семейства в `@font-face`. Оно же в `--font-gost` — и оно нарочно не
// совпадает с именем файла, который у проектировщика стоит в системе.
const FONT_FAMILY = "GOST type A drawn";

// Все исходники страницы: по ним проверяется, что список семейств написан
// ровно там, где ему положено, и больше нигде.
function sourceTree(dir) {
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...sourceTree(full));
    else if (/\.(js|css|html)$/.test(entry.name)) files.push(full);
  }
  return files;
}

// То, что сборка кладёт в `dist/`: по этому списку и проверяются ссылки.
const DIST = [PAGE_FILE, MANIFEST_FILE, "icon.svg", "icon-maskable.svg", "sw.js", FONT_FILE];

const page = (body) =>
  '<link rel="icon" href="data:image/svg+xml,%3Csvg%3E%3C/svg%3E" />' +
  '<link rel="manifest" href="' + MANIFEST_FILE + '" />' +
  body;

const check = (body, files = DIST) => assertLocalLinks(page(body), files);

test("ссылка на свой файл рядом в dist/ проходит", () => {
  assert.doesNotThrow(() => check('<a href="#marks">к меткам</a>'));
  assert.doesNotThrow(() => check('<style>@font-face{src:url("' + FONT_FILE + '")}</style>'));
  assert.doesNotThrow(() => check('<style>@font-face{src:url(./' + FONT_FILE + ')}</style>'));
  assert.doesNotThrow(() => check('<img src="icon.svg" />'));
  assert.doesNotThrow(() => check("<a href='" + PAGE_FILE + "'>сюда же</a>"));
});

test("ссылка на файл, которого в dist/ нет, роняет сборку", () => {
  // Опечатка в имени шрифта — самая дорогая из ошибок этого рода: страница
  // откроется, а знаки будут не те, и заметить это можно только глазами.
  assert.throws(
    () => check('<style>@font-face{src:url("assets/gost-type-b.ttf")}</style>'),
    /gost-type-b\.ttf/,
  );
  assert.throws(() => check('<img src="logo.png" />'), /logo\.png/);
  // И в атрибуте, и в стилях — проверка одна на оба места.
  assert.throws(() => check('<style>body{background:url(plan.png)}</style>'), /plan\.png/);
});

test("чужой хост роняет сборку", () => {
  assert.throws(() => check('<script src="https://cdn.example.org/pdf.js"></script>'), /внешн/i);
  assert.throws(() => check('<img src="http://example.org/logo.png" />'), /внешн/i);
  assert.throws(() => check('<img src="//example.org/logo.png" />'), /внешн/i);
  assert.throws(() => check('<style>@font-face{src:url(https://fonts.example/a.ttf)}</style>'), /внешн/i);
  assert.throws(() => check("<style>@font-face{src:url('//fonts.example/a.ttf')}</style>"), /внешн/i);
});

test("абсолютный путь роняет сборку: на Pages приложение живёт в подпапке", () => {
  assert.throws(() => check('<img src="/icon.svg" />'), /подпапк/);
  assert.throws(
    () => assertLocalLinks('<link rel="manifest" href="/manifest.webmanifest" />', DIST),
    /подпапк/,
  );
});

test("ссылка выше папки страницы роняет сборку", () => {
  assert.throws(() => check('<img src="../icon.svg" />'), /выше папки/);
});

test("пропавшая ссылка на манифест — тоже поломка", () => {
  assert.throws(
    () => assertLocalLinks('<link rel="icon" href="data:image/svg+xml,%3Csvg%3E%3C/svg%3E" />', DIST),
    /установк/i,
  );
});

test("в самой разметке ссылка на манифест стоит и она относительная", () => {
  // Разметка до сборки — не готовая страница (в ней ещё живут `styles.css` и
  // `app.js`, которые сборка вклеивает внутрь), поэтому здесь проверяется
  // только сама ссылка: пропади она — установка отвалится молча.
  const links = [...template.matchAll(/<link[^>]+rel="manifest"[^>]*>/gi)];
  assert.equal(links.length, 1, "ссылка на манифест должна быть ровно одна");
  assert.match(links[0][0], new RegExp('href="' + MANIFEST_FILE + '"'));
});

test("шрифт подключён через @font-face относительной ссылкой на свой файл", () => {
  const face = styles.match(/@font-face\s*{[^}]*}/);
  assert.ok(face, "в стилях нет ни одного @font-face");
  assert.match(face[0], new RegExp("font-family:\\s*\"" + FONT_FAMILY + "\""));
  assert.match(face[0], new RegExp('url\\("' + FONT_FILE + '"\\)'));
  // Запасной шрифт обязателен: файл не дошёл — страница осталась читаемой.
  assert.match(styles, new RegExp("--font-gost:\\s*\"" + FONT_FAMILY + "\",\\s*[^;]+;"));
});

// Имя семейства не должно совпадать с именем шрифта, который проектировщик
// ставит себе в систему ради CAD. Совпади оно — страница без своего файла рядом
// (ADR 006 такую копию допускает) молча взяла бы системный **исходный** шрифт,
// где `×` рисуется буквой «Ч»: подписи вышли бы похожими и неверными. Живой
// прогон на машине с установленным `GOST type A` это показал.
test("имя семейства — своё, а не как у шрифта в системе пользователя", () => {
  assert.notEqual(FONT_FAMILY, "GOST type A", "имя семейства совпало с системным — подмена молчаливая");
  assert.match(FONT_FAMILY, /^GOST type A /, "имя должно оставаться узнаваемым");
  // Короткого имени нет нигде: ни в @font-face, ни в переменной.
  const shortName = /"GOST type A"/.test(styles);
  assert.equal(shortName, false, "в стилях осталось короткое имя семейства");
});

// Заказчик про чертёжный шрифт сказал «давай попробуем» — значит, отказ обязан
// стоить одну правку. Выключатель один: строка `--font-gost` в `styles.css`.
// Эти три проверки держат его единственным.
test("интерфейс и печатный лист берут шрифт из переменной, а не свой", () => {
  // Правил `body` в стилях несколько (габариты отдельно, вид отдельно) —
  // шрифт обязан стоять хотя бы в одном: дальше его разносит `font: inherit`.
  const bodyRules = [...styles.matchAll(/(^|[\s,}])body\s*{[^}]*}/g)].map(([rule]) => rule);
  assert.ok(bodyRules.length > 0, "в стилях нет правила body");
  assert.ok(
    bodyRules.some((rule) => /font:\s*[^;]*var\(--font-gost\)/.test(rule)),
    "body обязан наследовать --font-gost, иначе интерфейс живёт своим шрифтом",
  );
  const print = readFileSync(join(ROOT, "src", "print.css"), "utf8");
  assert.match(print, /font:\s*[^;]*var\(--font-gost\)/, "печатный лист обязан брать --font-gost");
});

test("своего списка семейств в коде нет — холст спрашивает ту же переменную", () => {
  // Холст не наследует ничего: `ctx.font` — строка, и семейство в неё кто-то
  // вписывает. Пропиши его на месте — и выключателей станет два: отказ от
  // шрифта оставил бы подписи на плане чертёжными.
  const files = sourceTree(join(ROOT, "src"));
  assert.ok(files.length > 20, "сканер исходников ничего не нашёл — проверка впустую");
  const guilty = [];
  for (const name of files) {
    const source = readFileSync(name, "utf8");
    for (const line of source.split("\n")) {
      if (!/sans-serif/.test(line)) continue;
      // Два места, где список семейств написан целиком и это правильно:
      // сама переменная и запасной список для Node, где переменной нет.
      if (/--font-gost:/.test(line)) continue;
      if (/DRAW_FONT_FALLBACK\s*=/.test(line)) continue;
      guilty.push(name.slice(ROOT.length + 1) + ": " + line.trim());
    }
  }
  assert.deepEqual(guilty, []);
});

test("запасной список в коде и в переменной кончаются одинаково", () => {
  // Если файл не дошёл, холст и разметка обязаны уйти в один и тот же шрифт:
  // иначе подписи на плане и подписи в панели разъедутся на глазах.
  const render = readFileSync(join(ROOT, "src", "render.js"), "utf8");
  const fallback = render.match(/const DRAW_FONT_FALLBACK = '([^']+)'/);
  assert.ok(fallback, "в render.js нет запасного списка семейств");
  const variable = styles.match(new RegExp("--font-gost:\\s*\"" + FONT_FAMILY + "\",\\s*([^;]+);"));
  assert.ok(variable, "в стилях нет --font-gost");
  const tail = (value) => value.replace(/["']/g, "").replace(/\s+/g, " ").trim();
  assert.equal(tail(fallback[1]).endsWith("sans-serif"), true);
  assert.equal(tail(variable[1]).endsWith("sans-serif"), true);
});

test("каждая ссылка стилей ведёт в свои ресурсы", async () => {
  // Та же проверка, что в сборке, но на исходнике: имя файла видно в diff, а не
  // только в собранной странице.
  const names = new Set((await listAssets()).map((asset) => asset.name));
  const links = [...styles.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/gi)].map(([, value]) => value);
  assert.ok(links.length > 0, "в стилях нет ни одной ссылки — шрифт потерялся?");
  for (const link of links) {
    assert.ok(names.has(link.replace(/^\.\//, "")), "в src/assets/ нет файла " + link);
  }
});

test("шрифт лежит ресурсом, имя латиницей без пробелов", async () => {
  const assets = await listAssets();
  const font = assets.find((asset) => asset.name === FONT_FILE);
  assert.ok(font, "шрифта нет в src/assets/: " + assets.map((a) => a.name).join(", "));
  assert.match(font.name, /^assets\/[a-z0-9.\-/]+$/, "имя ресурса — латиница без пробелов");
});

// Исходный файл заказчика браузер отвергал молча: Chrome прогоняет шрифт через
// санитайзер (OTS), и тот ронял его на несогласованных полях бинарного поиска —
// «OTS parsing error: bad table directory searchRange», «cmap: unexpected range
// shift». В консоли при этом только «Failed to decode downloaded font», а
// страница рисует запасным шрифтом как ни в чём не бывало. Поля производные,
// считаются из числа таблиц и числа отрезков cmap, поэтому их проверяет тест:
// заменят шрифт на другой с тем же изъяном — прогон покраснеет, а не приёмка.
test("шрифт проходит проверку браузера: поля бинарного поиска согласованы", () => {
  const font = readFileSync(join(ROOT, "src", FONT_FILE));
  assert.equal(font.readUInt32BE(0), 0x00010000, "это должен быть TrueType (sfnt 1.0)");
  const tables = font.readUInt16BE(4);
  const selector = Math.floor(Math.log2(tables));
  assert.equal(font.readUInt16BE(6), 16 * 2 ** selector, "каталог таблиц: searchRange");
  assert.equal(font.readUInt16BE(8), selector, "каталог таблиц: entrySelector");
  assert.equal(font.readUInt16BE(10), tables * 16 - 16 * 2 ** selector, "каталог таблиц: rangeShift");

  let cmap = 0;
  for (let i = 0; i < tables; i += 1) {
    const entry = 12 + 16 * i;
    if (font.toString("latin1", entry, entry + 4) === "cmap") cmap = font.readUInt32BE(entry + 8);
  }
  assert.ok(cmap > 0, "в шрифте нет таблицы cmap — браузеру нечем сопоставить знаки");
  const subtables = font.readUInt16BE(cmap + 2);
  const offsets = new Set();
  for (let i = 0; i < subtables; i += 1) offsets.add(font.readUInt32BE(cmap + 4 + 8 * i + 4));
  let checked = 0;
  for (const offset of offsets) {
    const base = cmap + offset;
    if (font.readUInt16BE(base) !== 4) continue;
    const segments = font.readUInt16BE(base + 6);
    const segSelector = Math.floor(Math.log2(segments / 2));
    assert.equal(font.readUInt16BE(base + 8), 2 * 2 ** segSelector, "cmap: searchRange");
    assert.equal(font.readUInt16BE(base + 10), segSelector, "cmap: entrySelector");
    assert.equal(font.readUInt16BE(base + 12), segments - 2 * 2 ** segSelector, "cmap: rangeShift");
    checked += 1;
  }
  assert.ok(checked > 0, "в cmap нет подтаблицы формата 4 — именно её разбирает браузер");
});

test("служебный скрипт держит страницу и шрифт в офлайн-кэше", async () => {
  const worker = await workerScript("<html>страница</html>", [FONT_FILE]);
  assert.match(worker, new RegExp('"\\./' + FONT_FILE.replace(/[.]/g, "\\$&") + '"'));
  assert.match(worker, /const CACHE = "scheme-markup-[0-9a-f]{12}"/);
  // Незаполненная подстановка — это служебный скрипт, который упадёт в браузере
  // на первой же строке и тихо лишит приложение офлайна.
  assert.doesNotMatch(worker, /__[A-Z_]+__/);
  // Отпечаток страницы: другая сборка — другое имя кэша, старое сносится.
  const other = await workerScript("<html>другая</html>", [FONT_FILE]);
  assert.notEqual(worker, other);
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
