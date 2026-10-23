// Второй бандл сборки — поток имитации умного дома (таск 07 сценариев;
// `interfaces.md`, шов 7 «Сборка»; ловушки строки воркера — `notes.md` §9 п.8).
//
// Бандл движка (движок, блочные сценарии, хозяин скриптов) едет в страницу
// строкой `SIM_WORKER_SOURCE`, и страница поднимает из неё Worker через Blob.
// Проверяется: текст бандла исполняется сам по себе — в Node с заглушкой
// `postMessage` и в настоящем потоке `worker_threads`; в бандл не попал ни
// один модуль страницы; строка в странице — тот же бандл байт в байт и не
// ломает ни `<script>`, ни проверку ссылок.
import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { Worker } from "node:worker_threads";

import { assertLocalLinks, assertWorkerPure, buildPage, simWorkerLiteral, workerBundle } from "../build.js";
import { clockMsStamp, volumeClockFixed } from "../src/clockMath.js";
import { addScenario } from "../src/model.js";
import { buildHomeSpec } from "../src/sim/home.js";
import { SIM_WORKER_SOURCE } from "../src/sim/workerSource.js";
import { simHouse } from "./fixtures/simHome.js";

const T0 = Date.UTC(2026, 9, 23, 12, 0, 0);

function fixedAt(simMs) {
  const { day, minutes } = clockMsStamp(simMs);
  return volumeClockFixed(minutes, 60, day);
}

// Дом с блочным сценарием: отвязанная клавиша В2 одиночным нажатием включает С3.
function pressHouse() {
  const box = simHouse();
  const id = (label) => box.marks[label];
  box.project = addScenario(box.project, {
    kind: "block",
    name: "Клавиша → свет",
    targets: [
      {
        type: "if",
        id: "if1",
        if: {
          type: "group",
          id: "g1",
          mode: "OR",
          conditions: [{ type: "device", id: "c1", ref: { markId: id("В2"), service: 0, char: "ProgrammableSwitchEvent" }, op: "eq", value: "SINGLE_PRESS", trigger: true }],
        },
        then: [{ type: "device", id: "a1", ref: { markId: id("С3"), service: 0 }, items: [{ char: "On", verb: "set", value: true }] }],
        else: null,
        every: null,
      },
    ],
  }).project;
  return box;
}

// Текст бандла на заглушке `self`, как его исполнил бы поток.
function runText(source) {
  const sent = [];
  let listener = null;
  const self = {
    postMessage: (message) => sent.push(structuredClone(message)),
    addEventListener: (type, fn) => {
      if (type === "message") listener = fn;
    },
  };
  new Function("self", source)(self);
  return { sent, send: (message) => listener({ data: structuredClone(message) }) };
}

test("в исходнике строка бандла пустая — её подставляет сборка", () => {
  assert.equal(SIM_WORKER_SOURCE, "");
});

test("текст бандла исполняется в Node с заглушкой postMessage и отвечает на load/start/act/ping", async () => {
  const { source } = await workerBundle();
  assert.match(source, /simWorkerMain\(self\);\n\}\)\(\);\n$/, "в конце бандла нет вызова входа");
  const box = pressHouse();
  const worker = runText(source);
  worker.send({ type: "ping", n: 1 });
  assert.deepEqual(worker.sent.at(-1), { type: "pong", n: 1 });
  worker.send({ type: "clock", clock: fixedAt(T0) });
  worker.send({ type: "load", spec: { ...buildHomeSpec(box.project), site: null, rooms: [] } });
  assert.ok(worker.sent.some((message) => message.type === "scenarios"));
  worker.send({ type: "start", values: {} });
  const log = () => worker.sent.filter((message) => message.type === "log").flatMap((message) => message.entries);
  assert.ok(log().some((entry) => entry.code === "started"));
  worker.send({ type: "act", action: { kind: "press", markId: box.marks["В2"], service: 0, press: "single" } });
  const lit = worker.sent
    .filter((message) => message.type === "changes" && message.live)
    .flatMap((message) => message.list)
    .find((change) => change.markId === box.marks["С3"] && change.char === "On");
  assert.equal(lit && lit.value, true, "сценарий в бандле не включил свет");
  worker.send({ type: "ping", n: 2 });
  assert.deepEqual(worker.sent.at(-1), { type: "pong", n: 2 });
});

