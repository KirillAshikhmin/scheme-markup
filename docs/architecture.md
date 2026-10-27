# Архитектура «Разметки схем»

Карта для того, кто правит код, — в первую очередь для агента. Отвечает на «где это живёт, через что течёт и что нельзя ломать». Не повторяет:

- **что умеет сервис и как достать данные из объекта** — `AGENTS.md` (рядом);
- **правила и ловушки сборки** — раздел `scheme_image/` корневого `AGENTS.md` («Правила, которые нельзя нарушить», «Ловушки»);
- **почему решения такие** — `docs/adr/001…020`;
- **слова предметной области** — `CONTEXT.md`;
- **точные сигнатуры и доводы** — шапки самих модулей. При расхождении прав код, этот файл чинят.

Числа (строки, тесты, миллисекунды) — на 2026-10-24; они стареют, структура — нет.

## 1. С чего начинать по задаче

| Задача | Читать сначала |
|---|---|
| Любая правка | §3 (слои), §4 (поток правки), правила корневого `AGENTS.md` |
| Поле или правило объекта | `src/model.js` (шапка + ближайшие функции), §4, ADR 002/008/013/014 |
| «Схема», «Чертёж», выгрузки | §5, `render.js`, `canvas.js`, `panels/workshop.js` |
| «Объём» | §6 целиком; модули — §6.2, функции файла — `ast-index outline scheme_image/src/volume/lamps.js` |
| Имитация, сценарии, аксессуары | §7, `CONTEXT.md`, ADR 009–020 |
| Сборка, CI, прод | §9, §10, `build.js` |
| Найти символ, вызовы, файл | §11 (`ast-index`) |

## 2. Целиком

Одна статическая страница: ни сервера, ни зависимостей (ADR 001), ни сети. Объект живёт в IndexedDB браузера, переносится zip-файлом.

```
src/**/*.js + src/**/*.css + src/index.html
        │  node build.js  (своя склейка: топосортировка импортов → один IIFE)
        ▼
dist/index.html  ≈2,8 МБ  ── страница целиком: код и стили без комментариев, строки
   └─ внутри строкой SIM_WORKER_SOURCE — второй бандл (поток имитации, ADR 010), ≈320 КБ
dist/assets/gost-type-a.ttf, sw.js, manifest.webmanifest, значки, guide.html
        │  git subtree split --prefix=scheme_image → KirillAshikhmin/scheme-markup
        ▼
GitHub Actions: npm test → npm run build → GitHub Pages
               + отдельно: свежая сборка = dist/ в git (работа dist)
```

`dist/` лежит в git и собирается байт в байт. Правка `src/` без пересборки `dist/` — недоделанная правка.

## 3. Слои и модули

132 модуля, ~106 тыс. строк в `src/`. Стрелки зависимостей идут только вниз, циклов нет (проверяет `build.js`):

```
каркас и панели      app.js · panels/*.js                       DOM, события, окна
      ▼
поверхности          canvas.js (план) · panels/workshop.js (чертёж) · panels/volume.js (окно «Объёма»)
      ▼                exporter.js · gostSheet.js · pdf.js · mono.js
счёт поверхностей    render.js (2D) · volume.js (3D) · objectViews/* · objectModels/*   холст — аргументом
      ▼
имитация             simulation.js (зеркало в странице) ⇄ sim/bridge.js ⇄ Worker: sim/*
      ▼
данные и правила     model.js · strings.js · каталоги · merge.js · deviceMigrate.js · tables.js   чистые, без DOM
хранение и файл      store.js (IndexedDB) · projectFile.js (zip) · autosave.js
```

Самые нагруженные узлы (сколько модулей импортируют): `strings.js` 60, `model.js` 53, `panels/ui.js` 42, `render.js` 25, `app.js` 22, `store.js` 21. Ломающая правка в них расходится по всему приложению.

### Крупные модули

