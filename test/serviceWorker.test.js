// Поведение служебного скрипта веб-версии (`web/sw.js`), а не его текст.
//
// Раньше о нём говорил только `buildWeb.test.js` — и говорил про подстановки:
// имя кэша на месте, список ресурсов на месте. Этого оказалось мало: в живом
// прогоне (D46) переход по адресу внутри области видимости скрипта вис навсегда,
// а офлайн-копия приложения подменялась телом соседней страницы. Текст скрипта
// при этом был безупречен.
//
// Поэтому здесь скрипт **запускается**. Браузера в Node нет, и подменены ровно
// три вещи: `self` (слушатели события), `caches` (кэш в памяти) и `fetch`
// (ответ сети задаёт сам тест). Кэш нарочно придирчив, как браузерный: `put`
// отвергает всё, кроме честной «двухсотки», — значит мусор в кэше превращается
// в упавшее обещание `respondWith` и красит тест.
import test from "node:test";
import assert from "node:assert/strict";

import { workerScript } from "../build.js";

const ORIGIN = "http://example.org/app/";
const PAGE_HTML = "<html>схема</html>";
const FONT = "assets/gost-type-a.ttf";
const FONT_URL = ORIGIN + FONT;

// Браузерный `cache.put` принимает далеко не всё, и тест обязан быть таким же
// строгим: иначе «в кэш попало лишнее» прошло бы молча, а в браузере обернулось
// отклонённым обещанием и упавшим переходом.
function assertPuttable(response) {
  if (response.type === "opaque" || response.type === "opaqueredirect") {
    throw new TypeError("Request failed: непрозрачный ответ в cache.put");
  }
  if (response.status === 206) throw new TypeError("Partial response is unsupported");
  if (!response.ok) throw new TypeError("Response status must be ok, получено " + response.status);
}

class FakeCache {
  constructor(hold, fetchStub) {
    this.entries = new Map();
    this.puts = [];
    this.hold = hold;
    this.fetch = fetchStub;
  }

  key(request) {
    return typeof request === "string" ? new URL(request, ORIGIN).href : request.url;
  }

  async put(request, response) {
    const key = this.key(request);
    this.puts.push(key);
    assertPuttable(response);
    const body = await response.text();
    // Обещание, которое не исполняется никогда: так ведёт себя `cache.put` в
    // браузере, когда тело ответа некому читать. Переход от этого висеть не должен.
    if (this.hold) return new Promise(() => {});
    this.entries.set(key, { status: response.status, body });
    return undefined;
  }

  // `cache.add` в браузере сам ходит в сеть и сам отвергает негодный ответ:
  // отказ по одному файлу остаётся отказом по одному файлу.
  async add(request) {
    const response = await this.fetch(request);
    assertPuttable(response);
    return this.put(request, response);
  }

  async keys() {
    return [...this.entries.keys()].map((url) => ({ url }));
  }

  async match(request, options = {}) {
    const wanted = this.key(request);
    for (const [url, entry] of this.entries) {
      if (url === wanted) return new Response(entry.body, { status: entry.status });
      if (options.ignoreSearch && url.split("?")[0] === wanted.split("?")[0]) {
        return new Response(entry.body, { status: entry.status });
      }
    }
    return undefined;
  }
}

function createEnv({ hold = false, respond } = {}) {
  const stores = new Map();
  const deleted = [];
  const asked = [];
  const env = {
    stores,
    deleted,
    asked,
    claimed: false,
    skipped: false,
    listeners: new Map(),
  };

  const fetchStub = async (request) => {
    const url = typeof request === "string" ? request : request.url;
    asked.push(url);
    return respond(url, request);
  };

  const caches = {
    async open(name) {
      if (!stores.has(name)) stores.set(name, new FakeCache(hold, fetchStub));
      return stores.get(name);
    },
    async keys() {
      return [...stores.keys()];
    },
    async delete(name) {
      deleted.push(name);
      return stores.delete(name);
    },
    async match(request, options) {
      for (const cache of stores.values()) {
        const found = await cache.match(request, options);
        if (found) return found;
      }
      return undefined;
    },
  };

  const self = {
    location: { href: ORIGIN + "sw.js" },
    addEventListener(type, fn) {
      env.listeners.set(type, fn);
    },
    skipWaiting() {
      env.skipped = true;
    },
    clients: {
      async claim() {
        env.claimed = true;
      },
    },
  };

  env.caches = caches;
  env.self = self;
  env.fetch = fetchStub;
  return env;
}

// В браузере относительный адрес считается от места скрипта, в Node `Request`
// требует полный. Шов один — подстановка в песочницу.
class LocalRequest {
  constructor(input, init = {}) {
    this.url = typeof input === "string" ? new URL(input, ORIGIN).href : input.url;
    this.method = (init.method || "GET").toUpperCase();
    this.mode = init.mode || "no-cors";
    this.cache = init.cache || "default";
  }
}

