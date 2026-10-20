// Каркас сеанса: состояние, реестр панелей, уведомления.
// Панели других тасков монтируются по идентификатору контейнера из index.html
// и не правят ни этот файл, ни разметку.
import { strings, text } from "./strings.js";
import { getSetting, setSetting } from "./store.js";
// Расположение — одно на три режима, и считает его `screenPlace.js` (таск 178,
// 193). Каркас только кладёт его в настройки и достаёт обратно: второго счёта
// у памяти вида нет.
import { screenPlaceForget, screenPlaceOf, screenPlaceRestore, screenPlaceStored, screenPlaceWatch } from "./screenPlace.js";
// Виды шрифта объявлены там же, где их разбирают в семейства, — в `render.js`.
// Каркас хранит выбранный вид в состоянии сеанса и ничего о нём больше не знает.
import { FONT_DRAFT, FONT_KINDS } from "./render.js";
import { registerServiceWorker } from "./pwa.js";
// Значок кнопки раскладки рисует общий набор — своего рисунка у каркаса нет.
import { uiIcon } from "./panels/ui.js";
// Липкие заголовки колонок: верх умеет браузер, низ — рейка (таск 194).
// Каркас её завязывает и трогает там, где сам меняет высоту разделов.
import { panelRailInset, panelRailJump, panelScrollBox, syncPanelRail, wirePanelRail } from "./panels/rail.js";

// Контейнеры-точки монтирования (идентификаторы из src/index.html).
export const PANEL_IDS = {
  tools: "panel-tools",
  rooms: "panel-rooms",
  sizes: "panel-sizes",
  schemes: "panel-schemes",
  marks: "panel-marks",
  properties: "panel-properties",
  canvas: "canvas-host",
  overlay: "canvas-overlay",
  // Карточка выделенной метки в просмотре: своя точка поверх холста, под
  // подсказкой и кнопкой полного экрана — те в верхних углах, эта внизу.
  canvasCard: "canvas-card",
  // Переключатель режимов экрана (таск 153, G219): по центру того же ряда, где
  // слева подсказка, а справа полный экран. Своя точка, а не общее наложение
  // холста: наложение собирает `canvas.js`, а переключатель живёт в панелях,
  // которые его же и импортируют, — кнопка оттуда замкнула бы сборку в круг.
  canvasModes: "canvas-modes",
  // Поверхности основного экрана: чертёж и объём лежат там же, где план, и
  // показывается ровно одна (таск 153). Окон у них больше нет.
  screenDrawing: "screen-drawing",
  screenVolume: "screen-volume",
  // Верхний блок левой колонки в режиме «Чертёж» и в режиме «Объём» — на месте
  // «Меток». Правая колонка в «Чертеже» — **три списка** элементов (таск 187,
  // G280): стены, проёмы, объекты. Группы «Элементы чертежа» больше нет —
  // заказчик попросил три раскрывающихся списка, как список меток у меток.
  drawTools: "panel-draw-tools",
  drawWalls: "panel-draw-walls",
  drawOpenings: "panel-draw-openings",
  drawObjects: "panel-draw-objects",
  volumeTools: "panel-volume-tools",
  headerActions: "header-actions",
  headerSearch: "header-search",
  headerHistory: "header-history",
  headerWarnings: "header-warnings",
  headerLinks: "header-links",
  // Кнопка «Интерфейс проекта» в шапке (таск 175, G272): на узком экране
  // раздел левой колонки не показывается вовсе, и те же поля приходят окном.
  headerSizes: "header-sizes",
  projectActions: "project-actions",
  dialogs: "dialog-host",
};

// ——— три режима основного экрана (таск 153, G219) ————————————————————————
//
// Заказчик: «надо на их уровне по центру добавить переключатель — Чертёж,
// Схема, Объём. Чтобы переключать контент, а не в окне показывать чертёж и
// объём».
//
// Порядок — порядок самого переключателя и порядок работы: сперва чертят
// (Чертёж), потом размечают (Схема), потом смотрят, что вышло (Объём). Схема
// стоит посередине не ради красоты: она главная, и из неё одинаково близко в
// обе стороны.
export const SCREEN_MODES = ["drawing", "scheme", "volume"];
// Объект открывается схемой: размечают чаще, чем чертят и смотрят, и это
// единственный режим, который есть всегда и у всякого объекта.
export const SCREEN_DEFAULT = "scheme";
// Чем режим разрешён. Умение, а не отдельный список: «Чертёж» — правка объекта
// и на узком экране его нет ровно потому, что там нет никакой правки, а
// «Объём» только смотрит и на планшете остаётся. Разойдись эти два списка — на
// телефоне появился бы режим, в котором нечем работать.
export const SCREEN_ABILITIES = {
  drawing: "editDrawing",
  scheme: "viewPlan",
  volume: "viewVolume",
};