| Модуль | Строк | Что внутри |
|---|---|---|
| `src/volume/*.js` | 14 600 в 19 модулях | «Объём» — весь счёт: сцена, свет, тени, порядок граней, камера, ходьба, небо, фон (§6); самые крупные — `backdrop.js` 1 660, `lamps.js` 1 510 |
| `src/model.js` | 10 977 | все правила объекта: справочники, метки, нумерация, стены, проёмы, помещения, этажи, профили аксессуаров, валидация, миграции |
| `src/render.js` | 7 121 | геометрия и рисование 2D: метки, подписи, легенда, чертёж, `hitTest`, `drawScheme`, `drawDrawing` |
| `src/panels/workshop.js` | 5 807 | режим «Чертёж»: стены, проёмы, вещи, развёртки, черновики |
| `src/panels/volume.js` | 5 270 | окно «Объёма»: кадр, клавиши, мышь, сенсор, миникарта, подписка на дом |
| `src/canvas.js` | 4 988 | холст «Схемы»: режимы `select / add / room`, выделение, единственная запись в историю |
| `src/strings.js` | 4 740 | весь видимый текст и коды журнала |
| `src/sim/hubApi.js` | 2 658 | эмуляция API Sprut.Hub для JS-сценариев |

### Остальное по группам

- **Каталоги — данные сборки, не объекта:** `objectCatalog.js` (вещи чертежа), `openingCatalog.js` (виды проёмов), `sim/catalog.js` + `sim/hubTypes.js` (сервисы и характеристики, `hubTypes` собран `tools/hub-types.mjs`). Ключ вещи общий для трёх реестров: каталог, `objectViews/objects.js` (изображение на развёртке), `objectModels/objects.js` (тело в «Объёме»).
- **Чистые помощники:** `markBox.js` (габарит в мм), `markSpare.js` (запасной габарит), `colorName.js`, `gestures.js`, `lightFade.js`, `history.js`, `imagePrep.js`, `roomTrace.js`, `scenarioTree.js`, `clockMath.js`, `weather.js`.
- **Общие сеансовые хозяева:** `appClock.js` (одни часы, ADR 016), `appWeather.js` (выбор погоды), `screenPlace.js` (одно место и масштаб на три режима), `planNav.js` (ход по плану на все поля).
- **Панели** (`src/panels/`) монтируются `registerPanel(PANEL_IDS.x, mountFn)` в точки `src/index.html` и друг друга не импортируют. Импортировать панель некому: в бандл попадает каждый файл `src/**/*.js`. Общие кирпичи — `panels/ui.js`.

## 4. Состояние и поток правки

```
project (один объект JSON, ссылкой)          getState() — снимок: filter, view, выделение — копии
   │ функция model.js → НОВЫЙ project        (исходный не меняется никогда)
   ▼
canvasCommit(before, after, label, opts)     canvas.js — единственное место pushCommand (history.js, глубина 100)
   ▼
setState({project, …})                        app.js → подписчики subscribe(), simSync(project)
   ├─ панели перерисовываются (scheduleFrame — кадр без rAF-гонок)
   ├─ store.js: автосохранение документа в IndexedDB (`projects`, `images`, `settings`)
   └─ имитация пересобирает дом (§7)
```

- **Мутатор объекта — только `model.js`.** Каждая функция возвращает новый объект: `{project, …}` или значение.
- **Отменяемое — только через `canvasCommit`.** Единственное исключение — удаление схемы: картинка уходит из IndexedDB безвозвратно, причина в абзаце над `removeScheme`.
- **Экран, а не объект:** выделение, фильтры, скрытые вещи, слои, вид «Объёма», выбор погоды, состояние имитации живут в состоянии сеанса и настройках браузера (`store.js`), в `project.json` не попадают.
- **Файл:** `projectFile.js` — свой zip (`writeZip`/`readZip`) с `project.json`, планами и README. Загруженный объект проходит `autosave.adoptLoadedProject` (новые id), затем миграции. Слияние двух экземпляров — `merge.js`.
- **Миграции (G68):** две трубы открытия — `projectFile.migrateProject` (файл) и `panels/projects.js: openProjectById` (база); перевод аксессуаров — `deviceMigrate.js`. Новое поле получает выведенное значение. Тест — объект прежней версии (`test/legacy-*.json`, `test/fixtures/g68-legacy-*`) открывается без единого изменения.
- **Координаты:** точки меток — доли плана 0…1 (ADR 002), чертёж — целые миллиметры (ADR 008). Перевод — `planFractionToMm` / `planMmToFraction`; масштаб и начало у схемы задают `setPlanScale` / `setPlanOrigin`.

## 5. «Схема», «Чертёж», выгрузки

