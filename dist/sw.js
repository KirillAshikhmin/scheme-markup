// Служебный скрипт веб-версии. С диска страница работает и без него: там браузер
// служебных скриптов не даёт, а все файлы и так лежат рядом.
//
// Делает ровно одно — держит последнюю страницу и её файлы в кэше, чтобы
// установленное приложение открылось на объекте без сети. Данные пользователя
// сюда не попадают: они в IndexedDB, и к сети отношения не имеют.
//
// Главная опасность такого скрипта — залипший старый кэш: «я починил, а у него
// не появилось». Поэтому всё берётся **сначала из сети** и только при отказе —
// из кэша. С сетью человек всегда видит свежую сборку, даже если новый скрипт
// ещё не встал на место старого.
//
// Версия кэша — отпечаток собранной страницы: новая сборка даёт новое имя,
// старое имя сносится в `activate`. Отпечаток подставляет `build.js`.
const CACHE = "scheme-markup-0992722ba6db";
// Сама страница: код и стили лежат внутри неё.
const PAGE = "./";
// Файлы, которые страница тянет сама, — шрифт и прочие ресурсы рядом (ADR 006).
// Список подставляет `build.js`: что положено в `dist/`, знает только сборка.
// Без этого на объекте без сети подписи рисовались бы запасным шрифтом.
const ASSETS = ["./assets/gost-type-a.ttf"];
const ASSET_URLS = new Set(ASSETS.map((name) => new URL(name, self.location.href).href));
// Адреса самой страницы: папка приложения и файл в ней. Имя файла подставляет
// `build.js` — хозяин этого имени он, а не служебный скрипт.
//
// Зачем это нужно: область видимости скрипта — папка приложения, и в ней может
// лежать не только наша страница. Приложение выкладывают в подпапку сайта, а
// рядом с ней бывает что угодно. Переход по такому соседнему адресу — это
// **не** наша страница, и его тело под ключ страницы класть нельзя: офлайн
// открывалось бы оно, а не схема (D46).
const PAGE_URLS = new Set(
  [PAGE, "./index.html"].map((name) => new URL(name, self.location.href).href),
);

function isPageUrl(url) {
  const bare = new URL(url);
  bare.search = "";
  bare.hash = "";
  return PAGE_URLS.has(bare.href);
}

self.addEventListener("install", (event) => {
  // Ждать закрытия всех вкладок незачем: страница и её файлы обновляются
  // вместе, рассогласоваться им нечем.
  self.skipWaiting();
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      // Каждый файл отдельно и со своим `catch`: один недоставшийся ресурс не
      // должен оставить приложение вообще без офлайна.
      for (const target of [PAGE, ...ASSETS]) {
        await cache.add(new Request(target, { cache: "reload" })).catch(() => {});
      }
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      for (const name of await caches.keys()) {
        if (name !== CACHE) await caches.delete(name);
      }
      // Берём под управление уже открытые вкладки: иначе первая после
      // обновления осталась бы на старом скрипте до перезапуска.
      await self.clients.claim();
    })(),
  );
});

// Что годится в офлайн-копию. Испортить её может не только отказ сети: `404` и
// `500` легли бы на место страницы так же молча, как чужое тело, а `304` и
// «непрозрачный» ответ (`opaque`, `opaqueredirect` — перенаправление при
// `redirect: "manual"`, каким и приходит навигационный запрос) тела не несут
// вовсе, и `cache.put` их отвергает. Отдельно `206`: `ok` у неё истинный, но
// это кусок файла, и `cache.put` его тоже не принимает.
function cacheable(response) {
  if (!response || !response.ok || response.status !== 200) return false;
  return response.type !== "opaque" && response.type !== "opaqueredirect";
}

// Запись в кэш не задерживает ответ — и это не ускорение, а условие работы (D46).
// `clone()` разводит одно тело на две ветки, и пока ответ не отдан, вторую ветку
// никто не читает: её буфер упирается в потолок, `cache.put` ждёт места под
// остаток тела — а ответа, который освободил бы буфер, ждёт он сам. Страница в
// три мегабайта так не доезжает **никогда**: переход висит, а следом встают и
// все остальные обращения к этому кэшу. Поэтому ответ уходит сразу, кэш
// догоняет в `waitUntil`, и его отказ остаётся его отказом: не обновилась
// офлайн-копия — это не причина ронять переход.
function storeLater(event, key, response) {
  if (!key || !cacheable(response)) return;
  const copy = response.clone();
  const write = caches
    .open(CACHE)
    .then((cache) => cache.put(key, copy))
    .catch(() => {});
  if (event && typeof event.waitUntil === "function") event.waitUntil(write);
}

// Сеть первой, кэш — страховка. Под каким ключом **искать** — `key`; под каким
// **класть** — `storeKey`, и он бывает пустым: тело соседней чужой страницы в
// офлайн-копию приложения не кладётся, а отдать приложение из кэша, когда сети
// нет, можно по любому адресу в области видимости.
//
// Ответ сети возвращается какой пришёл — ошибка сервера это ошибка сервера, её
// показывает браузер. Обещание отклоняется ровно в одном случае: сети нет и в
// кэше нет — показывать нечего, и дальше браузер рисует свою страницу «нет
// соединения».
async function freshOrCached(event, request, key, storeKey) {
  try {
    const fresh = await fetch(request);
    storeLater(event, storeKey, fresh);
    return fresh;
  } catch (error) {
    const cached = await caches.match(key, { ignoreSearch: true });
    if (cached) return cached;
    throw error;
  }
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  // Запрос за страницей или за её файлом. Ни выгрузка, ни картинки планов через
  // сеть не ходят, перехватывать больше нечего.
  if (request.mode === "navigate") {
    // Искать в кэше — всегда по ключу страницы (`./`), на любой адрес с
    // параметрами. Класть — только если это и есть наша страница.
    event.respondWith(freshOrCached(event, request, PAGE, isPageUrl(request.url) ? PAGE : null));
    return;
  }
  const url = request.url.split("#")[0];
  if (ASSET_URLS.has(url)) event.respondWith(freshOrCached(event, request, url, url));
});