// Что у потока сценариев отнято до первого сообщения (ревью ветки, F1):
// код сценария исполняется в нём уже при открытии объекта.
const SEALED = ["fetch", "XMLHttpRequest", "WebSocket", "EventSource", "importScripts", "indexedDB", "caches", "BroadcastChannel"];

test("поток до первого сообщения без сети и хранилищ: побег из сценария через constructor видит там undefined", async () => {
  const { source } = await workerBundle();
  const sent = [];
  let listener = null;
  // Глобальный объект потока, как у настоящего Worker: `self === globalThis`,
  // и сеть с хранилищами на нём есть.
  const sandbox = {
    postMessage: (message) => sent.push(structuredClone(message)),
    addEventListener: (type, fn) => {
      if (type === "message") listener = fn;
    },
    setTimeout,
    clearTimeout,
    console,
    performance,
  };
  for (const name of SEALED) {
    sandbox[name] = function reached() {
      throw new Error(name + " достали из сценария");
    };
  }
  const context = vm.createContext(sandbox);
  vm.runInContext("var self = globalThis;\n" + source, context);
  const look = (expression) => vm.runInContext(expression, context);
  assert.equal(
    look(JSON.stringify(SEALED) + ".map((name) => name + ':' + typeof globalThis[name]).join(',')"),
    SEALED.map((name) => name + ":undefined").join(","),
    "до первого сообщения в потоке осталась сеть или хранилище",
  );
  assert.equal(listener !== null, true, "поток не слушает сообщений");

  // Глобальный сценарий исполняет свой верхний уровень уже на `load` — при
  // открытии объекта — и пробует достать глобальный объект потока.
  const box = simHouse();
  const escape =
    'var g = ({}).constructor.constructor("return this")();\n' +
    "g.escapeSeen = " + JSON.stringify(SEALED) + ".map(function (name) { return name + ':' + typeof g[name]; }).join(',');\n";
  box.project = addScenario(box.project, { kind: "global", name: "Побег", source: escape }).project;
  listener({ data: { type: "clock", clock: fixedAt(T0) } });
  listener({ data: { type: "load", spec: { ...buildHomeSpec(box.project), site: null, rooms: [] } } });
  listener({ data: { type: "start", values: {} } });
  assert.equal(look("globalThis.escapeSeen"), SEALED.map((name) => name + ":undefined").join(","), "побег из сценария увидел сеть или хранилище");
  // Поток при этом работает: на ping — pong.
  listener({ data: { type: "ping", n: 7 } });
  assert.deepEqual(sent.at(-1), { type: "pong", n: 7 });
});

test("бандл исполняется в настоящем потоке: щелчок по клавише → свет через поток", { timeout: 20000 }, async () => {
  const { source } = await workerBundle();
  const shim =
    "const { parentPort } = require('node:worker_threads');\n" +
    "const self = { postMessage: (m) => parentPort.postMessage(m), addEventListener: (t, fn) => { if (t === 'message') parentPort.on('message', (data) => fn({ data })); } };\n";
  const thread = new Worker(shim + source, { eval: true });
  const box = pressHouse();
  try {
    const lit = new Promise((resolve, reject) => {
      thread.on("error", reject);
      thread.on("message", (message) => {
        if (message.type !== "changes" || !message.live) return;
        const change = message.list.find((item) => item.markId === box.marks["С3"] && item.char === "On");
        if (change) resolve(change.value);
      });
    });
    thread.postMessage({ type: "clock", clock: fixedAt(T0) });
    thread.postMessage({ type: "load", spec: { ...buildHomeSpec(box.project), site: null, rooms: [] } });
    thread.postMessage({ type: "start", values: {} });
    thread.postMessage({ type: "act", action: { kind: "press", markId: box.marks["В2"], service: 0, press: "single" } });
    assert.equal(await lit, true);
  } finally {
    await thread.terminate();
  }
});