- **`render.js`** — чистое рисование по холсту-аргументу: `drawScheme` (метки, подписи, связи, живое состояние `live`/`liveFx`), `drawDrawing` (стены, проёмы, вещи), геометрия фигур и начертаний, `hitTest`. Без `live` `drawScheme` не делает ни одного лишнего вызова `ctx`: в тестах кадры сверяются журналом вызовов.
- **`canvas.js`** — поле «Схемы»: жесты (через `gestures.js` и `planNav.js`), режимы, постановка меток, блоки, ломаные, помещения контуром, `canvasCommit`.
- **`panels/workshop.js`** — «Чертёж» поверх того же поля: стены (`splitWall`), проёмы из `openingCatalog.js`, вещи из `objectCatalog.js` (`turnDeg`, «К стене»), развёртка (`panels/elevation.js`).
- **Поля вне «Схемы»** (мини-план «Сценариев», схема в окне) — `panels/planView.js` тем же `drawScheme` и тем же `planNav`. Второго механизма хода по плану нет.
- **Выгрузки:** `exporter.js` (PNG схемы и таблиц, zip всех схем, печать) рисует тем же `drawScheme` с `zoom = scale`; `gostSheet.js` — лист ГОСТ с рамкой и штампом; `mono.js` — ч/б; `pdf.js` — свой PDF растровой страницей (ADR 007); `pngDpi.js` — физический размер в PNG; `tables.js` — CSV, Markdown, TSV.
- **`tools/scheme.mjs`** — те же выгрузки из командной строки без своего счёта: импортирует модули страницы. Браузерные команды (`plan-png`, `volume-png`) поднимают свой Chrome мостом `tools/schemeSheets.mjs`.

## 6. «Объём»

### 6.1 Конвейер

```
            когда пересчитывается                что получается
project ──▶ volumeScene(project, schemeId, opts)  scene: faces[] (стены, откосы, полы, потолки, вещи, тела меток),
            смена объекта, схемы, двери, шторы,     walls, rooms, occluders (призмы вещей для теней), shadowBoxes,
            скрытых вещей                           landMm, дерево порядка (volumeOrderTree); этажи стопкой — volumeStackScene
час    ──▶ volumeMood(...)                          at: tint (доля ночи), солнце, луна, погода; раз в секунду, при стоячих часах — никогда
дом    ──▶ lightFadeLive → volumeLiveLight(scene, live, {physical, tint})
                                                    light: lamps, decals (кольца ламп), shades (тени), skyDecals (пятна окон);
                                                    геометрия колец и теней — один раз на набор ламп (память volumeLampBuilt),
                                                    кадр только раскрашивает по яркости
кадр   ──▶ paint() в panels/volume.js:
            volumeDrawBackdrop → volumeFrame(scene, camera, box, extra, tint, light) → polygons
            → volumeDraw(ctx, polygons) → volumeDrawBackdropNear → миникарта → осадки (своё поле)
```

Кадр рисуется **по событию**: движение, свет в пути (`lights.busy`), часы. Стоячее поле кадров не заказывает.

### 6.2 Модули `src/volume/`

Счёт «Объёма» разложен по `src/volume/*.js` (2026-10-25; до того — один `volume.js` на 13,5 тыс. строк). `src/volume.js` — дверь: шапка с доводами и реэкспорт прежнего наружного списка (339 имён). Снаружи «Объём» читают через неё, соседи по папке — напрямую. Слои снизу вверх, каждый читает только нижние (`build.js` ловит циклы):

```
measures → faces → camera → shapes → order → palette → sky → walls → sun →
marks → floors → walk → scene → lamps → signs → frame → pick → backdrop → around
```