const appState = {
  layout: "desktop",
  // Что показано на основном экране: план, чертёж или объём (таск 153, G219).
  //
  // **В объект режим не пишется** (G68): иначе напарник, открывший файл,
  // попадал бы в чужой объём. А вот в настройках браузера он с таска 193
  // помнится (G294, слова заказчика: «запоминай выбранный режим и расположение
  // в браузере, что бы при обновлении страницы вид не менялся») — память
  // привязана к объекту и живёт рядом с остальными выключателями показа,
  // разбор у `VIEW_SETTING`. Прежнее правило «объект всегда открывается
  // Схемой» (таск 153) этим и отменено: оно остаётся только для объекта, у
  // которого памяти ещё нет.
  screen: SCREEN_DEFAULT,
  project: null,
  schemeId: null,
  selectedMarkIds: [],
  // Путь в правке: у него видны ручки вершин. Режим руки, а не свойство
  // разметки, — в объект и в файл проекта он не попадает.
  editPathId: null,
  // Выделенная стена чертежа и сторона, с которой смотрят её развёртку
  // (таск 129). Тоже режим руки: в объект не попадает, при смене схемы
  // снимается.
  selectedWallId: null,
  wallSide: "left",
  // Линейка и направляющие видны, пока их не спрятали.
  guidesShown: true,
  // Два выключателя слоёв плана (таск 127). Оба — **выбор глаз**, личная
  // настройка браузера, а не свойство объекта: на одном компьютере размечают
  // по фотографии, на другом по своему чертежу, и объект при этом один.
  //
  // Умолчание — показано и то и другое: человек, который чертил, хочет видеть
  // чертёж, а человек без чертежа не увидит никакой разницы (G68).
  planShown: true,
  drawingShown: true,
  // Сетка чертежа и притяжка к её узлам (таск 187, G281). Жили они отдельной
  // парой отметок в колонке чертежа, и в «Интерфейсе» их не было вовсе —
  // заказчик попросил свести все переключатели показа в один раздел. Природа
  // у них та же, что у подложки: выбор глаз, личная настройка браузера, в
  // `project.json` не попадает. Шаг сетки, в отличие от них, принадлежит
  // объекту (G258) и лежит в `project.view.gridStepMm`.
  gridShown: true,
  gridSnap: true,
  // Наложенный чужой чертёж (таск 208, G315). Слова заказчика: «нужно
  // наложение чертежей, что бы подогнать один к другому. Также через меню
  // интерфейса и только стены и другим цветом».
  //
  // Здесь лежит **идентификатор схемы**, чей чертёж подложен под свой, или
  // `null`. Отметки «да/нет» мало: схем в объекте бывает три и пять, и
  // «наложено» без имени не отвечает на «что я вижу».
  //
  // **Не помнится между сеансами, и это решение, а не недосмотр.** Остальные
  // слои — вид, которым человек работает месяцами; наложение — оснастка
  // подгонки на несколько минут. К тому же оно называет схему конкретного
  // объекта: всплыви она через неделю над другим планом — это была бы загадка,
  // а не удобство. Поэтому ключа в настройках браузера у него нет, и в
  // `project.json` — тем более.
  overlaySchemeId: null,
  // Полоса развёртки выделенной стены (таск 133, G185). Выключатель той же
  // природы, что два выше: выбор глаз, а не свойство объекта.
  //
  // Умолчание — показана, и это не забывчивость. На холсте стену нельзя ни
  // подвинуть, ни поправить — её выделяют ровно затем, чтобы посмотреть
  // развёртку, другого смысла у клика по стене там нет. Выключатель нужен
  // тому, кто размечает поверх своего чертежа и не хочет, чтобы полоса
  // выезжала от промаха мимо метки.
  elevationShown: true,
  // Изображения объектов на развёртке вместо условных знаков (таск 135,
  // G187). Заказчик предложил и место для отметки — «можно прямо на окне с
  // развёрткой», — и она там и стоит.
  //
  // Умолчание — показаны: ради этого таск и затеян («что бы схема была уже
  // живая»), а отметка нужна тому, кто хочет прежний лист со знаками.
  elevationViews: true,
  // Нижняя граница масштаба мелких вещей на развёртке (таск 179, дефект D42).
  // Слова заказчика: «на развёртке розетки и выключатели слишком большие,
  // рисуй всё в реальном масштабе».
  //
  // Умолчание — **снято**: лист рисуется реальным масштабом, и линейка, к нему
  // приложенная, не врёт. Отметка возвращает прежнюю границу тому, кому важнее
  // узнать вещь в лицо, чем померить её: на стене девяти метров розетка
  // выходит шестью точками. Той же природы, что «изображения», — личная
  // настройка браузера, в объект не попадает и уходит в выгрузку.
  elevationGrow: false,
  // Вещи чертежа на экране (таск 154, G223). Два выключателя одной природы:
  // `objectsShown` — «скрыть все объекты» разом, `hiddenObjectIds` — те, что
  // спрятаны поштучно глазком в списке элементов чертежа.
  //
  // **Это экран, а не объект** — слова заказчика прямые: «на экране, а для
  // выгрузок у нас же свои параметры видимости». Поэтому отметка живёт в
  // настройках браузера, а не в `project.json`: уехав в файл, она пришла бы к
  // напарнику вместе с проектом и спрятала бы ему чужую работу. PNG, лист
  // ГОСТ и развёртки её не спрашивают вовсе — у них свои галки.
  objectsShown: true,
  hiddenObjectIds: [],
  // Связи меток на плане: умолчание — «нет». Это разбор, а не чертёж, и
  // встречать пользователя дугами поверх плана никто не просил.
  linksShown: false,
  // Шрифт подписей на экране. Умолчание чертёжное: заказчик сам просил шрифт
  // на схеме, и подписи там прописные, где претензий к нему нет.
  schemeFont: FONT_DRAFT,
  activeTypeId: null,
  mode: "select",
  filter: { categoryIds: null, typeIds: null, roomId: null, query: "" },
  view: { zoom: 1, offsetX: 0, offsetY: 0 },
  dirty: false,
};

// Разделы колонок: заголовок сворачивает свой раздел, состояние переживает
// перезагрузку. Имена — из `data-section-id` в разметке.
export const SECTION_IDS = {
  marks: "marks",
  rooms: "rooms",
  schemes: "schemes",
  // Имя раздела осталось `sizes`, а подпись стала «Интерфейс» (таск 153 —
  // «Интерфейс проекта», таск 187 — просто «Интерфейс»): по ключу помнится
  // свёрнутость, и переименуй его — у всех, кто уже работает, раздел
  // развернулся бы обратно.
  sizes: "sizes",
  markList: "markList",
  properties: "properties",
  // Верхние блоки левой колонки режимов «Чертёж» и «Объём» и три списка
  // элементов чертежа в правой (таск 153, разделённые в таске 187).
  // Сворачиваются и помнятся так же, как остальные: логика панелей не меняется
  // ни на йоту. Прежний `drawList` из сохранённого списка отбрасывается сам —
  // `sectionListFrom` знает только нынешние имена.
  drawTools: "drawTools",
  drawWalls: "drawWalls",
  drawOpenings: "drawOpenings",
  drawObjects: "drawObjects",
  volumeTools: "volumeTools",
};
export const SECTIONS_SETTING = "collapsedSections";
// Колонки целиком: на планшете две по 264 точки съедают весь экран, и холсту
// на 600 оставалось 72. Свёрнутая колонка ужимается до ручки у края —
// состояние живёт в настройках браузера и переживает перезагрузку, как
// свёрнутые разделы и отметка линейки.
export const PANEL_SIDES = ["left", "right"];
export const PANELS_SETTING = "collapsedPanels";
// Линейка и направляющие: отметка рабочего места, а не свойство объекта.
// Живёт в настройках браузера и переживает перезагрузку.
export const GUIDES_SETTING = "schemeGuidesShown";
// Подложка и чертёж: что видно на холсте и что уходит в выгрузку.
export const PLAN_SETTING = "schemePlanShown";
export const DRAWING_SETTING = "schemeDrawingShown";
// Сетка чертежа и притяжка к её узлам (таск 187): такие же личные настройки
// браузера, как подложка. До переезда в «Интерфейс» они не помнились вовсе —
// жили в памяти страницы и слетали с перезагрузкой.
export const GRID_SETTING = "drawingGridShown";
export const GRID_SNAP_SETTING = "drawingGridSnap";
// Полоса развёртки выделенной стены — третий выключатель того же ряда.
export const ELEVATION_SETTING = "schemeElevationShown";
// Изображения объектов на развёртке — такая же личная настройка браузера.
export const ELEVATION_VIEWS_SETTING = "elevationViews";
// Нижняя граница масштаба мелких вещей на развёртке (таск 179, D42) — такая же
// личная настройка браузера, и умолчание у неё снятое.
export const ELEVATION_GROW_SETTING = "elevationGrow";
// Вещи чертежа: «скрыть все» и список спрятанных поштучно (таск 154, G223).
// Второй ключ хранит карту «объект → список вещей»: объектов у человека
// несколько, и прятать в одном вещь из другого было бы дико.
export const OBJECTS_SETTING = "schemeObjectsShown";
export const HIDDEN_OBJECTS_SETTING = "hiddenSchemeObjects";
// ——— память вида: режим, схема и расположение (G294, таск 193) ——————————
//
// Слова заказчика: «А ещё запоминай выбранный режим и расположение в браузере,
// что бы при обновлении страницы вид не менялся».
//
// **В браузере, а не в объекте** (G68, и заказчик сказал это сам): вид — не
// свойство квартиры, и, уехав в файл, он пришёл бы к напарнику вместе с
// проектом. Поэтому ключ лежит здесь, рядом с подложкой и линейкой.
//
// **Привязана к объекту:** в ключе карта «объект → вид», как у спрятанных
// вещей. Открыли другой объект — у него своё место, а не чужое; открыли
// впервые — прежнее поведение (схема, подгонка плана по первому кадру).
//
// Что помнится: режим (`screen`), открытая схема (`schemeId`) и расположение —
// середина поля в миллиметрах чертежа и экранных точек на миллиметр
// (`place`, разбор в `screenPlace.js`). Расположение одно на три режима, и
// объём встаёт по нему камерой: своего числа у памяти нет.
//
// **Чего здесь нет:** занятия (выделение против добавления). Оно сбрасывается
// при всяком переключении режима (G296) и тем более при перезагрузке: вернуться
// в «Добавление» после обновления страницы значило бы поставить метку первым же
// кликом по плану.
export const VIEW_SETTING = "screenView";
// Сколько объектов помним. Карта крошечная (четыре числа на объект), но расти
// без края ей незачем: объекты удаляют, а ключи остались бы навсегда.
export const VIEW_MEMORY_MAX = 20;
// Последний открытый объект: с него начинается следующий сеанс. Ключ лежит
// здесь, рядом с остальными, а не в панели объектов: его пишет и панель
// объектов, и панель файла (объект, пришедший из архива, тоже становится
// последним), а панели друг друга не знают.
export const LAST_PROJECT_KEY = "lastProjectId";
// Связи меток: та же природа, что у линейки, — оснастка разбора, а не свойство
// разметки. Живёт в настройках браузера, переживает перезагрузку, в объект и в
// файл проекта не попадает.
export const LINKS_SETTING = "markLinksShown";
// Шрифт подписей на экране: чертёжный или системный (G172). Той же природы,
// что линейка и связи, — выбор глаз, а не свойство разметки. В объект не
// попадает нарочно: уехав туда, он навязался бы напарнику и менял бы файл при
// каждом переключении. Бумаги и выгрузки не касается вовсе — там чертёжный
// всегда, это чертёж по ГОСТ.
export const SCHEME_FONT_SETTING = "schemeFontKind";
// На первом запуске свёрнуты «Размеры»: их трогают один раз и надолго, а
// место они отнимают у списка схем. Всё остальное открыто — иначе новый
// пользователь ищет, куда делись инструменты.
export const SECTION_DEFAULT_COLLAPSED = [SECTION_IDS.sizes];

