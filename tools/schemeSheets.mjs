// Браузерный мост: картинки объекта, нарисованные самой сборкой.
//
// ——— зачем мост вообще нужен ——————————————————————————————————————————————
//
// Данные из объекта читаются в Node (`schemeData.mjs`). А вот PNG схемы, лист
// по ГОСТ, развёртки листами и кадр объёма **рисуются**: `exporter.js`,
// `render.js` и `volume.js` кладут их в `canvas` чертёжным шрифтом. Ни холста,
// ни шрифта в Node нет, а рисовать второй раз своим кодом нельзя — лист из
// инструмента обязан выйти тем же, каким его отдаёт кнопка «Скачать».
//
// Поэтому мост поднимает **свой** сервер и **свой** Chrome, открывает в нём
// страницу-оснастку (`schemeSheets.html`), а та грузит по HTTP копию объекта и
// зовёт те же функции сборки. Готовые PNG уезжают обратно на сервер POST'ом.
//
// ——— правила общего браузера (AGENTS.md) ——————————————————————————————————
//
// В репозитории работает несколько агентов сразу, и общий браузер уже трижды
// стоил работы: у chrome-devtools MCP «выбранная страница» одна на всех, и
// `navigate_page` уходит в чужую вкладку. Поэтому здесь:
//
//   * свой экземпляр Chrome с **отдельным профилем** (папка во временных) и
//     своим портом отладки — ничья вкладка не трогается;
//   * свой порт сервера, по умолчанию 8235 (номер таска), и **охрана по
//     адресу** в самой странице-оснастке: она ничего не делает, пока её адрес
//     не совпал с тем, который ей сказал мост;
//   * страница по CDP **не перезагружается** — её и не нужно перезагружать:
//     мост не правит открытую вкладку, а открывает новую и закрывает за собой
//     весь Chrome;
//   * `dist/index.html` не открывается вовсе, IndexedDB не трогается. Объект
//     заказчика (G68) только читается — страница получает его копию по HTTP.
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, extname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { drawingBoundsMm, findScheme } from "../src/model.js";
import { VOLUME_AROUND_PITCH_DEG, volumeAroundEye } from "../src/volume.js";
import { pickRooms, pickSchemes } from "./schemeData.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");

/** Порты по номеру таска: сосед со своим мостом не столкнётся. */
export const SHEETS_PORT = 8235;
export const SHEETS_CHROME_PORT = 9235;

// Сколько ждать страницу. Лист ГОСТ объекта в шесть сотен меток рисуется
// секунды, но развёртки всех помещений этажа — это десятки листов.
const SHEETS_TIMEOUT_MS = 300000;

const CHROMES = [
  process.env.CHROME,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
];

const MIME = {
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".ttf": "font/ttf",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};

/** Где взять Chrome. Нет ни одного — это отказ со словами, а не молчание. */
export function chromePath() {
  for (const path of CHROMES) {
    if (path && existsSync(path)) return path;
  }
  throw new Error("не найден Chrome; укажите его путь в переменной CHROME");
}

/** Градусы в радианы: `volumeBasis` считает в радианах. */
const rad = (deg) => (Number(deg) || 0) * (Math.PI / 180);

/** `14:30` — минуты от полуночи. Умолчание — час дня: светло и тени видно. */
function minutesOf(value) {
  if (!value || value === true) return 13 * 60;
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(value).trim());
  if (!match) throw new Error("час пишется как 14:30, а не «" + value + "»");
  return Number(match[1]) * 60 + Number(match[2]);
}

/** `1600x1000` — размер кадра в точках. */
function sizeOf(value, fallback) {
  if (!value || value === true) return fallback;
  const match = /^(\d{2,5})[x×](\d{2,5})$/.exec(String(value).trim());
  if (!match) throw new Error("размер пишется как 1600x1000, а не «" + value + "»");
  return { width: Number(match[1]), height: Number(match[2]) };
}

/**
 * Камера объёма. `--camera x,y,z,yaw,pitch` — миллиметры чертежа и градусы;
 * без него камера встаёт **обзором** на середину чертежа тем же счётом, каким
 * её ставит окно объёма (`volumeAroundEye`), — своей геометрии камеры здесь нет.
 */