| Модуль | Что | Ключевые функции |
|---|---|---|
| `measures.js` | мерки человека и стойки, ярусы кадра, краски, прозрачность | `VOLUME_*` |
| `faces.js` | векторная арифметика, грань, тон, тень дома | `volumeFill`, `volumeShade`, `volumeTintRgb`, `volumeFaceNormal`, `volumeShadowFaces` |
| `camera.js` | базис взгляда, фокус, отсечение | `volumeBasis`, `volumeFocal`, `volumeClipNear` |
| `shapes.js` | общие помощники формы | `volumePointInside`, `volumePrismFaces`, `volumeRoomAt` (то же правило, что `wallPlaceRoom` плана), `volumeRoomKeyAt`, `volumeOccluder` |
| `order.js` | порядок граней (BSP) | `volumeOrderTree` (раз на сцену), `volumeOrderWalk` (на кадр), `volumeOrderRank` |
| `palette.js` | виды фона и краски его вещей | `volumeBackdropKindOf` |
| `sky.js` | час суток, светила, погода | `volumeMood`, `volumeSkyColors`, `volumeBodyAt`, `volumeMoonShape` |
| `walls.js` | стены, углы, проёмы | `volumeWallFaces`, `volumeWallMiters`, `volumeWallSolids`, `volumeDoorOpen` |
| `sun.js` | солнце и луна в комнате, шторы и тюль | `volumeSunSpotFaces`, `volumeMoonSpotFaces`, `volumeSunOpenings`, `volumeCurtain*` |
| `marks.js` | тела меток, модели, выделение и связи | `volumeMarks`, `volumeMarkFaces`, `volumeModelFaces` (тела из `objectModels/*`) |
| `floors.js` | пол, потолок, вещи, лестница, двусвет | `volumeFloorFaces`, `volumeObjectFaces`, `volumeStairs`, `volumeCeilingUnderVoid` |
| `walk.js` | где встать, ходьба, стойка, падение | `volumeCanStand`, `volumeMoveTo`, `volumeFallTo`, `volumeStanceStep`, `volumeStairLanding` |
| `scene.js` | сборка сцены | `volumeScene`, `volumeStackScene` |
| `lamps.js` | свет ламп и неба, пятна, швы, тени вещей | `volumeLiveLight`, `volumeLampSources`, `volumeRoomTint`, `volumeWindowDecals`, `volumeLampDecals`, `volumeSeamGrow`, `volumeLampShades`, `volumeShadeAlpha` |
| `signs.js` | признаки работы, шкалы, ель | `volumeLiveSigns`, `volumeCo2Rgb` |
| `frame.js` | кадр и рисование | `volumeFrame`, `volumeFacePolygons`, `volumeDraw`, `volumeRainMask` |
| `pick.js` | что под пальцем | `volumePickAt`, `volumeSightAt`, `volumeChannelAt`, `volumeDoorAt` |
| `backdrop.js` | фон: горизонт, земля, деревья, горы, город | `volumeDrawBackdrop`, `volumeDrawBackdropNear` |
| `around.js` | обзор со стороны | `volumeAround*` |

Внутри модулей разделы отбиты строками `// ——— имя ———` (`grep -n '^// ———' src/volume/*.js`), шапки разделов переехали вместе с кодом.

### 6.3 Решения, на которых всё стоит

- **Свой рисовальщик по Canvas 2D, не WebGL** (шапка `volume.js` — двери модулей): одна среда рисования с планом и развёрткой, без библиотек. Узкое место — заливка пикселей, а не арифметика.
- **Порядок граней — дерево разбиения (BSP), не сортировка** (D32, D33): строится при сборке сцены, обходится за `n` на кадр, верен в каждом пикселе. Поэтому прозрачным вещам второй проход не нужен. Ярусы `VOLUME_LAYER_*` (плита, тень дома, полы, солнечные пятна, тела) кладутся до и после дерева.
- **Время суток — одно непрерывное число** (высота солнца), а не четыре состояния: ни одного «если ночь» в рисовании.
- **Физический свет** (отметка «Физический свет», по умолчанию включена):
  - лампа кладёт пятно кольцами на грани своей комнаты и клином сквозь открытый проём к соседке;
  - окна днём светят комнату (`skyDecals`);
  - вещи каталога бросают тень от ламп своей комнаты (`occluders`). Тень снимает только свет своей лампы (`volumeShadeAlpha`);
  - без отметки свет комнаты заливает её целиком (`volumeRoomTint`).
