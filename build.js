// Сборка страницы: src/*.js + styles.css + index.html -> dist/index.html, а рядом
// её собственные файлы. Модули склеиваются в порядке зависимостей, строки
// import/export срезаются.
//
// Правило «результат сборки — единственный самодостаточный файл» снято
// заказчиком (ADR 006): шрифт и будущую библиотеку PDF встраивать в страницу
// незачем. Осталось то, что это правило защищало, и проверяется это здесь:
// страница ссылается **только на свои файлы рядом в `dist/`**, каждый такой
// файл сборка действительно положила, чужих хостов нет ни одного.
//
// `dist/` целиком — то, что выкладывает Pages и что нужно скопировать, чтобы
// открыть страницу с диска.
import { createHash } from "node:crypto";
import { readdir, readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { strings } from "./src/strings.js";

const root = path.dirname(fileURLToPath(import.meta.url));
const srcDir = path.join(root, "src");
// Ресурсы страницы: файлы, которые она тянет сама. Сборщик бандла сюда не
// смотрит — он берёт из `src/` только `.js` и `.css`.
const assetsDir = path.join(srcDir, "assets");
const webDir = path.join(root, "web");
const distDir = path.join(root, "dist");

// Имя страницы в `dist/`: на неё тоже можно сослаться, и это не ошибка.
export const PAGE_FILE = "index.html";
// Манифест установки: единственный файл, ссылка на который обязательна.
export const MANIFEST_FILE = "manifest.webmanifest";
// Значок приложения: тот же рисунок, что во вкладке, — он не рисуется заново,
// а достаётся из `<link rel="icon">` и кладётся файлом. Одна картинка на все
// размеры: SVG тянется без потерь, и разъехаться двум рисункам негде.
const ICON_FILE = "icon.svg";
// Тот же рисунок с полями — под маску Android (круг, капля, скруглённый
// квадрат). Обрез гарантированно не задевает только центральные 80%, а у
// значка вкладки рамка плана идёт почти от края.
const ICON_MASKABLE_FILE = "icon-maskable.svg";
const WORKER_FILE = "sw.js";
// Точка входа склеивается последней: к моменту её выполнения определены все модули.
const entryFile = path.join(srcDir, "app.js");

async function listFiles(dir, extension) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await listFiles(full, extension)));
    else if (entry.name.endsWith(extension)) files.push(full);
  }
  return files.sort();
}

// Ресурсы кладутся в `dist/assets/` под теми же именами: имя файла — часть
// ссылки в стилях, и переименовывать его по дороге нельзя.
export async function listAssets() {
  let files = [];
  try {
    files = await listFiles(assetsDir, "");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    return [];
  }
  return files
    // Служебный мусор файловой системы (`.DS_Store`) ресурсом не считается.
    .filter((file) => !path.basename(file).startsWith("."))
    .map((file) => ({
      name: path.relative(srcDir, file).split(path.sep).join("/"),
      file,
    }));
}

const IMPORT_RE = /^\s*import\s[\s\S]*?from\s*["']([^"']+)["'];?\s*$/gm;
const BARE_IMPORT_RE = /^\s*import\s*["'][^"']+["'];?\s*$/gm;
const EXPORT_LIST_RE = /^\s*export\s*\{[^}]*\}\s*;?\s*$/gm;

function dependenciesOf(source, file) {
  const deps = [];
  for (const match of source.matchAll(IMPORT_RE)) {
    const target = match[1];
    if (!target.startsWith(".")) {
      throw new Error("Внешняя зависимость запрещена: " + target + " в " + path.relative(root, file));
    }
    deps.push(path.resolve(path.dirname(file), target));
  }
  return deps;
}

function stripModuleSyntax(source, file) {
  if (/^\s*export\s+default\b/m.test(source)) {
    throw new Error("export default запрещён: " + path.relative(root, file));
  }
  return source
    .replace(IMPORT_RE, "")
    .replace(BARE_IMPORT_RE, "")
    .replace(EXPORT_LIST_RE, "")
    .replace(/^\s*export\s+(?=(const|let|var|function|async function|class)\b)/gm, "")
    .trim();
}