test("в бандле воркера только движок: ни каркаса, ни панелей, ни хранилища, ни модели", async () => {
  const { modules } = await workerBundle();
  assert.equal(modules.at(-1), "src/sim/worker.js");
  for (const name of ["src/sim/engine.js", "src/sim/blocks.js", "src/sim/hubApi.js"]) assert.ok(modules.includes(name), "нет " + name);
  for (const name of modules) {
    assert.ok(name.startsWith("src/sim/") || name === "src/strings.js" || name === "src/clockMath.js", "лишний модуль в потоке: " + name);
  }
  for (const name of ["src/app.js", "src/store.js", "src/model.js", "src/render.js", "src/simulation.js", "src/sim/bridge.js"]) {
    assert.equal(modules.includes(name), false, name + " в потоке");
  }
});

test("проверка сборки: модуль, который трогает страницу, в бандл воркера не пускается", () => {
  assert.throws(() => assertWorkerPure([{ name: "src/sim/x.js", source: "export const a = document.body;" }]), /DOM-модуль src\/sim\/x\.js \(document\)/);
  assert.throws(() => assertWorkerPure([{ name: "src/sim/y.js", source: "requestAnimationFrame(draw);" }]), /requestAnimationFrame/);
  assert.throws(() => assertWorkerPure([{ name: "src/panels/plain.js", source: "export const a = 1;" }]), /src\/panels\/plain\.js/);
  assert.throws(() => assertWorkerPure([{ name: "src/app.js", source: "" }]), /src\/app\.js/);
  // Ключ объекта, свойство и слово в строке или комментарии — не обращение к странице.
  assert.doesNotThrow(() =>
    assertWorkerPure([
      { name: "src/strings.js", source: 'export const s = { window: "Окно", note: "document" };\n// window.open\nconst a = b.window;' },
    ]),
  );
});

test("страница несёт бандл в SIM_WORKER_SOURCE — та же строка байт в байт", async () => {
  const [{ html, worker }, bundle] = await Promise.all([buildPage(), workerBundle()]);
  assert.equal(worker.source, bundle.source);
  const found = html.match(/const SIM_WORKER_SOURCE = ("(?:[^"\\]|\\.)*");/);
  assert.ok(found, "в странице нет строки бандла");
  assert.equal(JSON.parse(found[1]), bundle.source);
  assert.ok(found[1].length > 100000, "строка бандла подозрительно короткая");
  // Внутри строки нет ничего, что закрыло бы `<script>` страницы.
  assert.equal(/<\/script/i.test(found[1]), false);
  assert.equal((html.match(/<\/script>/gi) || []).length, (html.match(/<script>/gi) || []).length);
});

test("строка бандла: </script, src=, href=, url( и разделители строк экранированы, а строка та же", () => {
  const nasty =
    'a</script><script>alert(1)</script>\n' +
    'img.src = "x.png"; a.href=\'y.html\'; css = "url(z.png)"; new URL("q");\n' +
    "\u2028\u2029\u0000 $& $1 `${x}`";
  const literal = simWorkerLiteral(nasty);
  assert.equal(JSON.parse(literal), nasty);
  assert.equal(new Function("return " + literal)(), nasty);
  assert.equal(/<\/script/i.test(literal), false);
  assert.equal(/[\u0000-\u001f\u2028\u2029]/.test(literal), false);
  // Проверка ссылок страницы ничего в строке не находит.
  const page = '<link rel="icon" href="data:image/svg+xml,%3Csvg%3E%3C/svg%3E" /><link rel="manifest" href="manifest.webmanifest" />';
  assert.doesNotThrow(() => assertLocalLinks(page + "<script>const s = " + literal + ";</script>", ["index.html", "manifest.webmanifest"]));
});