- **Пятна и тени без обводки.** Шов с соседним куском той же плоскости и той же комнаты закрывает раздача на полточки (`volumeSeamGrow`). Обычные грани обводятся своим цветом, иначе сглаживание проявило бы стыки BSP.
- **Режим только читает** (G68): ни одной записи в объект. Единственное, что уходит наружу, — выделение (состояние сеанса).
- **Краска стен, пола и потолка — цвет грани, а не второй слой** (правка 2026-10-25). Хранит её объект: `wall.paint = {left, right}` (стороны по ходу стены, как у развёртки) и `room.paint = {floor, ceiling}`, необязательные ключи, сброс удаляет ключ (`setWallPaint`, `setRoomPaint`, `setRoomWallsPaint` в `model.js`). Сцена кладёт краску в `face.rgb` (`volumePainted`): заливка, ночь, кольца ламп и пятна солнца берут цвет у грани сами. Узнавать стену, пол и потолок сравнением `face.rgb === VOLUME_WALL_RGB` больше нельзя — только `volumeIsWall` / `volumeIsFloor` / `volumeIsCeiling` (крашеная грань несёт `face.paint`). Пол в проёме — полосы под стеной по сторонам, откосы — половины по толщине: каждая берёт краску своей стороны. Изнанка двустороннего потолка — крыша, она держит цвет сборки (`face.backRgb`). Некрашеный объект собирается грань в грань прежним — кадры совпали байт в байт.
- **Дерево порядка помнит неподвижные грани** (правка 2026-10-27, фриз при открытии двери): `volumeOrderTree` строит дерево по граням без `doorId`, а полотна дверей, створки и ворота вставляет в него потом (`volumeOrderInsert`, копии узлов на пути — готовое дерево не меняется). Неподвижные грани новой сборки сверяются с прежними поле в поле: совпали — дерево берётся готовым (65 → 20 мс на дверь на объекте в 13 тыс. граней). Только у сцены одной схемы: этаж стопки собирает своё дерево, как прежде. Полотно двери — призма в 40 мм (`VOLUME_DOOR_LEAF_MM`), бруски створки — призмы глубиной рамы.
- **Стеклянная стена** (`wall.glass`, правка 2026-10-27) — те же грани стены, ставшие стеклом двери (`volumeGlassed`): кадр смешивает по `alpha`, взгляд смотрит сквозь по `clear`. Пятнам ламп она не стена (`volumeIsWall` по цвету), тени дома не бросает, человека держит.
- **Лестница собирается по габариту** (`objectModels/stairs.js`): плоские ступени по подъёму 175 мм, на пятую часть уже хода; Г-, П-образная и спиральная отражаются (`schemeObject.mirror`). Предел модели в пять тел к ним не относится — лестниц на объекте одна-две. Окно «на какой этаж» — с 400 мм и только из помещения лестницы (`volumeStairNear` со сценой).
- **Двери и створки окон — одно множество открытого** (`openDoors` в `panels/volume.js`, `openDoorIds` сцены): окна, кроме витража в пол (`openingVents`), открываются створкой — первой секцией лица, у балконного над поясом (`openingVentCell`, `volumeWindowSash`). «Все двери» (`R`) окон не трогает. Дом узнаёт о створке тем же `simDoor`: климат проветривает комнату площадью створки, датчик открытия в проёме окна ходит с ним (`markDoorOf`).

### 6.4 Бюджет кадра

Стенд — `npm run bench` (счёт в Node) и `npm run bench:browser` (ещё и заливка в своём Chrome), сцены в `tools/bench/scenes.mjs`. Замер со сценой «квартира с мебелью» (`flat`), поле 844 × 390, после правки 2026-10-24:

- плотность холста ограничена двумя точками экрана на точку изображения (`volumeRatio`), а пальцем на ходу — одной (`volumeMotionRatio`): встал — через 160 мс кадр перерисовывается чётким;
- около 600 многоугольников на кадр;
- заливка около 6 мс на видеокарте Mac;
- JS-часть кадра около 0,5 мс;
- пересборка света около 11 мс на обычной квартире и около 200 мс в комнате с 20 лампами и 48 вещами. Она идёт разово: на смену ламп, двери или шторы.

Что дорого: число `fill()`, площадь холста, обводки. Новый эффект в кадре меряют прежде, чем принять.

На живом устройстве — адресом `?fps` (`src/fpsMeter.js`): в углу поля темп кадров, пока поле двигают, время счёта кадра в JS, грани и холст. Заливку видеокарты видно по темпу.

### 6.5 Окно и поверх-кадра

- `panels/volume.js` — кадр (`paint`), камера и стойка, клавиши (`E` — дверь или створка окна, `Q` — окно метки), сенсор (плавающий джойстик хода, взгляд свайпом), миникарта (`drawDrawing` через мост «пиксель = мм»), подписка на дом `simWatch`.
- `panels/volumeParams.js` — окно параметров: фон, время, погода, слои, ходьба.
- `panels/volumeRain.js` — осадки своим холстом, маска дома — `volumeRainMask`.
- `panels/volumeAir.js` — окошко климата у часов.

## 7. Имитация умного дома и сценарии

### Поток данных