// ——— раскладка: широкий экран правит, узкий смотрит ————————————————————
//
// На объекте в руке телефон: нужно открыть план, найти метку, свериться с
// таблицей. Размечать пальцем пользователь не собирался с самого брифинга,
// поэтому узкий экран получает не урезанный редактор, а режим просмотра.
// Решение о режиме — чистое, его и проверяют тесты: разъехаться оно может
// незаметно, а цена — панель, которой на экране нет.
export const LAYOUT_MODES = ["desktop", "mobile"];
// Окно уже этого — раскладка просмотра. На десктопе это же и есть способ
// посмотреть мобильный вид: сузить окно.
export const LAYOUT_NARROW_WIDTH = 860;
// Короткая сторона телефона: поворот её не меняет, поэтому альбомная
// ориентация остаётся просмотром, а не превращается в редактор на 844 px.
export const LAYOUT_PHONE_SIDE = 560;

// Что доступно в каждой раскладке. Список нарочно перечислен целиком: новое
// умение нужно назвать здесь, иначе оно считается правкой и на телефон не идёт.
export const LAYOUT_ABILITIES = {
  viewPlan: ["desktop", "mobile"],
  switchProject: ["desktop", "mobile"],
  switchScheme: ["desktop", "mobile"],
  markList: ["desktop", "mobile"],
  filters: ["desktop", "mobile"],
  tables: ["desktop", "mobile"],
  exportFiles: ["desktop", "mobile"],
  openFile: ["desktop", "mobile"],
  search: ["desktop", "mobile"],
  // Предупреждения — про правку объекта: в них отвечают на вопрос о виде типа
  // и идут чинить найденное. В просмотре чинить нечем, а место в шапке дорого.
  warnings: ["desktop"],
  // Связи ушли с узких раскладок (таск 163, G242) прямым словом заказчика:
  // «спрячь кнопку отображения связей, тогда на смартфоне вся верхняя панель
  // должна уместиться в 1 строку». Прежний довод («спрашивают и с телефона,
  // стоя перед щитом») он этим и отменил, а взамен на телефоне остаётся то,
  // ради чего туда смотрят: **выделенная метка показывает свои связи и с
  // выключенным переключателем** — это правило старше кнопки и её не касается.
  //
  // В меню выгрузок кнопке места нет: связи — слой показа, а не выгрузка, и
  // значок принтера над ней соврал бы. В «Интерфейсе проекта», где стоят
  // остальные выключатели показа, ей место по смыслу — но этот раздел на узком
  // экране не показывается вовсе (`styles.css`), так что переезд туда был бы
  // тем же исчезновением, только ещё и с переездом на большом экране, где
  // заказчик ничего менять не просил.
  markLinks: ["desktop"],
  // Объёмный режим (таск 146) тоже только читает, и по смыслу ему место в обоих
  // видах. Сенсорное управление появилось (таск 149) — и слово в списке
  // изменилось: пальцем в окне ходят площадкой в углу поля, вертят головой по
  // всему полю и щиплют двумя пальцами в обзоре, так что кнопка в режиме
  // просмотра больше не обещает того, чем нельзя воспользоваться.
  viewVolume: ["desktop", "mobile"],
  // Мастерская чертежа (таск 153): стены рисуют цепочкой в миллиметрах, и это
  // правка объекта — в просмотре её нет, как нет постановки меток. Своё умение,
  // а не `editSchemes`: тот про список схем (имя, порядок, удаление), и
  // разреши чертёж вместе с ним — на телефоне появился бы режим с инструментами
  // и без возможности ими воспользоваться.
  editDrawing: ["desktop"],
  undo: ["desktop"],
  saveFile: ["desktop"],
  editMarks: ["desktop"],
  editSchemes: ["desktop"],
  editRooms: ["desktop"],
  editProject: ["desktop"],
  dictionary: ["desktop"],
  // «Интерфейс проекта» — размер меток и подписей, шрифт, слои и масштаб —
  // пришёл на телефон окном (таск 175, G272): «в мобильной вёрстке добавь
  // кнопку в шапку „Интерфейс проекта“, которая откроет тоже самое, что в
  // левой колонке, но в окне». Это не правка разметки: все поля отвечают на
  // «как я это вижу», и на объекте с телефона их и крутят — подписи мелкие,
  // подложка мешает, план надо вписать. Раздел в колонке при этом на узком
  // экране по-прежнему не показывается (`styles.css`): дверь к полям одна —
  // кнопка в шапке, а сборка полей одна на оба места.
  viewSizes: ["desktop", "mobile"],
};