const TOP_LEVEL_DECL_RE =
  /^(?:export\s+)?(?:async\s+)?(?:function\s*\*?|class|const|let|var)\s+([A-Za-z_$][\w$]*)/gm;

const REGEX_ALLOWED_BEFORE = /[(,=:[!&|?{};+\-*%^~<>]$|\b(?:return|typeof|instanceof|case|in|of|new|delete|void|do|else|yield|await)$/;

// Строки, шаблоны, регулярные выражения и комментарии заменяются пробелами
// (переводы строк сохраняются): иначе `const` внутри шаблонной разметки или
// закомментированный `function` считались бы объявлением и роняли сборку.
function blankLiterals(source) {
  let out = "";
  let state = "code";
  let quote = "";
  let inClass = false;
  let braceDepth = 0;
  const templateFrames = [];
  let i = 0;
  while (i < source.length) {
    const ch = source[i];
    const next = source[i + 1];
    if (state === "code") {
      if (ch === "/" && next === "/") { state = "line"; out += "  "; i += 2; continue; }
      if (ch === "/" && next === "*") { state = "block"; out += "  "; i += 2; continue; }
      if (ch === '"' || ch === "'") { state = "string"; quote = ch; out += " "; i += 1; continue; }
      if (ch === "`") { state = "template"; out += " "; i += 1; continue; }
      if (ch === "/" && REGEX_ALLOWED_BEFORE.test(out.trimEnd())) {
        state = "regex"; inClass = false; out += " "; i += 1; continue;
      }
      if (ch === "{") braceDepth += 1;
      else if (ch === "}") {
        if (templateFrames.length > 0 && braceDepth === templateFrames[templateFrames.length - 1]) {
          templateFrames.pop();
          state = "template";
          out += " ";
          i += 1;
          continue;
        }
        braceDepth -= 1;
      }
      out += ch;
      i += 1;
      continue;
    }

    if (ch === "\n") {
      out += "\n";
      i += 1;
      if (state === "line") state = "code";
      continue;
    }
    if (state === "line") { out += " "; i += 1; continue; }
    if (state === "block") {
      if (ch === "*" && next === "/") { state = "code"; out += "  "; i += 2; continue; }
      out += " "; i += 1; continue;
    }
    if (ch === "\\") { out += "  "; i += 2; continue; }
    if (state === "string" && ch === quote) { state = "code"; out += " "; i += 1; continue; }
    if (state === "template") {
      if (ch === "$" && next === "{") {
        templateFrames.push(braceDepth);
        state = "code";
        out += "  ";
        i += 2;
        continue;
      }
      if (ch === "`") { state = "code"; out += " "; i += 1; continue; }
    }
    if (state === "regex") {
      if (ch === "[") inClass = true;
      else if (ch === "]") inClass = false;
      else if (ch === "/" && !inClass) { state = "code"; out += " "; i += 1; continue; }
    }
    out += " ";
    i += 1;
  }
  return out;
}

// Бандл — одна область видимости: одноимённые объявления в разных модулях
// стали бы SyntaxError в браузере, поэтому ловим их здесь.
function assertUniqueTopLevelNames(sources) {
  const owners = new Map();
  for (const [file, entry] of sources) {
    for (const match of blankLiterals(entry.source).matchAll(TOP_LEVEL_DECL_RE)) {
      const name = match[1];
      const owner = owners.get(name);
      if (owner && owner !== file) {
        throw new Error(
          "Имя верхнего уровня " + name + " объявлено дважды: " +
            path.relative(root, owner) + " и " + path.relative(root, file),
        );
      }
      owners.set(name, file);
    }
  }
}

function orderModules(sources) {
  const ordered = [];
  const done = new Set();
  const walking = new Set();
  const visit = (file) => {
    if (done.has(file)) return;
    if (walking.has(file)) throw new Error("Циклический импорт: " + path.relative(root, file));
    walking.add(file);
    for (const dep of sources.get(file).deps) {
      if (!sources.has(dep)) throw new Error("Нет модуля " + path.relative(root, dep));
      visit(dep);
    }
    walking.delete(file);
    done.add(file);
    ordered.push(file);
  };
  // Обход в глубину даёт единственную гарантию, которая тут и нужна: зависимость
  // склеивается раньше зависящего, а цикл ловится множеством walking. Точка входа
  // обходится последней, но «последняя в бандле» она лишь пока её никто не
  // импортирует: панель, взявшая registerPanel из app.js, встанет после него.
  // Поэтому каркас и не стартует на месте — startApp отложен в app.js.
  const rest = [...sources.keys()].filter((file) => file !== entryFile).sort();
  for (const file of rest) visit(file);
  if (sources.has(entryFile)) visit(entryFile);
  return ordered;
}

// Управляющий символ, доживший до страницы (например, живой U+0000 внутри
// регулярки), браузер при разборе HTML заменяет на U+FFFD — и весь бандл падает
// с SyntaxError ещё до старта. В Node тот же файл разбирается молча, поэтому
// проверка стоит здесь, на выходе сборки.
function assertPlainText(html) {
  const found = html.match(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/);
  if (!found) return;
  const at = html.indexOf(found[0]);
  const line = html.slice(0, at).split("\n").length;
  const code = found[0].codePointAt(0).toString(16).toUpperCase().padStart(4, "0");
  throw new Error(
    "Управляющий символ U+" + code + " в собранной странице, строка " + line +
      ": в браузере он ломает разбор. Пиши его экранированием (\\x00-\\x1f), а не байтом.",
  );
}

// Код и стили вклеиваются в саму страницу — это снятое правило «один файл» не
// затронуло (ADR 006). Отдельным файлом рядом лежат ресурсы (шрифт), а не
// бандл: `<script src>` в результате почти всегда значит, что подстановка в
// `build()` не сработала и страница вышла пустой.
function assertOffline(html, files) {
  const forbidden = [
    /<script[^>]+src=/i,
    /<link[^>]+rel=["']?stylesheet/i,
    /@import\s/i,
  ];
  for (const pattern of forbidden) {
    const found = html.match(pattern);
    if (found) throw new Error("Код или стили не попали внутрь страницы: " + found[0]);
  }
  assertLocalLinks(html, files);
}

// Все адреса страницы: и атрибуты разметки, и `url()` стилей. Шрифт в
// `@font-face` живёт именно в `url()` — не смотреть туда значило бы не
// проверять самое новое место, откуда страница тянет файл.
//
// Страница — это ещё и весь склеенный код, поэтому имя не должно продолжать
// чужое слово: без оговорки `(?<![-\w.$])` проверка спотыкалась на
// `URL.createObjectURL(data.blob)` в `exporter.js` и считала выгрузку PNG
// ссылкой на соседний файл.
function pageLinks(html) {
  const links = [];
  for (const [, double, single] of html.matchAll(/(?<![-\w.$])(?:src|href)\s*=\s*(?:"([^"]*)"|'([^']*)')/gi)) {
    links.push(double ?? single ?? "");
  }
  // Адрес в `url()` бывает в кавычках любого вида и вовсе без них.
  for (const [, double, single, bare] of html.matchAll(
    /(?<![-\w.$])url\(\s*(?:"([^"]*)"|'([^']*)'|([^"')]*))\s*\)/gi,
  )) {
    links.push(double ?? single ?? bare ?? "");
  }
  return links;
}

// Правило «один файл» снято (ADR 006), но слабее проверка не стала — она просто
// проверяет другое. Разрешено ровно одно: относительная ссылка на файл, который
// сборка **положила рядом в `dist/`**. Всё остальное — ошибка сборки:
//
//  - чужой хост (`https://`, `//cdn…`) — страница перестала бы работать офлайн;
//  - абсолютный путь (`/sw.js`) — на Pages приложение живёт в подпапке, и такой
//    путь уводит в корень чужого сайта;
//  - выход из папки (`../`) — за пределами `dist/` ничего не выкладывается;
//  - **имя, которого в `dist/` нет** — опечатка иначе превратилась бы в молча
//    неработающий шрифт: страница открылась, а знаки не те.
//
// `files` — список всего, что сборка пишет в `dist/`; его знает только `build()`,
// поэтому он приходит аргументом, а не собирается здесь заново.
export function assertLocalLinks(html, files) {
  const own = new Set(files);
  for (const raw of pageLinks(html)) {
    const target = raw.trim();
    // Пустой адрес, рисунок в самом адресе и якорь внутри страницы никуда не ведут.
    if (target === "" || target.startsWith("#") || target.startsWith("data:")) continue;
    if (/^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith("//")) {
      throw new Error(
        "В собранной странице внешняя ссылка: " + target +
          ". Рядом в dist/ могут лежать только свои файлы, чужих хостов нет ни одного.",
      );
    }
    if (target.startsWith("/")) {
      throw new Error(
        "Абсолютный путь в собранной странице: " + target +
          ". На GitHub Pages приложение живёт в подпапке — ссылка должна быть относительной.",
      );
    }
    const name = target.replace(/[?#].*$/, "").replace(/^\.\//, "");
    if (name.split("/").includes("..")) {
      throw new Error(
        "Ссылка уводит выше папки страницы: " + target + ". Pages выкладывает dist/ и ничего кроме.",
      );
    }
    if (!own.has(name)) {
      throw new Error(
        "Ссылка на файл, которого в dist/ нет: " + name + " (опечатка в имени?). " +
          "Сборка положила рядом: " + [...own].join(", "),
      );
    }
  }
  if (!html.includes('href="' + MANIFEST_FILE + '"')) {
    throw new Error("Пропала ссылка на " + MANIFEST_FILE + ": с сайта страницу перестанут предлагать к установке");
  }
}

// Значок приложения достаётся из самой страницы: рисунок вкладки и рисунок на
// домашнем экране — один и тот же файл, и разойтись им негде.
export function iconSvgFrom(html) {
  const found = html.match(/<link[^>]+rel="icon"[^>]+href="data:image\/svg\+xml,([^"]+)"/i);
  if (!found) throw new Error("В странице нет значка `data:image/svg+xml` — из чего делать значок приложения?");
  return decodeURIComponent(found[1]);
}

// Тот же значок, отодвинутый от краёв: не новый рисунок, а старый на подложке.
// Доля 0,6 выбрана с запасом от 0,8 — обрез маской не заденет ни рамку плана,
// ни метку на нём.
export function maskableSvgFrom(svg) {
  const inner = svg.replace(/^<svg[^>]*>/, "").replace(/<\/svg>\s*$/, "");
  return (
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">' +
    '<rect width="32" height="32" fill="#0d1117"/>' +
    '<g transform="translate(6.4 6.4) scale(0.6)">' +
    inner +
    "</g></svg>"
  );
}

// Манифест установки. Имя и описание — из общего словаря: под значком на
// домашнем экране это такая же видимая строка, как заголовок окна.
//
// `start_url` и `scope` относительные: на GitHub Pages приложение живёт в
// подпапке, и «/» указывал бы в корень чужого сайта. Ориентация не задана
// нарочно — работают и стоймя, и лёжа.
export function manifestJson() {
  return JSON.stringify(
    {
      name: strings.app.title,
      short_name: strings.app.installShortName,
      description: strings.app.installDescription,
      lang: "ru",
      start_url: ".",
      scope: ".",
      // `id` не задан нарочно: он считается от происхождения сайта, а не от
      // папки манифеста, и «.» указал бы в корень — на GitHub Pages туда же,
      // куда и соседний проект. Без него браузер берёт за опознание сам
      // `start_url`, то есть папку приложения.
      display: "standalone",
      background_color: "#0d1117",
      theme_color: "#0d1117",
      icons: [
        // Один рисунок на все размеры: `any` означает «тянется куда угодно».
        { src: ICON_FILE, sizes: "any", type: "image/svg+xml", purpose: "any" },
        // Под маску Android — тот же рисунок, но с полями.
        { src: ICON_MASKABLE_FILE, sizes: "any", type: "image/svg+xml", purpose: "maskable" },
      ],
    },
    null,
    2,
  );
}

// Служебный скрипт лежит отдельным файлом (в `src/` его держать нельзя — туда
// смотрит сборщик бандла). Версия кэша — отпечаток собранной страницы: новая
// сборка даёт новое имя кэша, старое сносится при активации.
//
// Список ресурсов подставляется сюда же: без шрифта в офлайн-кэше установленное
// приложение на объекте без сети осталось бы с запасным шрифтом. Знает, что
// положено рядом, только сборка — значит и список составляет она.
export async function workerScript(html, assets) {
  const source = await readFile(path.join(webDir, WORKER_FILE), "utf8");
  const version = createHash("sha256").update(html).digest("hex").slice(0, 12);
  const result = source
    .replaceAll("__CACHE_VERSION__", version)
    .replaceAll("__ASSETS__", JSON.stringify(assets.map((name) => "./" + name)));
  const left = result.match(/__[A-Z_]+__/);
  if (left) throw new Error("В служебном скрипте осталась незаполненная подстановка " + left[0]);
  return result;
}

export async function build() {
  const jsFiles = await listFiles(srcDir, ".js");
  const sources = new Map();
  for (const file of jsFiles) {
    const source = await readFile(file, "utf8");
    sources.set(file, { source, deps: dependenciesOf(source, file) });
  }

  assertUniqueTopLevelNames(sources);

  const script = orderModules(sources)
    .map((file) => "// " + path.relative(root, file) + "\n" + stripModuleSyntax(sources.get(file).source, file))
    .join("\n\n");

  const cssFiles = await listFiles(srcDir, ".css");
  const css = (await Promise.all(cssFiles.map((file) => readFile(file, "utf8")))).join("\n");

  const template = await readFile(path.join(srcDir, "index.html"), "utf8");
  const html = template
    .replace(/[ \t]*<link[^>]+rel="stylesheet"[^>]*>\s*/i, "    <style>\n" + css + "\n    </style>\n")
    .replace(
      /[ \t]*<script[^>]+src="app\.js"[^>]*><\/script>\s*/i,
      "    <script>\n(function () {\n" + script + "\n})();\n    </script>\n",
    );

  // Ресурсы страницы (шрифт) и файлы веб-версии. Проверка ссылок идёт по этому
  // же списку: страница вправе сослаться только на то, что сборка положила.
  const assets = await listAssets();
  const assetNames = assets.map((asset) => asset.name);
  const extras = [
    [MANIFEST_FILE, manifestJson() + "\n"],
    [ICON_FILE, iconSvgFrom(html) + "\n"],
    [ICON_MASKABLE_FILE, maskableSvgFrom(iconSvgFrom(html)) + "\n"],
    [WORKER_FILE, await workerScript(html, assetNames)],
  ];

  assertPlainText(html);
  assertOffline(html, [PAGE_FILE, ...extras.map(([name]) => name), ...assetNames]);

  await mkdir(distDir, { recursive: true });
  const out = path.join(distDir, PAGE_FILE);
  await writeFile(out, html, "utf8");
  for (const [name, content] of extras) await writeFile(path.join(distDir, name), content, "utf8");
  for (const asset of assets) {
    const target = path.join(distDir, asset.name);
    await mkdir(path.dirname(target), { recursive: true });
    // Побайтово: шрифт — двоичный файл, через utf8 он бы не выжил.
    await writeFile(target, await readFile(asset.file));
  }

  return {
    file: out,
    bytes: Buffer.byteLength(html, "utf8"),
    modules: jsFiles.length,
    extras: extras.map(([name]) => name),
    assets: assetNames,
  };
}

const runDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (runDirectly) {
  const result = await build();
  console.log(
    "dist/index.html: " + (result.bytes / 1024).toFixed(1) + " КБ, модулей: " + result.modules,
  );
  if (result.assets.length > 0) console.log("ресурсы страницы: " + result.assets.join(", "));
  console.log("рядом для веб-версии: " + result.extras.join(", "));
}