```
project (объект, model.js)
  └─ buildHomeSpec(project)            src/sim/home.js   — чистое чтение: аксессуары, связи клавиш, двери, сценарии, привязки
       + site/rooms (simHomeOf)        src/simulation.js — координаты солнца и имена помещений
  └─ bridge.post(load/start)           src/sim/bridge.js — Worker из Blob; без Worker — движок в самой странице
       └─ Worker: simWorkerMain        src/sim/worker.js → createSimEngine (sim/engine.js)
            хозяева сценариев: [createHubOwner() (sim/hubApi.js), blocksOwner() (sim/blocks.js)]
            время: sim/timers.js (виртуальная очередь), sim/schedule.js, sim/presses.js; климат — sim/climate.js
       ← changes / log / scenarios / forms / fault / next / pong
  └─ зеркало в simulation.js           values, журнал (SIM_JOURNAL_MAX 2000), память дома; simWatch(fn) оповещает экраны
  └─ simLive(project) → Map<markId, Live>   (sim/live.js: simLiveOf — одно правило «что рисовать»)
       ├─ «Схема»: drawScheme({live, liveFx})        render.js, canvas.js
       ├─ мини-план в «Сценариях»: тот же drawScheme  panels/miniPlan.js
       └─ «Объём»: свечение, свет комнаты, шторы, экран ТВ   volume.js, panels/volume.js
```

Обратный путь: щелчок, клавиша `E`, ходьба или дверь вызывают `simAct` / `simPress` / `simPresence` / `simDoor` (`simulation.js`), а те шлют сообщение `act` в Worker. Часы приложения — `src/appClock.js` (формулы в `src/clockMath.js`). Worker сам считает `clockSimMs(clock, Date.now())` и получает `setClock({simMs})`.

### Границы и соглашения

- **Живое состояние имитации не входит в объект.** Оно не идёт через `canvasCommit`, `setState({project})` или `project`, а живёт в зеркале `simulation.js` и в настройке браузера `simState` по ключу объекта (ADR 015). В объекте — только то, что задал человек: `type.device` / `mark.device` (профили), `project.scenarios`, `project.logicBindings`. Эти поля пишутся через `canvasCommit` со своим ярлыком `strings.history.*`.
- **Профиль выводится, а не пишется** (ADR 013): нет `type.device` — профиль считает `typeDeviceOf` по коду типа. Командам `setTypeDevice` / `setMarkDevice` передают только изменённые ключи; если ничего не изменилось, их не вызывают. Явное «без аксессуара» — `kind: "none"` (ADR 020).
- **Адреса не хранятся** (ADR 012): `aid = deviceAid(mark.id)`, `sid` и `cid` считаются из профиля. Ключ устройства везде `mark.id`; обозначение метки не уникально. Метки одного типа с одним номером — одно устройство (`deviceFollowers`, `markDeviceLeader`).
- **Версия файла 6 — только если есть сценарии или привязки** (ADR 014, `projectFormatVersion`); иначе объект остаётся версии 5.
- **Чистые слои без DOM:** `sim/*`, `scenarioTree.js`, `appClock.js`, `clockMath.js`, `weather.js`. В бандл Worker не должны попадать DOM-модули — это проверяет `build.js: assertWorkerPure`. `model.js` не импортирует `sim/home.js`.
- **Worker** (ADR 009, 010) собирается вторым бандлом из `src/sim/worker.js` и кладётся строкой в `SIM_WORKER_SOURCE`. В исходнике строка пустая, текст подставляет `build.js`. Сторож в `bridge.js`: пульс раз в 1 с; если ответа нет 3 с, поток перезапускается, а виновный скрипт выключается. Новый поток получает `start {restore: true, memory}`: это продолжение, а не старт хаба — «на старте» и `onStart` не исполняются, а `GlobalVariables` возвращаются из памяти, которую поток после каждого события отдаёт странице сообщением `memory` (хук хозяина `memory()`). Первой строкой поток снимает сеть, хранилища и `navigator` и запирает код из строки (`simWorkerSeal`, `simWorkerNoStringCode`); `import(` в тексте сценария отвергает разбор (`hubScriptCompile`).
- **Хозяева сценариев** подключаются к движку списком `owners` в порядке `[hub, blocks]`. Хост-дверь (`host.*`) — единственное, что хозяин знает о движке. Новый вид сценария — это новый хозяин, а не ветка в `engine.js`.
- **Свой формат блоков** (ADR 011), не JSON Sprut.Hub. Файлы `.js` и JSON `scenarioTemplate` читает `hubScriptRead`; блочный JSON хаба получает отказ `hubBlocks`. Правила там, где вики молчит, — ADR 018.
- **Журнал — коды, а не тексты.** Движок пишет `code` + `vars`, текст получается как `text("sim.journal." + code, vars)`. Новый код заводится и в движке, и в `strings.sim.journal`.
- **Время имитации `simMs` — «местные мс»** (время на стенных часах, записанное как UTC). Читать его только через `getUTC*`.
- **Выключатель = реле + кнопка** (ADR 017, вид `switchRelay`). Один щелчок или нажатие обрабатывает `deviceCard.js` (`deviceClickPlan`, `devicePressers`) для всех трёх поверхностей.
- **Режим «Сценарии»:** `panels/scenarios.js` + `scenarioEditor.js` (блоки) + `scenarioScript.js` (JS). Они подключаются через `scenariosHook(...)` и друг друга не импортируют. Править можно только на десктопе.
- **`simSync(project)` на каждую смену `project`** (это делает `setState`). Правка объекта при идущей имитации пересобирает дом и сбрасывает ждущие таймеры (`editReset`).
- **Поток поднимается по надобности** (`ensureBridge`): на запуск дома, на явное действие (запуск сценария, «Активный», климат) и когда экрану нужно то, что знает только поток, — `simScenarios()` и `simOptionForms()` (режим «Сценарии», карточка устройства). Открытый и правленный объект без этого потоку не уходит; действия остановленного дома (щелчок, ходьба, двери) не шлются вовсе — движок их всё равно отбрасывает.
- **Скрытое поле событий дома не рисует:** план — только в «Схеме» (`canvasOnScreen`), мини-план и схема в окне — только видимые (`planView.js`); показанное снова перерисовывают смена `screen` и `ResizeObserver`.

