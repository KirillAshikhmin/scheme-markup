# Архитектура: имитация умного дома и сценарии

Словарь — `CONTEXT.md`; почему так — `docs/adr/009…020`; сборка страницы и общие правила — раздел `scheme_image/` в корневом `AGENTS.md`. Здесь — как течёт состояние имитации и где границы модулей. Точные сигнатуры — шапки самих модулей, не этот файл.

## Поток данных

```
project (объект, model.js)
  └─ buildHomeSpec(project)            src/sim/home.js   — чистое чтение: аксессуары, связи клавиш, двери, сценарии, привязки
       + site/rooms (simHomeOf)        src/simulation.js — координаты солнца и имена помещений
  └─ bridge.post(load/start)           src/sim/bridge.js — Worker из Blob; без Worker — движок в самой странице
       └─ Worker: simWorkerMain        src/sim/worker.js → createSimEngine (sim/engine.js)
            хозяева сценариев: [createHubOwner() (sim/hubApi.js), blocksOwner() (sim/blocks.js)]
            время: sim/timers.js (виртуальная очередь), sim/schedule.js, sim/presses.js
       ← changes / log / scenarios / forms / fault / next / pong
  └─ зеркало в simulation.js           values, журнал (SIM_JOURNAL_MAX 2000), память дома; simWatch(fn) оповещает экраны
  └─ simLive(project) → Map<markId, Live>   (sim/live.js: simLiveOf — одно правило «что рисовать»)
       ├─ «Схема»: drawScheme({live, liveFx})        render.js, canvas.js
       ├─ мини-план в «Сценариях»: тот же drawScheme  panels/miniPlan.js
       └─ «Объём»: свечение, свет комнаты, шторы, экран ТВ   volume.js, panels/volume.js
```

Обратный путь: щелчок, клавиша `E`, ходьба, дверь → `simAct`/`simPress`/`simPresence`/`simDoor` (`simulation.js`) → сообщение `act` в Worker. Часы приложения — `src/appClock.js` (формулы в `src/clockMath.js`); Worker сам считает `clockSimMs(clock, Date.now())` и получает `setClock({simMs})`.

## Границы и соглашения

