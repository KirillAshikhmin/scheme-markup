// Сборка одного статического файла: src/*.js + styles.css + index.html -> dist/index.html.
// Модули склеиваются в порядке зависимостей, строки import/export срезаются,
// внешних ссылок в результате быть не должно.
import { readdir, readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const srcDir = path.join(root, "src");
const distDir = path.join(root, "dist");
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

function assertOffline(html) {
  const forbidden = [
    /<script[^>]+src=/i,
    /<link[^>]+rel=["']?stylesheet/i,
    /@import\s/i,
    /url\(\s*["']?https?:/i,
    /(?:src|href)=["']\s*(?:https?:)?\/\//i,
  ];
  for (const pattern of forbidden) {
    const found = html.match(pattern);
    if (found) throw new Error("В собранной странице осталась внешняя ссылка: " + found[0]);
  }
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

  assertPlainText(html);
  assertOffline(html);
  await mkdir(distDir, { recursive: true });
  const out = path.join(distDir, "index.html");
  await writeFile(out, html, "utf8");
  return { file: out, bytes: Buffer.byteLength(html, "utf8"), modules: jsFiles.length };
}

const runDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (runDirectly) {
  const result = await build();
  console.log(
    "dist/index.html: " + (result.bytes / 1024).toFixed(1) + " КБ, модулей: " + result.modules,
  );
}