## 8. Строки, имена, стили

- **Все видимые строки — в `src/strings.js`.** В разметке только ключи `data-text` / `data-title`. `test/strings.test.js` проверяет словарь в обе стороны: мёртвый ключ и строка без ключа роняют прогон. Латиницу с диакритикой в видимые строки не класть: шрифт ГОСТ рисует её кириллицей (CP1251).
- **Имена:** только именованные экспорты; имена верхнего уровня уникальны во всём `src/`, потому что бандл — одна область видимости. Префикс — по модулю: `volume*`, `sim*`, `scenario*`, `device*`, `hub*`, `blocks*`, `workshop*`, `press*`, `appClock*`. Поэтому поиск символа по имени однозначен.
- **Стили:** все `src/**/*.css` склеиваются текстом. Тест про стили не говорит ничего, кроме сходимости скобок и чисел, повторённых в JS (`test/cssMeasures.test.js`). Правку стилей проверяют глазами.

## 9. Сборка и проверки

`node build.js` (`npm run build`):

1. Читает исходники, строит граф относительных импортов (`dependenciesOf`) и упорядочивает его (`orderModules`).
2. Убирает комментарии, отступы и пустые строки (`stripComments`, у стилей — `stripCssComments`), срезает `import` / `export` (`stripModuleSyntax`) и склеивает модули в один IIFE. Исходники — наполовину комментарии: без них страница 2,8 МБ вместо 7,2 (сжатой по сети 0,67 МБ вместо 1,9). Разбор сверяет `test/buildStrip.test.js`.
3. Собирает второй бандл потока из `src/sim/worker.js` (`workerBundleFrom`), проверяет его чистоту (`assertWorkerPure`) и подставляет строкой (`withWorkerSource`). Вместо `strings.js` в поток идёт выжимка словаря — разделы `WORKER_STRINGS` (`sim`, `rooms.none`) и та же `text`; модуль потока, читающий строку вне выжимки, роняет сборку (`assertWorkerStrings`).
4. Проверяет итог:
   - имена уникальны (`assertUniqueTopLevelNames`; разбор строк и комментариев — `blankLiterals`, он один на сборку и тесты);
   - нет управляющих символов (`assertPlainText`);
   - код и стили внутри страницы (`assertCodeInside`);
   - ссылки только на файлы рядом (`assertLocalLinks`, `assertOffline`);
   - страница и поток разбираются движком JS (`assertParses`).
5. Пишет `dist/`: страницу, шрифт, `sw.js` со списком офлайн-кэша, манифест, значки, `guide.html`.