- **Живое состояние имитации не входит в объект.** Никогда через `canvasCommit`, `setState({project})` или `project`: оно живёт в зеркале `simulation.js` и в настройке браузера `simState` по ключу объекта (ADR 015). В объекте — только то, что человек задал: `type.device`/`mark.device` (профили), `project.scenarios`, `project.logicBindings`. Эти поля пишутся через `canvasCommit` со своим ярлыком `strings.history.*`.
- **Профиль выводится, а не пишется** (ADR 013): нет `type.device` — профиль считает `typeDeviceOf` по коду типа. Командам `setTypeDevice`/`setMarkDevice` передают только изменённые ключи; ничего не изменилось — не вызывать. Явное «без аксессуара» — `kind: "none"` (ADR 020).
- **Адреса не хранятся** (ADR 012): `aid = deviceAid(mark.id)`, `sid`/`cid` считаются из профиля. Ключ устройства везде `mark.id`; обозначение метки не уникально.
- **Версия файла 6 — только если есть сценарии или привязки** (ADR 014, `projectFormatVersion`); иначе объект остаётся версии 5. Объект прежней версии открывается без единого изменения — тесты на `test/legacy-*.json` и `test/fixtures/g68-legacy-*`.
- **Чистые слои без DOM:** `sim/*`, `scenarioTree.js`, `appClock.js`, `clockMath.js`. Экран — `simulation.js` (без DOM, но страничный) и `panels/*`. Бандл Worker не должен тянуть DOM-модули — `build.js: assertWorkerPure`.
- **Worker** (ADR 009, 010): собирается вторым бандлом из `src/sim/worker.js`, кладётся строкой в `SIM_WORKER_SOURCE` (в исходнике пустая — подставляет `build.js`). Сторож в `bridge.js`: пульс 1 с, нет ответа 3 с — перезапуск потока и выключение виновного скрипта. Первой строкой в потоке снимаются сеть, хранилища, `navigator` (`simWorkerSeal`). Страница от бесконечного цикла в сценарии защищена только Worker; запасной путь в странице — без защиты.
- **Хозяева сценариев** подключаются к движку списком `owners`; порядок `[hub, blocks]`. Хост-дверь (`host.*`) — единственное, что хозяин знает о движке. Новый вид сценария = новый хозяин, а не ветка в `engine.js`.
- **Свой формат блоков** (ADR 011), не JSON Sprut.Hub; `.js` и JSON `scenarioTemplate` читает `hubScriptRead`, блочный JSON хаба — отказ `hubBlocks`. Правила там, где вики молчит, — ADR 018.
- **Журнал — коды, а не тексты.** Движок и хозяева пишут `code` + `vars`; текст — `text("sim.journal." + code, vars)` из `strings.js`. Новый код — и в движок, и в `strings.sim.journal`.
- **Время имитации `simMs` — «местные мс»** (стеновое время, записанное как UTC): читать только `getUTC*`. Подмена `Date` в `hubApi` собирает время из `getUTC`-частей. Одни часы на приложение (ADR 016); `volumeParams*` часов — тонкие двери к `appClock`.
- **Выключатель = реле + кнопка** (ADR 017, вид `switchRelay`): привязанная клавиша переключает «Выключатель» и событий не шлёт; отвязанная шлёт `ProgrammableSwitchEvent`. Вид `switch` — прежний профиль «только кнопки». Один щелчок/нажатие — `deviceCard.js` (`deviceClickPlan`, `devicePressers`) для «Схемы», «Объёма» и мини-плана; второго реестра нажатий не заводить.
- **Один кадр живого рисования** — `simLiveFrame` в `render.js` (пульс, вспышка) для всех трёх поверхностей. `drawScheme` без `live` не делает ни одного лишнего вызова `ctx` — отпечатки кадров в тестах (`test/doors.test.js`).
- **Режим «Сценарии»** — `panels/scenarios.js` (список, полоса часов, журнал), редактор блоков — `scenarioEditor.js`, окно JS — `scenarioScript.js`; они подключаются к списку через `scenariosHook(...)` и сами не импортируют друг друга (иначе цикл). Записи в объект — `scenarioScriptCommitter`/`canvasCommit`. Правка только на десктопе (`editScenarios`), на телефоне просмотр.
- **Каркас обязан звать `simSync(project)` на каждую смену `project`** (это делает `setState`); правка объекта при идущей имитации пересобирает дом и сбрасывает ждущие таймеры (запись журнала `editReset`).
- **Белые списки полей** (новое поле типа/метки, `merge.js` для новой коллекции, две миграционные трубы `projectFile.migrateProject` и `panels/projects.js:openProjectById`) — см. «Правила, которые нельзя нарушить» в корневом `AGENTS.md`.
- **Имена:** именованные экспорты, уникальные по всему `src/`, без циклов — проверяет `build.js`. Префиксы: `sim*`, `scenario*`, `device*`, `hub*`, `blocks*`, `press*`, `appClock*`.

## Тестовые швы

Модель (профили, сценарии, привязки, версия 6, слияние) · словарь `sim/catalog.js` · `scenarioTree` · движок на доме-фикстуре без DOM и Worker (`test/fixtures/simHome.js`: `simHouse()`, `simBigHouse(100)`) · `hubApi` на настоящих сценариях Sprut.Hub (`test/fixtures/sprut/`; тест `test/simHub.test.js` пропускается без соседнего `../../Sprut.Hub_Tools`) · кадры `drawScheme` и «Объёма» без имитации совпадают с прежними вызов в вызов · сборка: бандл Worker исполняется в Node (`test/buildWorker.test.js`). Нормы скорости в тестах — медиана после прогрева с запасом ×10.