async function startWorker(options = {}) {
  const source = await workerScript(PAGE_HTML, [FONT]);
  const env = createEnv(options);
  // eslint-disable-next-line no-new-func
  const run = new Function("self", "caches", "fetch", "Request", source);
  run(env.self, env.caches, env.fetch, LocalRequest);
  env.cacheName = source.match(/const CACHE = "([^"]+)"/)[1];
  return env;
}

// Кэша может не быть вовсе: негодный ответ его даже не открывает.
function putsOf(env) {
  const cache = env.stores.get(env.cacheName);
  return cache ? cache.puts : [];
}

// Событие `fetch` так и приходит в браузере: запрос, куда отдать ответ и куда
// отдать работу, которую нельзя терять.
function sendFetch(env, request) {
  let answer;
  const waits = [];
  const event = {
    request,
    respondWith(promise) {
      answer = promise;
    },
    waitUntil(promise) {
      waits.push(promise);
    },
  };
  env.listeners.get("fetch")(event);
  return { answer, waits };
}

function navigation(url) {
  return { url, method: "GET", mode: "navigate" };
}

function assetRequest(url) {
  return { url, method: "GET", mode: "no-cors" };
}

const pageResponse = () => new Response(PAGE_HTML, { status: 200, headers: { "content-type": "text/html" } });

test("переход по странице: ответ отдан сразу, кэш догоняет сам", async () => {
  // `hold: true` — кэш, который не отвечает никогда. Ровно так он и ведёт себя в
  // браузере, когда тело ответа некому читать: ждать его — значит повесить
  // переход навсегда (D46).
  const env = await startWorker({ hold: true, respond: () => pageResponse() });
  const { answer, waits } = sendFetch(env, navigation(ORIGIN));
  // Срок нарочный. Без него возврат к `await cache.put` не покраснел бы, а
  // осыпал весь прогон: Node видит обещание, которое не исполнится никогда, и
  // бросает заодно все остальные тесты файла.
  const verdict = await Promise.race([
    answer,
    new Promise((resolve) => setTimeout(() => resolve("повис"), 1000)),
  ]);
  assert.notEqual(verdict, "повис", "ответ дождался записи в кэш — именно так переход и вис (D46)");
  assert.equal(verdict.status, 200);
  assert.equal(await verdict.text(), PAGE_HTML, "тело ответа дошло целиком, копия его не съела");
  assert.equal(waits.length, 1, "запись в кэш отдана в waitUntil, а не в путь ответа");
});

test("страница кладётся в кэш под своим ключом: и папка, и index.html, и адрес с параметрами", async () => {
  for (const url of [ORIGIN, ORIGIN + "index.html", ORIGIN + "?objekt=7", ORIGIN + "index.html?objekt=7#mark"]) {
    const env = await startWorker({ respond: () => pageResponse() });
    const { answer, waits } = sendFetch(env, navigation(url));
    assert.equal((await answer).status, 200);
    await Promise.all(waits);
    const cache = env.stores.get(env.cacheName);
    assert.deepEqual(cache.puts, [ORIGIN], "ключ страницы один на все её адреса: " + url);
    assert.equal((await cache.match(ORIGIN)).status, 200);
  }
});

test("соседняя чужая страница не ложится на место офлайн-копии", async () => {
  // Та самая история D46: рядом с приложением выложена другая страница. Её тело
  // под ключом приложения означало бы, что без сети открывается не схема.
  const env = await startWorker({ respond: () => new Response("<html>чужая</html>", { status: 200 }) });
  const { answer, waits } = sendFetch(env, navigation(ORIGIN + "second.html"));
  const response = await answer;
  assert.equal(await response.text(), "<html>чужая</html>", "браузеру она отдана как есть");
  await Promise.all(waits);
  assert.deepEqual(putsOf(env), [], "в кэш не пошло ничего");
});

test("ответ 304 не попадает в кэш и не роняет переход", async () => {
  // Ответ без тела: браузер отдаёт его, когда своя копия ещё годна. `cache.put`
  // такой ответ отвергает — и раньше вместе с ним отклонялось обещание перехода.
  const env = await startWorker({ respond: () => new Response(null, { status: 304 }) });
  const { answer, waits } = sendFetch(env, navigation(ORIGIN));
  const response = await answer;
  assert.equal(response.status, 304, "ответ сети отдан как пришёл");
  await Promise.all(waits);
  assert.deepEqual(putsOf(env), []);
});

test("непрозрачное перенаправление не попадает в кэш и не роняет переход", async () => {
  // Навигационный запрос ходит с `redirect: "manual"`, и перенаправление
  // приходит «непрозрачным»: ни тела, ни статуса. `cache.put` его не принимает.
  const opaque = {
    status: 0,
    ok: false,
    type: "opaqueredirect",
    clone() {
      throw new Error("клонировать непрозрачный ответ незачем — он не должен дойти до кэша");
    },
  };
  const env = await startWorker({ respond: () => opaque });
  const { answer, waits } = sendFetch(env, navigation(ORIGIN + "sub"));
  assert.equal(await answer, opaque);
  await Promise.all(waits);
  assert.deepEqual(putsOf(env), []);
});