function cameraOf(project, schemeId, value) {
  if (typeof value === "string" && value.includes(",")) {
    const parts = value.split(",").map((item) => Number(item.trim()));
    if (parts.length !== 5 || parts.some((item) => !Number.isFinite(item))) {
      throw new Error("камера пишется как x,y,z,yaw,pitch");
    }
    return { at: { x: parts[0], y: parts[1], z: parts[2] }, yaw: rad(parts[3]), pitch: rad(parts[4]) };
  }
  const bounds = drawingBoundsMm(project, schemeId);
  const target = {
    x: (bounds.minX + bounds.maxX) / 2,
    y: (bounds.minY + bounds.maxY) / 2,
    z: 1200,
  };
  // Смотрим вверх по листу (yaw −90°) и сверху вниз тем же наклоном, что у
  // обзора. Расстояние — чтобы чертёж занял кадр: поле зрения 90° меряется по
  // длинной стороне, то есть с расстояния `d` в кадр входит примерно `2d`.
  const yaw = rad(-90);
  const pitch = rad(VOLUME_AROUND_PITCH_DEG);
  const reach = Math.max(bounds.widthMm, bounds.heightMm, 6000) * 0.8 + 2500;
  return { at: volumeAroundEye(target, yaw, pitch, reach), yaw, pitch };
}

/** Что именно рисовать: задание для страницы-оснастки. */
export function jobOf(command, project, keys) {
  const schemes = pickSchemes(project, keys.get("scheme"));
  const room = keys.get("room") ? pickRooms(project, keys.get("room"))[0] : null;
  const common = {
    schemeIds: schemes.map((scheme) => scheme.id),
    scale: Number(keys.get("scale")) > 0 ? Number(keys.get("scale")) : 2,
    mono: keys.has("mono"),
    plan: !keys.has("no-plan"),
    legend: !keys.has("no-legend"),
    roomId: room ? room.id : null,
    // «Снять крышу» — та же отметка окна параметров объёма (таск 212): сверху
    // в дом без неё не заглянуть.
    roofOff: keys.has("no-roof"),
    format: typeof keys.get("sheet") === "string" ? keys.get("sheet") : null,
    orientation: typeof keys.get("orientation") === "string" ? keys.get("orientation") : null,
  };
  if (command === "plan-png") return { kind: "plan", ...common };
  if (command === "gost-png") return { kind: "gost", ...common };
  if (command === "elevation-png") {
    return { kind: "elevation", ...common, wall: typeof keys.get("wall") === "string" ? keys.get("wall") : null };
  }
  if (command === "volume-png") {
    const schemeId = common.schemeIds[0];
    return {
      kind: "volume",
      ...common,
      schemeIds: [schemeId],
      camera: cameraOf(project, schemeId, keys.get("camera")),
      size: sizeOf(keys.get("size"), { width: 1600, height: 1000 }),
      minutes: minutesOf(keys.get("time")),
      date: typeof keys.get("date") === "string" ? keys.get("date") : "",
      backdrop: typeof keys.get("backdrop") === "string" ? keys.get("backdrop") : null,
      scheme: (findScheme(project, schemeId) || {}).name || "",
    };
  }
  throw new Error("мост не знает команды: " + command);
}

/** Отдать файл сборки. За пределы `scheme_image/src` не выходим никогда. */
function sendSource(response, urlPath) {
  const path = resolve(ROOT, "." + urlPath);
  if (!path.startsWith(join(ROOT, "src")) || !existsSync(path)) {
    response.writeHead(404).end("нет такого файла");
    return;
  }
  response.writeHead(200, { "content-type": MIME[extname(path)] || "application/octet-stream" });
  response.end(readFileSync(path));
}

/**
 * Имя, которое ещё не занято в этом прогоне.
 *
 * Имя файла собирает страница (`exporter.exportFileName`) — одна дверь на всю
 * сборку, и своего имени у инструмента нет. Но она режет имя по шестидесятому
 * знаку, и у схемы с длинным именем два разных листа приходят **одинаковыми**
 * именами: без этой проверки второй молча затёр бы первый.
 */
function freeName(outDir, name, saved) {
  const taken = new Set(saved.map((item) => item.path));
  const dot = name.lastIndexOf(".");
  const base = dot > 0 ? name.slice(0, dot) : name;
  const tail = dot > 0 ? name.slice(dot) : "";
  let path = join(outDir, name);
  let index = 1;
  while (taken.has(path)) {
    index += 1;
    path = join(outDir, base + "-" + index + tail);
  }
  return path;
}

function readBody(request) {
  return new Promise((resolve_, reject) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => resolve_(Buffer.concat(chunks)));
    request.on("error", reject);
  });
}