`npm test` — `node --test "test/**/*.test.js"`: около 2900 тестов за несколько секунд. Один тест пропускается без соседнего `../../Sprut.Hub_Tools`.

Тестами закрыты чистые швы:

- модель, файл, таблицы, геометрия;
- кадры `drawScheme` и `volumeDraw` по журналу вызовов `ctx`;
- движок на доме-фикстуре (`test/fixtures/simHome.js`);
- `hubApi` на настоящих сценариях (`test/fixtures/sprut/`);
- бандл Worker, исполненный в Node (`test/buildWorker.test.js`);
- памятка (`test/guidePage.test.js`);
- нормы скорости: медиана после прогрева с запасом ×10.

DOM, вид CSS, IndexedDB и печать не тестируются нарочно. Их проверяет живой прогон: свой сервер, свой Chrome со своим портом, вкладку закрывать, а не перезагружать. Правила — «Живой прогон» в `AGENTS.md`.

## 10. Выкладка

Каждый готовый кусок уходит на прод сразу (договорённость с заказчиком):

```bash
cd /Users/…/Integrator   # корень репозитория
git fetch -q scheme-markup
S=$(git subtree split --prefix=scheme_image HEAD)
git merge-base --is-ancestor scheme-markup/main "$S" && git push -q scheme-markup "${S}:refs/heads/main"
gh run list --repo KirillAshikhmin/scheme-markup --limit 1 --json headSha,status,conclusion
```

В CI две работы: `deploy` (тесты, сборка, публикация) и `dist` — сборка и сверка с `dist/` в git. Вторая публикацию не держит, но краснеет, если `src/` правили без пересборки `dist/`.

Пушить только быстрой перемоткой. Если проверка предка не прошла, значит в прод пушил кто-то ещё: разобраться, а не форсить. Прод — https://kirillashikhmin.github.io/scheme-markup/

## 11. Навигация по коду: ast-index

Индекс собран на весь репозиторий, лежит в кэше `ast-index`, а не в git. Что исключено, задаёт `.ast-index.yaml` в корне: `.claude/`, `graphify-out/`, `tmp/`, `dist/`. Хуки в `.claude/settings.json` обновляют его на старте сессии и после каждой правки файла. Правила поиска — `.claude/rules/ast-index.md`.

```bash
ast-index symbol volumeLampShades           # где объявлено (имена уникальны — ответ один)
ast-index usages canvasCommit               # все места в коде, кроме строк импорта
ast-index callers volumeShadeAlpha          # кто вызывает
ast-index outline scheme_image/src/volume/lamps.js  # все функции и константы файла со строками
ast-index imports scheme_image/src/panels/volume.js
ast-index search LampShade --fuzzy          # по части имени
```

Не символы — значит grep: ключи словаря (`strings.volume.x`, `text("sim.journal." + code)`), поля объекта (`mark.curtainSide`), CSS, слова заказчика в комментариях.

## 12. Где что менять

| Хочу | Где | Не забыть |
|---|---|---|
| Новое поле метки, типа, стены | `model.js` | белые списки полей, `merge.js`, обе трубы миграции, тест на старом объекте (G68) |
| Новая строка интерфейса | `strings.js` | ключ в разметке или `text(...)`, `test/strings.test.js` |
| Новая вещь чертежа | `objectCatalog.js` + `objectViews/objects.js` + `objectModels/objects.js` | один ключ на три реестра |
| Новый вид проёма | `openingCatalog.js` | план, развёртка и «Объём» читают вид через модель (`openingFamilyOf`, `openingHasLeaf`) |
| Новый вид устройства или сервис | `sim/catalog.js` | профиль по коду типа (`typeDeviceOf`), `sim/live.js` для вида на поверхностях |
| Новый код журнала имитации | `sim/engine.js` или хозяин + `strings.sim.journal` | |
| Новый блок сценария | `sim/blocks.js` + `scenarioTree.js` + `panels/scenarioEditor.js` | ADR 011, 018 |
| Свет, тени, пятна в «Объёме» | `volume/lamps.js` | замер кадра до и после (§6.4, `npm run bench`) |
| Новая панель | `panels/x.js` + точка монтирования в `index.html` + `PANEL_IDS` в `app.js` | панели не импортируют друг друга |
| Новая выгрузка | `exporter.js` / `gostSheet.js` + `panels/export.js`; командная строка — `tools/scheme.mjs` | считать у модели, не своим кодом |