test("ошибка сервера остаётся ошибкой сервера и не портит офлайн-копию", async () => {
  for (const status of [404, 500, 503]) {
    const env = await startWorker({ respond: () => new Response("ошибка", { status }) });
    const { answer, waits } = sendFetch(env, navigation(ORIGIN));
    assert.equal((await answer).status, status, "браузер показывает ответ сервера сам");
    await Promise.all(waits);
    assert.deepEqual(putsOf(env), [], "в кэш такое не кладётся: " + status);
  }
});

test("кусок файла (206) в кэш не кладётся, хотя он «ok»", async () => {
  const env = await startWorker({
    respond: () => new Response("кусок", { status: 206, headers: { "content-range": "bytes 0-4/41354" } }),
  });
  const { answer, waits } = sendFetch(env, assetRequest(FONT_URL));
  assert.equal((await answer).status, 206);
  await Promise.all(waits);
  assert.deepEqual(putsOf(env), []);
});

test("файл рядом со страницей кладётся под своим адресом", async () => {
  const env = await startWorker({ respond: () => new Response("шрифт", { status: 200 }) });
  const { answer, waits } = sendFetch(env, assetRequest(FONT_URL));
  assert.equal(await (await answer).text(), "шрифт");
  await Promise.all(waits);
  assert.deepEqual(putsOf(env), [FONT_URL]);
});

test("чужие запросы скрипт не трогает", async () => {
  const env = await startWorker({ respond: () => new Response("нет", { status: 200 }) });
  // Не GET — мимо.
  const post = sendFetch(env, { url: ORIGIN, method: "POST", mode: "navigate" });
  assert.equal(post.answer, undefined);
  // Не наш файл — мимо: картинки планов и выгрузки через сеть не ходят.
  const alien = sendFetch(env, assetRequest(ORIGIN + "plan.png"));
  assert.equal(alien.answer, undefined);
  assert.deepEqual(env.asked, [], "в сеть за ними скрипт не ходил");
});

test("без сети страница и файл берутся из кэша", async () => {
  const env = await startWorker({ respond: () => pageResponse() });
  // Сперва наполняем кэш живой сетью.
  const warm = sendFetch(env, navigation(ORIGIN));
  await warm.answer;
  await Promise.all(warm.waits);

  const offline = await startWorker({ respond: () => Promise.reject(new TypeError("Failed to fetch")) });
  offline.stores.set(env.cacheName, env.stores.get(env.cacheName));
  // Адрес с параметрами — та же страница: `ignoreSearch` для этого и нужен.
  const { answer } = sendFetch(offline, navigation(ORIGIN + "?objekt=7"));
  const response = await answer;
  assert.equal(await response.text(), PAGE_HTML, "без сети открывается приложение из кэша");
});

test("без сети и без кэша обещание отклоняется: дальше браузер показывает своё", async () => {
  const env = await startWorker({ respond: () => Promise.reject(new TypeError("Failed to fetch")) });
  const { answer } = sendFetch(env, navigation(ORIGIN));
  await assert.rejects(answer, /Failed to fetch/);
});

test("установка кладёт страницу и её файлы, и один недоставшийся файл не уносит офлайн", async () => {
  const env = await startWorker({
    respond: async (url) => (url.endsWith(FONT) ? new Response("нет", { status: 500 }) : pageResponse()),
  });
  const waits = [];
  env.listeners.get("install")({ waitUntil: (promise) => waits.push(promise) });
  await Promise.all(waits);
  assert.equal(env.skipped, true, "новая сборка не ждёт закрытия вкладок");
  const cache = env.stores.get(env.cacheName);
  const keys = (await cache.keys()).map((request) => request.url);
  assert.deepEqual(keys, [ORIGIN], "страница в кэше, а отказ по шрифту офлайн не унёс");
});

test("активация сносит чужие имена кэша и забирает открытые вкладки", async () => {
  const env = await startWorker({ respond: () => pageResponse() });
  await env.caches.open("scheme-markup-staroe");
  await env.caches.open(env.cacheName);
  await env.caches.open("chuzhoe-prilozhenie");
  const waits = [];
  env.listeners.get("activate")({ waitUntil: (promise) => waits.push(promise) });
  await Promise.all(waits);
  assert.deepEqual(env.deleted.sort(), ["chuzhoe-prilozhenie", "scheme-markup-staroe"]);
  assert.equal(env.stores.has(env.cacheName), true, "своё имя остаётся");
  assert.equal(env.claimed, true);
});

test("новая сборка — новое имя кэша, старое уйдёт при активации", async () => {
  const one = await workerScript("<html>первая</html>", [FONT]);
  const two = await workerScript("<html>вторая</html>", [FONT]);
  const name = (source) => source.match(/const CACHE = "([^"]+)"/)[1];
  assert.notEqual(name(one), name(two));
  assert.match(name(one), /^scheme-markup-[0-9a-f]{12}$/);
});
