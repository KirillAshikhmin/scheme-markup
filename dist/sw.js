// Служебный скрипт веб-версии. Собранной страницы он не касается: `dist/index.html`
// остаётся одним самодостаточным файлом и с диска работает без него.
//
// Делает ровно одно — держит последнюю страницу в кэше, чтобы установленное
// приложение открылось на объекте без сети. Данные пользователя сюда не
// попадают: они в IndexedDB, и к сети отношения не имеют.
//
// Главная опасность такого скрипта — залипший старый кэш: «я починил, а у него
// не появилось». Поэтому страница берётся **сначала из сети** и только при
// отказе — из кэша. С сетью человек всегда видит свежую сборку, даже если
// новый скрипт ещё не встал на место старого.
//
// Версия кэша — отпечаток собранной страницы: новая сборка даёт новое имя,
// старое имя сносится в `activate`. Отпечаток подставляет `build.js`.
const CACHE = "scheme-markup-454694acfc69";
// Кэшируется только сама страница: всё остальное (стили, скрипт, значок
// вкладки) лежит внутри неё.
const PAGE = "./";

self.addEventListener("install", (event) => {
  // Ждать закрытия всех вкладок незачем: приложение — один файл, и
  // рассогласоваться старой странице с новым скриптом нечем.
  self.skipWaiting();
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.add(new Request(PAGE, { cache: "reload" })))
      .catch(() => {}),
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

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  // Запрос за страницей — и только он. Ни выгрузка, ни картинки планов через
  // сеть не ходят, перехватывать больше нечего.
  if (request.mode !== "navigate") return;
  event.respondWith(
    (async () => {
      try {
        const fresh = await fetch(request);
        const cache = await caches.open(CACHE);
        await cache.put(PAGE, fresh.clone());
        return fresh;
      } catch (error) {
        const cached = await caches.match(PAGE, { ignoreSearch: true });
        if (cached) return cached;
        throw error;
      }
    })(),
  );
});