export function layoutModeFor(view, override) {
  if (override === "mobile" || override === "desktop") return override;
  const source = view || {};
  const width = Number(source.width) || 0;
  const height = Number(source.height) || 0;
  const shortSide = height > 0 ? Math.min(width, height) : width;
  if (source.coarsePointer && shortSide > 0 && shortSide <= LAYOUT_PHONE_SIDE) return "mobile";
  if (width > 0 && width <= LAYOUT_NARROW_WIDTH) return "mobile";
  return "desktop";
}

// Неизвестное умение доступным не считается: опечатка в имени спрячет кнопку,
// а не пустит правку в режим просмотра.
export function layoutAllows(ability, mode) {
  const modes = LAYOUT_ABILITIES[ability];
  return Array.isArray(modes) && modes.includes(mode);
}

// ——— кадр: один планировщик на три поверхности ————————————————————————
//
// `requestAnimationFrame` есть везде, где эта страница работает, но не в Node:
// чистые куски поверхностей проверяются тестами, и падать там нельзя. Отсюда
// запасной `setTimeout` в шестнадцать миллисекунд — кадр шестидесяти в
// секунду. До таска 173 эта пара была переписана шесть раз (холст дважды,
// чертёж дважды, объём дважды), а отмена — четыре.

const FRAME_MS = 16;

/** Нарисовать в следующем кадре. Возвращает ключ, которым кадр отменяют. */
export function scheduleFrame(fn) {
  return typeof requestAnimationFrame === "function" ? requestAnimationFrame(fn) : setTimeout(fn, FRAME_MS);
}

/** Отменить заказанный кадр. */
export function cancelFrame(id) {
  if (typeof cancelAnimationFrame === "function") cancelAnimationFrame(id);
  else clearTimeout(id);
}

// ——— режимы и раскладка: чистые правила ————————————————————————————————

// Неизвестный режим недоступен, как и неизвестное умение: опечатка уводит
// человека на схему, а не оставляет его на пустом экране.
export function screenAllowed(screen, layout) {
  const ability = SCREEN_ABILITIES[screen];
  return Boolean(ability) && layoutAllows(ability, layout);
}

// Что показывает переключатель в этой раскладке. На узком экране кнопок две:
// «Чертёж» там не умеет ничего, и кнопка, которая ничего не делает, хуже
// отсутствующей — то же правило, по которому на телефоне нет кнопки отмены.
export function screensFor(layout) {
  return SCREEN_MODES.filter((screen) => screenAllowed(screen, layout));
}

// Экран сузили, а человек стоял в чертеже — его возвращают на схему. То же
// правило, по которому вход в просмотр снимает режим постановки меток: режим,
// в котором на этом экране нечем работать, оставлять нельзя.
export function screenAfterLayout(screen, layout) {
  return screenAllowed(screen, layout) ? screen : SCREEN_DEFAULT;
}

const appCollapsed = new Set();
const appPanelsHidden = new Set();
let appLayoutOverride = null;
let appSheet = "none";

// Что кладётся в настройки: список свёрнутых разделов. Мусор из хранилища
// (чужая версия, битое значение) не должен схлопывать панель — он отбрасывается.
export function sectionListFrom(value) {
  if (!Array.isArray(value)) return [];
  const known = new Set(Object.values(SECTION_IDS));
  return [...new Set(value.filter((id) => typeof id === "string" && known.has(id)))];
}

// Чего ещё не выбирал пользователь — то показываем по умолчанию; пустой
// сохранённый список означает «всё развёрнуто», а не «умолчание».
export function sectionStartList(saved) {
  return saved == null ? [...SECTION_DEFAULT_COLLAPSED] : sectionListFrom(saved);
}

// Что кладётся в настройки: список свёрнутых колонок. Мусор из хранилища
// (чужая версия, битое значение) колонки не прячет.
export function panelListFrom(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((side) => PANEL_SIDES.includes(side)))];
}

export function panelsAfterToggle(list, side, collapsed) {
  const next = new Set(panelListFrom(list));
  if (!PANEL_SIDES.includes(side)) return [...next];
  if (collapsed) next.add(side);
  else next.delete(side);
  return [...next];
}

export function sectionsAfterToggle(list, id, collapsed) {
  const next = new Set(sectionListFrom(list));
  if (!Object.values(SECTION_IDS).includes(id)) return [...next];
  if (collapsed) next.add(id);
  else next.delete(id);
  return [...next];
}

const appSubscribers = new Set();
const appPanels = new Map();
const appMounted = new Map();
let appStarted = false;

// Снимок: вложенные filter/view/selectedMarkIds копируются, чтобы правка
// на месте в панели не меняла состояние сеанса мимо setState.
export function getState() {
  return {
    ...appState,
    selectedMarkIds: [...appState.selectedMarkIds],
    hiddenObjectIds: [...appState.hiddenObjectIds],
    filter: { ...appState.filter },
    view: { ...appState.view },
  };
}

// Спрятанные вещи чертежа по объектам: `{идентификатор объекта: [id вещей]}`.
// Карта целиком лежит в памяти страницы и в настройках браузера, а в состоянии
// сеанса — только список текущего объекта: панели спрашивают «спрятана ли эта
// вещь», а не «в каком объекте что спрятано».
let appHiddenObjects = {};
let appHiddenProjectId = null;

// Сменился объект — меняется и список спрятанного. Делается это **внутри**
// `setState`, до оповещения: иначе подписчик успел бы нарисовать новый объект
// со списком от прежнего, и у него погасла бы вещь, которую никто не прятал.
function syncHiddenObjects(changed) {
  const projectId = appState.project ? appState.project.id : null;
  if (projectId === appHiddenProjectId) return;
  appHiddenProjectId = projectId;
  const saved = projectId && Array.isArray(appHiddenObjects[projectId]) ? appHiddenObjects[projectId] : [];
  if (saved.length === 0 && appState.hiddenObjectIds.length === 0) return;
  appState.hiddenObjectIds = [...saved];
  changed.hiddenObjectIds = appState.hiddenObjectIds;
}

/**
 * Спрятать вещь чертежа с экрана или вернуть её. Глазок в списке элементов
 * зовёт только это.
 *
 * Список чистится о живые вещи объекта: вещь удалили — её id в настройках не
 * остаётся, иначе однажды он достался бы другой вещи. В объект при этом не
 * пишется ничего (G68).
 */
export function setObjectHidden(objectId, hidden) {
  if (!objectId) return;
  const next = new Set(appState.hiddenObjectIds);
  if (hidden) next.add(objectId);
  else next.delete(objectId);
  const alive = new Set(((appState.project && appState.project.schemeObjects) || []).map((object) => object.id));
  const kept = [...next].filter((id) => alive.has(id));
  setState({ hiddenObjectIds: kept });
  const projectId = appState.project ? appState.project.id : null;
  if (!projectId) return;
  appHiddenObjects = { ...appHiddenObjects, [projectId]: kept };
  if (kept.length === 0) delete appHiddenObjects[projectId];
  Promise.resolve(setSetting(HIDDEN_OBJECTS_SETTING, appHiddenObjects)).catch(() => {});
}