/**
 * Нарисовать и сохранить. Отдаёт список сохранённых файлов.
 *
 * Мост закрывает за собой всё, что поднял: Chrome убивается, сервер
 * закрывается, профиль удаляется — и при ошибке тоже.
 */
export async function renderSheets(command, opened, keys, say = () => {}) {
  const { project, file } = opened;
  const job = jobOf(command, project, keys);
  const port = Number(keys.get("port")) > 0 ? Number(keys.get("port")) : SHEETS_PORT;
  const chromePort = Number(keys.get("chrome-port")) > 0 ? Number(keys.get("chrome-port")) : SHEETS_CHROME_PORT;
  const outDir = typeof keys.get("out") === "string" ? keys.get("out") : ".";
  mkdirSync(outDir, { recursive: true });

  const objectBytes = readFileSync(file);
  const page = readFileSync(join(HERE, "schemeSheets.html"));
  const saved = [];
  let finish = null;
  const done = new Promise((resolve_, reject) => {
    finish = { resolve: resolve_, reject };
  });

  const server = createServer(async (request, response) => {
    const url = new URL(request.url, "http://127.0.0.1:" + port);
    try {
      if (url.pathname === "/" || url.pathname === "/index.html") {
        response.writeHead(200, { "content-type": MIME[".html"] });
        response.end(page);
        return;
      }
      if (url.pathname === "/job.json") {
        response.writeHead(200, { "content-type": MIME[".json"] });
        response.end(JSON.stringify(job));
        return;
      }
      if (url.pathname === "/object.zip") {
        response.writeHead(200, { "content-type": "application/zip" });
        response.end(objectBytes);
        return;
      }
      if (url.pathname.startsWith("/src/")) {
        sendSource(response, url.pathname);
        return;
      }
      if (request.method === "POST" && url.pathname === "/out") {
        const name = url.searchParams.get("name") || "лист.png";
        const bytes = await readBody(request);
        const path = freeName(outDir, name, saved);
        writeFileSync(path, bytes);
        saved.push({ path, bytes: bytes.length });
        say("лист: " + path + " (" + bytes.length + " байт)");
        response.writeHead(200).end("ок");
        return;
      }
      if (request.method === "POST" && url.pathname === "/say") {
        say("страница: " + (await readBody(request)).toString("utf8"));
        response.writeHead(200).end("ок");
        return;
      }
      if (request.method === "POST" && url.pathname === "/done") {
        response.writeHead(200).end("ок");
        finish.resolve();
        return;
      }
      if (request.method === "POST" && url.pathname === "/fail") {
        const text = (await readBody(request)).toString("utf8");
        response.writeHead(200).end("ок");
        finish.reject(new Error("страница-оснастка: " + text));
        return;
      }
      response.writeHead(404).end("нет такого пути");
    } catch (error) {
      response.writeHead(500).end(String(error && error.message ? error.message : error));
      finish.reject(error);
    }
  });

  await new Promise((resolve_) => server.listen(port, "127.0.0.1", resolve_));
  const home = "http://127.0.0.1:" + port;
  const profile = mkdtempSync(join(tmpdir(), "scheme-tools-t235-"));
  const args = [
    "--user-data-dir=" + profile,
    "--remote-debugging-port=" + chromePort,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-extensions",
    "--disable-background-networking",
    "--disable-component-update",
    "--hide-crash-restore-bubble",
    "--window-size=1600,1000",
  ];
  if (!keys.has("window")) args.push("--headless=new", "--disable-gpu");
  // Охрана по адресу: страница сверяет свой адрес с тем, что ей сказано здесь,
  // и ничего не делает, если адрес чужой.
  args.push(home + "/?home=" + encodeURIComponent(home));

  say("мост: сервер на " + home + ", Chrome с профилем " + profile + " и портом отладки " + chromePort);
  const chrome = spawn(chromePath(), args, { stdio: "ignore" });
  const timer = setTimeout(() => finish.reject(new Error("страница не ответила за " + SHEETS_TIMEOUT_MS / 1000 + " с")), SHEETS_TIMEOUT_MS);

  try {
    await done;
  } finally {
    clearTimeout(timer);
    chrome.kill("SIGTERM");
    await new Promise((resolve_) => setTimeout(resolve_, 300));
    if (chrome.exitCode === null) chrome.kill("SIGKILL");
    await new Promise((resolve_) => server.close(resolve_));
    rmSync(profile, { recursive: true, force: true });
    say("мост: закрыто — Chrome, сервер и профиль");
  }
  return saved;
}
