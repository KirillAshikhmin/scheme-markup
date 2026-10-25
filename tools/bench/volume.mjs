#!/usr/bin/env node
// Стенд «Объёма»: сколько стоит кадр (npm run bench).
//
// Новый эффект в кадре меряют прежде, чем принять (§6.4 карты архитектуры).
// Стенд жил во временной папке сессии и пропал бы вместе с ней — здесь он
// постоянный и меряет одно и то же на одних и тех же сценах (`scenes.mjs`):
//
//   scene  — сборка сцены (`volumeScene`), мс, медиана;
//   light  — пересборка физического света с тенями (`volumeLiveLight`), мс;
//   frame  — JS-часть кадра (`volumeFrame`) по обходу камер, мс на кадр;
//   polys  — многоугольников в кадре, в среднем.
//
// С ключом `--browser` — ещё и заливка: свой сервер и свой Chrome с отдельным
// профилем (правила общего браузера — `AGENTS.md`, «Живой прогон»), страница
// `fill.html` рисует те же кадры `volumeDraw` на холсте 844 × 390 с плотностью
// 1 и 2 и меряет время до готовых пикселей (`getImageData`).
//
//   node tools/bench/volume.mjs [--scene flat|hall] [--rounds N] [--browser] [--json]
//
// Числа зависят от машины: сравнивать прогон с прогоном на той же машине,
// до правки и после, а не с числами из карты.
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { volumeFrame, volumeLiveLight, volumeMood, volumeScene } from "../../src/volume.js";
import { chromePath } from "../schemeSheets.mjs";
import { BENCH_SCENES, benchCameras, benchLive } from "./scenes.mjs";

const ROOT = resolve(fileURLToPath(new URL("../..", import.meta.url)));
/** Порты стенда: свои, чтобы не встретиться ни с мостом `scheme.mjs`, ни с чужим Chrome. */
export const BENCH_PORT = 8471;
export const BENCH_CHROME_PORT = 9471;
const BENCH_BOX = Object.freeze({ width: 844, height: 390 });

function argsOf(argv) {
  const out = { scenes: Object.keys(BENCH_SCENES), rounds: 5, browser: false, json: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--scene") out.scenes = [argv[(i += 1)]];
    else if (arg === "--rounds") out.rounds = Math.max(1, Number(argv[(i += 1)]) || 5);
    else if (arg === "--browser") out.browser = true;
    else if (arg === "--json") out.json = true;
    else if (arg === "--help" || arg === "-h") out.help = true;
    else throw new Error("Неизвестный ключ " + arg + " — см. --help");
  }
  for (const name of out.scenes) if (!BENCH_SCENES[name]) throw new Error("Нет сцены " + name + ": " + Object.keys(BENCH_SCENES).join(", "));
  return out;
}

const median = (list) => {
  const sorted = [...list].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
};

function timed(fn) {
  const at = performance.now();
  const value = fn();
  return { value, ms: performance.now() - at };
}

/** Замер счёта одной сцены в Node: `{scene, light, frame, polys, faces, lamps}`. */
export function benchCompute(name, rounds = 5) {
  const box = BENCH_SCENES[name]();
  const opts = { roofOff: true, openDoorIds: new Set(box.doors) };
  const builds = [];
  let scene = null;
  for (let r = 0; r < rounds; r += 1) {
    const run = timed(() => volumeScene(box.project, box.schemeId, opts));
    builds.push(run.ms);
    scene = run.value;
  }
  const live = benchLive(box);
  const tint = volumeMood({ minutes: 22 * 60 + 30 }).tint;
  const lights = [];
  let light = null;
  for (let r = 0; r < rounds; r += 1) {
    // Свет помнит построенное по набору ламп (`volumeLampBuilt`): свежая сцена
    // на каждый круг — иначе мерилась бы память, а не пересборка.
    const fresh = r === 0 ? scene : volumeScene(box.project, box.schemeId, opts);
    const run = timed(() => volumeLiveLight(fresh, live, { physical: true, tint }));
    lights.push(run.ms);
    if (r === 0) light = run.value;
  }
  const cams = benchCameras(box);
  for (const cam of cams) volumeFrame(scene, cam, BENCH_BOX, null, tint, light);
  const frames = [];
  let polys = 0;
  for (let r = 0; r < rounds; r += 1) {
    const run = timed(() => {
      let count = 0;
      for (const cam of cams) count += volumeFrame(scene, cam, BENCH_BOX, null, tint, light).length;
      return count;
    });
    frames.push(run.ms / cams.length);
    polys += run.value;
  }
  return {
    scene: median(builds),
    light: median(lights),
    frame: median(frames),
    polys: Math.round(polys / (rounds * cams.length)),
    faces: scene.faces.length,
    lamps: box.lamps.length,
  };
}