// ——— память вида: чистые правила ————————————————————————————————————————

/**
 * Что из настроек годится в память вида. Мусор (чужая версия, правка руками)
 * отбрасывается молча: лучше прежнее поведение, чем объект, открывшийся в
 * режиме «undefined».
 */
export function viewMemoryFrom(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const map = {};
  for (const [id, entry] of Object.entries(value)) {
    if (!id || !entry || typeof entry !== "object") continue;
    const kept = {};
    if (SCREEN_MODES.includes(entry.screen)) kept.screen = entry.screen;
    if (typeof entry.schemeId === "string" && entry.schemeId) kept.schemeId = entry.schemeId;
    const place = screenPlaceStored(entry.place);
    if (place) kept.place = place;
    if (Object.keys(kept).length > 0) map[id] = kept;
  }
  return map;
}

/** Что ложится в память про этот объект: режим, схема и расположение. */
export function viewMemoryEntry(state, place) {
  const entry = {};
  if (state && SCREEN_MODES.includes(state.screen)) entry.screen = state.screen;
  if (state && state.schemeId) entry.schemeId = state.schemeId;
  const stored = screenPlaceStored(place);
  if (stored) entry.place = stored;
  return entry;
}

/**
 * Что из памяти применить, когда объект открылся. Возвращает заплатку для
 * состояния — и она же отвечает за прежнее поведение: памяти нет, режим в ней
 * чужой или в этой раскладке его не бывает — открывается схема (таск 153).
 *
 * Схема из памяти берётся только если она у объекта есть: удалённая схема
 * оставила бы пустой экран, а открывший объект уже выбрал первую.
 *
 * `options.picked` — **человек уже выбрал режим сам** (дефект D54): тогда
 * режима в заплатке нет вовсе, ни сохранённого, ни умолчания. Объект
 * догружается секунду-две, и выбор, сделанный человеком за это время, старше
 * всего, что лежит в памяти.
 */
export function viewMemoryPatch(entry, project, layout, options = {}) {
  const patch = {};
  if (!options.picked) {
    patch.screen = entry && screenAllowed(entry.screen, layout) ? entry.screen : SCREEN_DEFAULT;
  }
  const schemes = (project && project.schemes) || [];
  if (entry && entry.schemeId && schemes.some((scheme) => scheme.id === entry.schemeId)) {
    patch.schemeId = entry.schemeId;
  }
  return patch;
}

// ——— память вида: хранилище ————————————————————————————————————————————
//
// Карта лежит в памяти страницы и в настройках браузера; применяется она
// **один раз на объект** — в тот миг, когда объект открылся.
//
// **Выбор человека старше сохранённого** (дефект D54). Объект поднимается из
// базы не мгновенно: в живых прогонах человек успевал переключить режим до
// того, как он доедет, — и позднее применение памяти перебивало его выбор
// через секунду-две после загрузки. Поэтому у первого объекта сеанса (его
// никто не просил открывать — он поднимается сам, как последний открытый)
// сохранённый режим применяется только если человек ещё не выбрал своего.
// Объект, который человек открыл руками, — другое дело: он просил объект, а не
// режим, и память этого объекта старше.
let appViewMemory = null;
let appViewProjectId = null;
let appViewFirst = true;
let appScreenPicked = false;
let appViewTimer = null;

function syncViewMemory(changed) {
  const projectId = appState.project ? appState.project.id : null;
  if (projectId === appViewProjectId) return;
  appViewProjectId = projectId;
  // Новый объект — чужое место забыто: середина прежнего в новом ничего не
  // значит, а масштаб тем более.
  screenPlaceForget();
  if (appViewMemory === null) return;
  const patch = viewMemoryApply(projectId);
  if (!patch) return;
  for (const [key, value] of Object.entries(patch)) {
    if (appState[key] === value) continue;
    appState[key] = value;
    changed[key] = value;
  }
}

/**
 * Поднять память этого объекта. Возвращает заплатку состояния (её применяет
 * либо `setState`, либо — если память доехала позже объекта — сам вызывающий).
 * Место при этом ставится **до** заплатки: поверхности читают его, когда
 * узнают о новом режиме, и опоздай оно — чертёж встал бы не туда.
 */
function viewMemoryApply(projectId) {
  if (!projectId) return null;
  const entry = appViewMemory ? appViewMemory[projectId] : null;
  // Первый объект сеанса поднимается сам (последний открытый), и человека о нём
  // не спрашивали: его выбор режима, сделанный пока объект ехал, старше
  // сохранённого (D54). Объект, открытый руками, — другое дело: человек просил
  // объект, а не режим, и память **этого** объекта старше.
  const patch = viewMemoryPatch(entry, appState.project, appState.layout, {
    picked: appViewFirst && appScreenPicked,
  });
  appViewFirst = false;
  if (entry && entry.place) screenPlaceRestore(patch.schemeId || appState.schemeId, entry.place);
  return patch;
}

/** Записать память этого объекта — не чаще, чем раз в полсекунды. */
function saveViewMemory() {
  if (typeof setTimeout !== "function") return;
  if (appViewTimer) clearTimeout(appViewTimer);
  appViewTimer = setTimeout(() => {
    appViewTimer = null;
    const projectId = appState.project ? appState.project.id : null;
    if (!projectId || appViewMemory === null) return;
    const entry = viewMemoryEntry(appState, screenPlaceOf(appState.schemeId));
    if (Object.keys(entry).length === 0) return;
    const next = { ...appViewMemory };
    // Ключ переставляется в конец: по порядку видно, какой объект забыть
    // первым, когда их станет больше потолка.
    delete next[projectId];
    next[projectId] = entry;
    const ids = Object.keys(next);
    for (const id of ids.slice(0, Math.max(0, ids.length - VIEW_MEMORY_MAX))) delete next[id];
    appViewMemory = next;
    Promise.resolve(setSetting(VIEW_SETTING, next)).catch(() => {});
  }, 500);
}

export function setState(patch) {
  if (!patch) return getState();
  const changed = {};
  for (const [key, value] of Object.entries(patch)) {
    if (appState[key] !== value) {
      appState[key] = value;
      changed[key] = value;
    }
  }
  syncHiddenObjects(changed);
  syncViewMemory(changed);
  if ("screen" in changed || "schemeId" in changed) saveViewMemory();
  if (Object.keys(changed).length === 0) return getState();
  const snapshot = getState();
  for (const subscriber of [...appSubscribers]) {
    try {
      subscriber(snapshot, changed);
    } catch (error) {
      reportAppError(error);
    }
  }
  syncCanvasClass();
  syncScreenClass();
  return snapshot;
}

export function subscribe(listener) {
  appSubscribers.add(listener);
  return () => appSubscribers.delete(listener);
}

