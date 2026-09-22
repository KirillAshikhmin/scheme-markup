// Установка страницы как приложения — только для веб-версии.
//
// Со страницы на диске (`file://`) не работает ни установка, ни служебный
// скрипт, и это не поломка: `dist/index.html` там и так лежит целиком, сеть
// ему не нужна. Поэтому регистрация тихо ничего не делает везде, кроме сайта.
//
// Что делает служебный скрипт — в `web/sw.js`. Здесь только две вещи, которые
// решают судьбу обновления:
//
//  1. Регистрация с `updateViaCache: "none"` — сам файл скрипта никогда не
//     берётся из HTTP-кэша. Иначе новая сборка ждала бы, пока протухнет старый
//     ответ, и «я починил» доезжало бы через сутки.
//  2. Проверка обновления при возвращении на вкладку. Установленное приложение
//     на планшете живёт неделями без перезагрузки: без этого толчка браузер
//     заглядывает за новой версией только при переходе по адресу.

// Путь скрипта относительно страницы: на GitHub Pages приложение живёт в
// подпапке, и абсолютный «/sw.js» указывал бы в корень чужого сайта.
const PWA_WORKER = "./sw.js";

// Служебный скрипт живёт только в защищённом окружении. `file://` и открытая
// по http страница из локальной сети его не получают — и не должны: там он
// молча падал бы в консоль на каждой загрузке.
export function pwaSupported(view) {
  const target = view || (typeof window === "undefined" ? null : window);
  if (!target || !target.navigator || !("serviceWorker" in target.navigator)) return false;
  return Boolean(target.isSecureContext) && target.location && target.location.protocol !== "file:";
}

export function registerServiceWorker() {
  if (!pwaSupported()) return null;
  const promise = navigator.serviceWorker
    .register(PWA_WORKER, { scope: "./", updateViaCache: "none" })
    .then((registration) => {
      // Возвращение на вкладку — единственный надёжный повод спросить о новой
      // версии в приложении, которое не перезагружают. Ответ приходит в
      // следующую навигацию: страница и так берётся из сети первой.
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") registration.update().catch(() => {});
      });
      return registration;
    })
    .catch(() => null);
  return promise;
}