// ——— заливка в Chrome ————————————————————————————————————————————————————

const BENCH_TYPES = { ".js": "text/javascript", ".mjs": "text/javascript", ".html": "text/html; charset=utf-8", ".json": "application/json" };

function serve(port, scenes) {
  const payload = JSON.stringify(
    Object.fromEntries(
      scenes.map((name) => {
        const box = BENCH_SCENES[name]();
        return [name, { project: box.project, schemeId: box.schemeId, lamps: box.lamps, doors: box.doors, cameras: benchCameras(box) }];
      }),
    ),
  );
  return new Promise((done) => {
    const server = createServer((request, response) => {
      const url = decodeURIComponent((request.url || "/").split("?")[0]);
      if (url === "/scenes.json") {
        response.writeHead(200, { "content-type": BENCH_TYPES[".json"], "cache-control": "no-store" });
        response.end(payload);
        return;
      }
      if (url === "/result" && request.method === "POST") {
        let body = "";
        request.on("data", (chunk) => (body += chunk));
        request.on("end", () => {
          server.result = JSON.parse(body);
          response.writeHead(204);
          response.end();
        });
        return;
      }
      // Только свои файлы: страница стенда и исходники сборки.
      const path = url === "/" ? "/tools/bench/fill.html" : url;
      if (!path.startsWith("/src/") && path !== "/tools/bench/fill.html") {
        response.writeHead(404);
        response.end();
        return;
      }
      try {
        const data = readFileSync(join(ROOT, path));
        response.writeHead(200, { "content-type": BENCH_TYPES[extname(path)] || "application/octet-stream", "cache-control": "no-store" });
        response.end(data);
      } catch {
        response.writeHead(404);
        response.end();
      }
    });
    server.listen(port, "127.0.0.1", () => done(server));
  });
}

async function browserFill(scenes, rounds) {
  const server = await serve(BENCH_PORT, scenes);
  const profile = mkdtempSync(join(tmpdir(), "scheme-bench-"));
  const chrome = spawn(
    chromePath(),
    [
      "--headless=new",
      "--no-first-run",
      "--no-default-browser-check",
      "--user-data-dir=" + profile,
      "--remote-debugging-port=" + BENCH_CHROME_PORT,
      `http://127.0.0.1:${BENCH_PORT}/?rounds=${rounds}`,
    ],
    { stdio: "ignore" },
  );
  try {
    for (let i = 0; i < 1200 && !server.result; i += 1) await new Promise((r) => setTimeout(r, 250));
    if (!server.result) throw new Error("Страница стенда не ответила за 5 минут");
    if (server.result.error) throw new Error("Страница стенда: " + server.result.error);
    return server.result;
  } finally {
    // Профиль убирается, когда Chrome вышел: живой ещё пишет в него.
    const gone = new Promise((done) => chrome.once("exit", done));
    chrome.kill();
    await Promise.race([gone, new Promise((done) => setTimeout(done, 5000))]);
    server.close();
    rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
}

// ——— вывод ———————————————————————————————————————————————————————————————

const fixed = (value, digits = 1) => (Number.isFinite(value) ? value.toFixed(digits).replace(".", ",") : "—");

function report(results, fill) {
  const lines = ["сцена   граней  ламп   сцена, мс  свет, мс  кадр JS, мс  многоугольников" + (fill ? "  заливка ×1, мс  заливка ×2, мс" : "")];
  for (const [name, item] of Object.entries(results)) {
    const own = fill ? fill[name] : null;
    lines.push(
      [
        name.padEnd(7),
        String(item.faces).padStart(6),
        String(item.lamps).padStart(5),
        fixed(item.scene).padStart(10),
        fixed(item.light).padStart(9),
        fixed(item.frame, 2).padStart(12),
        String(item.polys).padStart(16),
        ...(own ? [fixed(own.fill1, 2).padStart(15), fixed(own.fill2, 2).padStart(15)] : []),
      ].join(" "),
    );
  }
  return lines.join("\n");
}

const runDirectly = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (runDirectly) {
  const args = argsOf(process.argv.slice(2));
  if (args.help) {
    console.log(readFileSync(fileURLToPath(import.meta.url), "utf8").split("\n").slice(1, 23).map((line) => line.replace(/^\/\/ ?/, "")).join("\n"));
  } else {
    const results = Object.fromEntries(args.scenes.map((name) => [name, benchCompute(name, args.rounds)]));
    const fill = args.browser ? await browserFill(args.scenes, args.rounds) : null;
    if (args.json) console.log(JSON.stringify({ compute: results, fill }, null, 2));
    else console.log(report(results, fill));
  }
}