// Регистрация панели: если каркас уже поднят — монтируем сразу.
export function registerPanel(id, mountFn) {
  if (typeof mountFn !== "function") return;
  appPanels.set(id, mountFn);
  if (appStarted) mountPanel(id);
}

export function panelApi() {
  return { getState, setState, subscribe, notify, strings, text };
}

function mountPanel(id) {
  const mountFn = appPanels.get(id);
  const host = document.getElementById(id);
  if (!mountFn || !host || appMounted.get(id) === mountFn) return;
  try {
    mountFn(host, panelApi());
    appMounted.set(id, mountFn);
  } catch (error) {
    reportAppError(error);
  }
}

export function notify(message, kind = "info") {
  const host = typeof document === "undefined" ? null : document.getElementById("notifications");
  if (!host) return null;
  const toast = document.createElement("div");
  toast.className = "toast toast--" + kind;
  toast.textContent = String(message);
  toast.title = strings.notify.close;
  toast.addEventListener("click", () => toast.remove());
  host.append(toast);
  setTimeout(() => toast.remove(), kind === "error" ? 12000 : 6000);
  return toast;
}

function reportAppError(error) {
  // Стек уходит в консоль, а человеку достаётся плашка: без стека такую
  // ошибку ловят вслепую, а показывать его в плашке незачем.
  if (typeof console !== "undefined" && console.error) console.error(error);
  notify(error && error.message ? error.message : String(error), "error");
}

// Все видимые строки приходят из словаря: разметка держит только ключи.
export function applyStrings(root) {
  const scope = root || document;
  for (const node of scope.querySelectorAll("[data-text]")) {
    node.textContent = text(node.dataset.text);
  }
  for (const node of scope.querySelectorAll("[data-title]")) {
    node.title = text(node.dataset.title);
  }
}

// Имени открытой схемы в шапке больше нет (таск 175, G271). Оно стояло только
// на узком экране — «Схема дома» в его собственных словах, — и места ему там
// доставалось полсотни точек из трёхсот шестидесяти: читалось «Схема до…».
// Названа открытая схема в листе «Схемы», и это предлагалось ещё в таске 163,
// когда имя мерили строкой шапки; заказчик выбрал убрать.

function syncCanvasClass() {
  const app = document.getElementById("app");
  if (!app) return;
  app.classList.toggle("has-scheme", Boolean(appState.schemeId));
}

// Режим экрана — отметкой на корне страницы: по ней стили решают, какая
// поверхность видна и какие разделы стоят в колонках. Класса здесь нет
// нарочно — режим один из трёх, и три класса рассинхронизировались бы.
function syncScreenClass() {
  const app = document.getElementById("app");
  if (!app) return;
  app.dataset.screen = appState.screen;
  // Режим меняет состав разделов в обеих колонках — рейке заголовков это
  // переезд всех её строк сразу.
  syncPanelRail();
}

export function screenMode() {
  return appState.screen;
}

/**
 * Режим меняется одной дверью: отметка на корне, панели и поверхности узнают о
 * нём из `subscribe`. Недоступный в этой раскладке режим не включается — иначе
 * переключатель обещал бы то, чего на этом экране нет.
 *
 * **Переключение сбрасывает занятие** (G296, таск 193). Слова заказчика: «при
 * переключении между схема\чертёж\объем у первых двух сбрасывай режим на
 * Выделение с Добавления». У плана занятие лежит здесь, в состоянии сеанса, — и
 * сбрасывается оно в одной заплатке с режимом: подписка холста на `mode` сама
 * дочерчивает начатое **со словами** (`canvasSyncDraft` → `canvasSettleDraft`,
 * таск 172), то есть порядок «сперва дочертить, потом сбросить» держится
 * механикой, а не очередью вызовов. Занятие чертежа сбрасывает сам чертёж (там
 * оно внутри поверхности), и по тому же правилу.
 *
 * Сбрасывается **занятие**, а не выбор: тип метки (`activeTypeId`) и выбранная
 * вещь остаются — вернулся и ставишь то же, но первым кликом ничего не
 * поставишь. Место и масштаб тоже остаются (G294, G276): помнится вид, не
 * занятие. Так и записано, чтобы следующий не «починил» одно из двух.
 *
 * Отметка «человек выбрал режим сам» ставится здесь же: по ней память вида
 * понимает, что её сохранённое значение младше (D54).
 */
export function setScreen(screen) {
  if (!screenAllowed(screen, appState.layout)) return;
  appScreenPicked = true;
  if (appState.screen === screen) return;
  setState(appState.mode === "select" ? { screen } : { screen, mode: "select" });
}

function layoutViewport() {
  if (typeof window === "undefined") return { width: 0, height: 0, coarsePointer: false };
  return {
    width: window.innerWidth,
    height: window.innerHeight,
    coarsePointer:
      typeof window.matchMedia === "function" && window.matchMedia("(pointer: coarse)").matches,
  };
}

// Раскладка, которую выбрал бы сам экран: по ней видно, показывать ли переход
// к полной версии. На настоящем десктопе кнопки нет вовсе — второго режима
// работы там не заводим.
export function layoutAutoMode() {
  return layoutModeFor(layoutViewport(), null);
}

export function layoutMode() {
  return appState.layout;
}

export function layoutOverride() {
  return appLayoutOverride;
}

export function setLayoutOverride(mode) {
  appLayoutOverride = mode === "mobile" || mode === "desktop" ? mode : null;
  syncLayout();
}

// Лист снизу: на узком экране колонки показываются по одной и поверх плана.
export function openSheet(name) {
  appSheet = name === "schemes" || name === "marks" ? name : "none";
  syncSheet();
}

export function currentSheet() {
  return appSheet;
}

function syncSheet() {
  const app = document.getElementById("app");
  if (!app) return;
  app.dataset.sheet = appState.layout === "mobile" ? appSheet : "none";
  for (const button of document.querySelectorAll("[data-sheet-button]")) {
    const target = button.dataset.sheetButton;
    const active = app.dataset.sheet === target || (target === "none" && app.dataset.sheet === "none");
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", active ? "true" : "false");
  }
}

function syncLayout() {
  const mode = layoutModeFor(layoutViewport(), appLayoutOverride);
  const app = document.getElementById("app");
  if (app) app.classList.toggle("is-mobile", mode === "mobile");
  if (mode !== "mobile") appSheet = "none";
  const toggle = document.getElementById("layout-toggle");
  if (toggle) {
    // Кнопка живёт только там, где экран сам выбрал просмотр: на телефоне —
    // дорога к полной версии, на десктопе её нет и быть не должно.
    toggle.hidden = layoutAutoMode() !== "mobile";
    // Значком, а не словом: «Полная версия» занимала в шапке 127 точек — на
    // восьмидюймовом планшете это разница между одной строкой и двумя. Карандаш
    // и глаз — пара «править / смотреть»; слово при этом не потеряно, оно в
    // подсказке и в `aria-label`, как у остальных кнопок-значков.
    const toEdit = mode === "mobile";
    const label = toEdit ? strings.mobile.full : strings.mobile.view;
    toggle.className = "ui-btn ui-btn--icon";
    toggle.replaceChildren(toEdit ? uiIcon("edit") : uiIcon("view"));
    toggle.title = toEdit ? strings.mobile.fullHint : strings.mobile.viewHint;
    toggle.setAttribute("aria-label", label);
  }
  if (appState.layout !== mode) {
    // Вход в просмотр снимает режим постановки: в суженном окне мышь никуда не
    // делась, и оставленный «Точка» ставил бы метки там, где их не ждут.
    setState(mode === "mobile" ? { layout: mode, mode: "select" } : { layout: mode });
  }
  // И по той же причине — режим экрана: окно сузили, а человек стоял в
  // чертеже, которого в просмотре нет вовсе (таск 153).
  const screen = screenAfterLayout(appState.screen, mode);
  if (screen !== appState.screen) setState({ screen });
  syncSheet();
}

