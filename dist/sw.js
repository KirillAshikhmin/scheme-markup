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
const CACHE = "scheme-markup-61f8597d63dc";
// Сама страница: код и стили лежат внутри неё.
const PAGE = "./";
// Файлы, которые страница тянет сама, — шрифт и прочие ресурсы рядом (ADR 006).
// Список подставляет `build.js`: что положено в `dist/`, знает только сборка.
// Без этого на объекте без сети подписи рисовались бы запасным шрифтом.
const ASSETS = ["./assets/gost-type-a.ttf"];
const ASSET_URLS = new Set(ASSETS.map((name) => new URL(name, self.location.href).href));

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

// Сеть первой, кэш — страховка. Под каким ключом лежит ответ, решает вызывающий:
// у страницы ключ один (`./`) на любой адрес с параметрами, у файла — он сам.
async function freshOrCached(request, key) {
  try {
    const fresh = await fetch(request);
    const cache = await caches.open(CACHE);
    await cache.put(key, fresh.clone());
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
    event.respondWith(freshOrCached(request, PAGE));
    return;
  }
  const url = request.url.split("#")[0];
  if (ASSET_URLS.has(url)) event.respondWith(freshOrCached(request, url));
});