function wireLayout() {
  syncLayout();
  const toggle = document.getElementById("layout-toggle");
  if (toggle) {
    toggle.addEventListener("click", () =>
      setLayoutOverride(appState.layout === "mobile" ? "desktop" : null),
    );
  }
  for (const button of document.querySelectorAll("[data-sheet-button]")) {
    button.addEventListener("click", () => {
      const target = button.dataset.sheetButton;
      openSheet(appSheet === target ? "none" : target);
    });
  }
  if (typeof window === "undefined") return;
  let timer = null;
  const later = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(syncLayout, 120);
  };
  window.addEventListener("resize", later);
  window.addEventListener("orientationchange", later);
}

function sectionNode(id) {
  return typeof document === "undefined" ? null : document.querySelector('[data-section-id="' + id + '"]');
}

// Свёрнутый раздел — это только заголовок с повёрнутой галочкой: пустым он не
// выглядит, и место соседям отдаёт целиком.
function applySectionState(id) {
  const node = sectionNode(id);
  if (!node) return;
  const collapsed = appCollapsed.has(id);
  node.classList.toggle("is-collapsed", collapsed);
  // Состояние живёт на галочке: у неё одно дело — сворачивать, и держится оно
  // за ней, где бы заголовок ни был нарисован. У имени раздела дело меняется
  // от места (таск 198), и обещать голосу «свёрнуто/развёрнуто» ему нечем.
  const fold = node.querySelector("[data-section-fold]");
  if (fold) {
    const label = collapsed ? strings.panels.unfold : strings.panels.fold;
    fold.setAttribute("aria-expanded", collapsed ? "false" : "true");
    fold.setAttribute("aria-label", label);
    fold.title = label;
  }
  // Свернули раздел — разделы ниже переехали, и рейка заголовков устарела.
  // Наблюдатель за размерами поймал бы это и сам, но на кадр позже.
  syncPanelRail();
}

export function setSectionCollapsed(id, collapsed) {
  if (collapsed) appCollapsed.add(id);
  else appCollapsed.delete(id);
  applySectionState(id);
  setSetting(SECTIONS_SETTING, [...appCollapsed]);
}

export function toggleSection(id) {
  setSectionCollapsed(id, !appCollapsed.has(id));
}

// ——— колонки целиком: ручка у края ——————————————————————————————————
//
// Кнопки в шапке у этого нет нарочно: на восьмидюймовом планшете там уже тесно,
// и прятать колонку должна ручка у её собственного края — она стоит там, где
// колонка кончается, и после сворачивания остаётся на том же месте у края
// экрана. Искать её не нужно: она не уезжает.

export function panelHidden(side) {
  return appPanelsHidden.has(side);
}

function applyPanelState(side) {
  const app = document.getElementById("app");
  if (!app) return;
  const hidden = appPanelsHidden.has(side);
  app.classList.toggle(side === "left" ? "is-left-hidden" : "is-right-hidden", hidden);
  const handle = document.querySelector('[data-panel-toggle="' + side + '"]');
  if (!handle) return;
  const label = strings.panels[(hidden ? "show" : "hide") + (side === "left" ? "Left" : "Right")];
  handle.title = label;
  handle.setAttribute("aria-label", label);
  handle.setAttribute("aria-expanded", hidden ? "false" : "true");
}

export function setPanelHidden(side, hidden) {
  if (!PANEL_SIDES.includes(side)) return;
  if (hidden) appPanelsHidden.add(side);
  else appPanelsHidden.delete(side);
  applyPanelState(side);
  setSetting(PANELS_SETTING, [...appPanelsHidden]);
}

export function togglePanel(side) {
  setPanelHidden(side, !appPanelsHidden.has(side));
}

function wirePanels() {
  for (const handle of document.querySelectorAll("[data-panel-toggle]")) {
    handle.append(uiIcon("chevron"));
    handle.addEventListener("click", () => togglePanel(handle.dataset.panelToggle));
  }
  for (const side of PANEL_SIDES) applyPanelState(side);
  // Настройка читается асинхронно, как у разделов: страница стартует с обеими
  // колонками и прячет их, когда хранилище ответит.
  Promise.resolve(getSetting(PANELS_SETTING))
    .then((saved) => {
      for (const side of panelListFrom(saved)) {
        appPanelsHidden.add(side);
        applyPanelState(side);
      }
    })
    .catch(() => {});
}

// Кто-то зовёт раздел со стороны (кнопка «Помещения» в справочнике): развернуть
// и подвести к глазам — вместо второго окна, делающего то же самое.
export function revealSection(id) {
  setSectionCollapsed(id, false);
  const node = sectionNode(id);
  if (!node) return;
  revealSectionScroll(node);
  node.classList.add("is-called");
  setTimeout(() => node.classList.remove("is-called"), 1200);
}

// Подвести позванный раздел к глазам. `scrollIntoView` сюда не годится: он
// считает «видимым» и то, что стоит под рейкой заголовков, — позванный раздел
// подъехал бы к нижней кромке и спрятался за заголовками тех, что ниже его.
// Поэтому край кадра считается по рейке, а подводится раздел своим верхом: его
// заголовок — то, что человек и ищет глазами после подсветки.
function revealSectionScroll(node) {
  const box = panelScrollBox(node);
  if (!box) {
    if (typeof node.scrollIntoView === "function") node.scrollIntoView({ block: "nearest" });
    return;
  }
  const frame = box.getBoundingClientRect();
  const rect = node.getBoundingClientRect();
  // Кадр закрыт с обеих сторон лестницами заголовков (таск 201): сверху —
  // разделы, которые уехали выше, снизу — те, что ещё ниже.
  const high = frame.top + panelRailInset(node, "top");
  const low = frame.bottom - panelRailInset(node, "bottom") - rect.height;
  if (rect.top >= high && rect.top <= low) return;
  box.scrollTop += rect.top - high;
}

// Счётчик в заголовке: по свёрнутому разделу видно, пуст он или там сорок схем.
export function setSectionBadge(id, value) {
  const node = sectionNode(id);
  if (!node) return;
  const badge = node.querySelector(".panel__badge");
  if (badge) badge.textContent = value == null || value === "" ? "" : String(value);
}

function wireSections() {
  for (const button of document.querySelectorAll("[data-section]")) {
    button.addEventListener("click", () => {
      // Имя раздела: на своём месте — прежняя кнопка сворачивания, у кромки
      // колонки — указатель на раздел (таск 198, G303). Слова заказчика:
      // «нажал — прыгнуло туда — да, так и надо, а то приходится самому
      // листать, это не очевидно». Где нарисован заголовок и куда от него
      // листать — знает рейка, и спрашивают её, а не меряют заново.
      if (panelRailJump(button)) return;
      toggleSection(button.dataset.section);
    });
  }
  // Галочка слева от имени: сворачивает всегда — и когда раздел на виду, и
  // когда от него виден один заголовок в рейке. Без неё свернуть невидимый
  // раздел было бы нечем, а именно так прячут список меток, чтобы добраться до
  // справочника типов.
  for (const button of document.querySelectorAll("[data-section-fold]")) {
    button.addEventListener("click", () => toggleSection(button.dataset.sectionFold));
    // Подпись голосу ставится сразу, а не с первого нажатия: внутри кнопки один
    // знак, и до первого сворачивания она читалась бы пустой.
    applySectionState(button.dataset.sectionFold);
  }
  // Настройки читаются асинхронно: разделы стартуют развёрнутыми и схлопываются,
  // когда хранилище ответит. Ждать его с пустым экраном хуже.
  Promise.resolve(getSetting(SECTIONS_SETTING))
    .then((saved) => {
      for (const id of sectionStartList(saved)) {
        appCollapsed.add(id);
        applySectionState(id);
      }
    })
    .catch(() => {});
  // Та же история у линейки: страница стартует с ней, и она гаснет, когда
  // хранилище ответит «спрятана».
  Promise.resolve(getSetting(GUIDES_SETTING))
    .then((saved) => {
      if (saved === false) setState({ guidesShown: false });
    })
    .catch(() => {});
  // Подложка и чертёж: оба стартуют показанными и гаснут по настройке.
  Promise.resolve(getSetting(PLAN_SETTING))
    .then((saved) => {
      if (saved === false) setState({ planShown: false });
    })
    .catch(() => {});
  Promise.resolve(getSetting(DRAWING_SETTING))
    .then((saved) => {
      if (saved === false) setState({ drawingShown: false });
    })
    .catch(() => {});
  Promise.resolve(getSetting(ELEVATION_SETTING))
    .then((saved) => {
      if (saved === false) setState({ elevationShown: false });
    })
    .catch(() => {});
  // Сетка чертежа и притяжка (таск 187): обе стартуют взведёнными и гаснут по
  // настройке — то же правило, что у подложки.
  Promise.resolve(getSetting(GRID_SETTING))
    .then((saved) => {
      if (saved === false) setState({ gridShown: false });
    })
    .catch(() => {});
  Promise.resolve(getSetting(GRID_SNAP_SETTING))
    .then((saved) => {
      if (saved === false) setState({ gridSnap: false });
    })
    .catch(() => {});
  Promise.resolve(getSetting(ELEVATION_VIEWS_SETTING))
    .then((saved) => {
      if (saved === false) setState({ elevationViews: false });
    })
    .catch(() => {});
  // Умолчание у границы снятое (D42), поэтому поднимается **взведённая**
  // отметка: сравнение с `true`, а не с `false`, как у соседей сверху.
  Promise.resolve(getSetting(ELEVATION_GROW_SETTING))
    .then((saved) => {
      if (saved === true) setState({ elevationGrow: true });
    })
    .catch(() => {});
  // Вещи чертежа: «скрыть все» и карта спрятанных поштучно. Карта читается
  // целиком, а в состояние ложится список того объекта, который к этой минуте
  // открыт, — объект поднимается из базы тоже не сразу.
  Promise.resolve(getSetting(OBJECTS_SETTING))
    .then((saved) => {
      if (saved === false) setState({ objectsShown: false });
    })
    .catch(() => {});
  Promise.resolve(getSetting(HIDDEN_OBJECTS_SETTING))
    .then((saved) => {
      if (!saved || typeof saved !== "object") return;
      appHiddenObjects = saved;
      const projectId = appState.project ? appState.project.id : null;
      const list = projectId && Array.isArray(appHiddenObjects[projectId]) ? appHiddenObjects[projectId] : [];
      if (list.length > 0) setState({ hiddenObjectIds: [...list] });
    })
    .catch(() => {});
  // Связи, наоборот, стартуют спрятанными и зажигаются, когда хранилище
  // ответит «показаны».
  Promise.resolve(getSetting(LINKS_SETTING))
    .then((saved) => {
      if (saved === true) setState({ linksShown: true });
    })
    .catch(() => {});
  // Шрифт схемы: стартует чертёжным и меняется, если в настройках лежит другой
  // известный вид. Чужое слово игнорируется — лучше умолчание, чем схема без
  // шрифта из-за опечатки в хранилище.
  Promise.resolve(getSetting(SCHEME_FONT_SETTING))
    .then((saved) => {
      if (FONT_KINDS.includes(saved) && saved !== FONT_DRAFT) setState({ schemeFont: saved });
    })
    .catch(() => {});
  // Память вида (G294): карта «объект → режим, схема, расположение». Читается
  // асинхронно, как остальные настройки, и объект к этой минуте может быть ещё
  // не открыт — тогда она применится сама, когда он откроется.
  //
  // А если объект уже открылся, пока хранилище отвечало, — применяем сейчас, и
  // **с оговоркой D54**: выбор человека старше сохранённого. Этот путь и есть
  // то позднее применение, из-за которого режим сам возвращался через
  // секунду-две после загрузки.
  Promise.resolve(getSetting(VIEW_SETTING))
    .then((saved) => {
      appViewMemory = viewMemoryFrom(saved);
      if (!appViewProjectId) return;
      const patch = viewMemoryApply(appViewProjectId);
      if (patch) setState(patch);
    })
    .catch(() => {
      appViewMemory = {};
    });
  // Место и масштаб пишутся в ту же память. Поле говорит о них на каждый кадр,
  // поэтому запись отложенная — иначе в хранилище летело бы по шестьдесят
  // записей в секунду на одно перетаскивание плана.
  screenPlaceWatch(() => saveViewMemory());
}

export function startApp() {
  if (appStarted) return;
  appStarted = true;
  applyStrings(document);
  wireSections();
  wirePanels();
  syncCanvasClass();
  syncScreenClass();
  wireLayout();
  for (const id of appPanels.keys()) mountPanel(id);
  // Рейка завязывается после панелей: разделы в разметке стоят с самого начала,
  // а вот высоты у них появляются, когда панели в них что-то положили.
  wirePanelRail();
  // Веб-версия заодно просит служебный скрипт: установленное приложение
  // обязано открываться и без сети. Со страницы на диске это ничего не делает.
  registerServiceWorker();
}

// Старт откладывается за границу текущего скрипта: в собранном файле панели
// и модели определяются ниже по бандлу, и каркас не должен опережать их.
if (typeof document !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", startApp, { once: true });
  } else {
    setTimeout(startApp, 0);
  }
}
