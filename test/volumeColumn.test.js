// Объём живёт в левой колонке (таск 231, требования G348, G349, G350, G351).
//
// Слова заказчика: «в режиме Объём как будто справа панель убрать надо, а слева
// оставить блок Объём и добавить туда Параметры объёма, что сейчас в окне.
// А ещё по умолчанию отключи показ потолка», и следом про окно: «окно должно
// быть в мобильном интерфейсе и в полноэкранном».
//
// Разойтись здесь есть чему, и молча:
//
//   **правой колонки нет только в «Объёме»** — в «Схеме» и в «Чертеже» она
//     цела, а свёрнутость её помнится и переживает заход в объём;
//   **на узкой раскладке колонка не колонка**, а лист снизу по кнопке «Метки»:
//     убери её там — и кнопка открывала бы пустой лист;
//   **ряды параметров собираются один раз** (G351): колонка и окно обязаны
//     показывать одно и то же, а две сборки разойдутся на первой же правке;
//   **умолчание крыши** — взведённое, и отличить «не трогал» от «вернул крышу»
//     можно только по тому, что лежит в хранилище.
//
// Стили читаются как текст: зелёный прогон про них не говорит ничего (сборка
// склеивает их текстом), поэтому правила сверяются здесь — так же, как в
// `fieldBare` сверяются углы поля.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { getSetting } from "../src/store.js";
import { volumeParamsHome } from "../src/panels/volumeParams.js";

const APP_CSS = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
const VOLUME_CSS = readFileSync(new URL("../src/panels/volume.css", import.meta.url), "utf8");
const VOLUME_JS = readFileSync(new URL("../src/panels/volume.js", import.meta.url), "utf8");
const PARAMS_JS = readFileSync(new URL("../src/panels/volumeParams.js", import.meta.url), "utf8");

/** Исходник без строчных комментариев: разбор решения — не код. */
function code(text) {
  return text
    .split("\n")
    .filter((line) => !line.trim().startsWith("//"))
    .join("\n");
}

// ——— правой колонки в «Объёме» нет (G348) ————————————————————————————————

test("в «Объёме» правая колонка отдаёт полю всю свою ширину, а не прячется поверх", () => {
  // Дорожка сетки, а не `display: none` на одной колонке: от спрятанной колонки
  // осталась бы пустая полоса в 264 точки — ровно то, чего просили не оставлять.
  const width = APP_CSS.indexOf('#app[data-screen="volume"]:not(.is-mobile) {');
  assert.ok(width >= 0, "правила «в объёме правой колонки нет» не стало");
  const body = APP_CSS.slice(APP_CSS.indexOf("{", width) + 1, APP_CSS.indexOf("}", width));
  assert.match(body, /--right-column:\s*0px;/, "колонка в объёме забирает себе ширину: " + body.trim());
  // Левая колонка не трогается ни на точку: в ней и живут вид, этаж и параметры.
  assert.doesNotMatch(body, /--left-column/, "в объёме уехала и левая колонка");
});

test("прячется сама колонка и её ручка — возвращать в объёме нечего", () => {
  const at = APP_CSS.indexOf('#app[data-screen="volume"]:not(.is-mobile) #panel-right');
  assert.ok(at >= 0, "правило, прячущее правую колонку в объёме, пропало");
  const selectors = APP_CSS.slice(at, APP_CSS.indexOf("{", at));
  assert.ok(selectors.includes("#panel-right"), "колонка осталась на экране");
  assert.ok(selectors.includes(".panel-handle--right"), "ручка осталась, а колонки за ней нет");
  // Левая ручка цела: левую колонку в объёме сворачивают, как в остальных режимах.
  assert.ok(!selectors.includes(".panel-handle--left"), "заодно уехала и левая ручка");
  const body = APP_CSS.slice(APP_CSS.indexOf("{", at) + 1, APP_CSS.indexOf("}", at));
  assert.match(body, /display:\s*none;/);
});

test("правило весит больше памяти свёрнутости — иначе колонка вернулась бы ручкой", () => {
  // `#app.is-right-hidden` ужимает колонку до ручки (18 точек). Нуль объёма
  // обязан перебить это: иначе в объёме от колонки осталась бы полоска, и поле
  // не получило бы её место. Вес считается правилами каскада: у правила объёма
  // атрибут плюс `:not(.is-mobile)` — это два класса против одного.
  const hidden = APP_CSS.indexOf("#app.is-right-hidden {");
  const volume = APP_CSS.indexOf('#app[data-screen="volume"]:not(.is-mobile) {');
  assert.ok(hidden >= 0 && volume > hidden, "правило объёма должно стоять ниже памяти свёрнутости");
  // А сама память не трогается: класс остаётся на корне, и в «Схеме» колонка
  // находится такой, какой её оставили. Ни одного `classList` про неё в объёме.
  assert.doesNotMatch(code(VOLUME_JS), /is-right-hidden|collapsedPanels/, "объём полез в память колонок");
});

test("на узкой раскладке список меток остаётся: там колонка приходит листом", () => {
  // Поля правая колонка на телефоне не занимает ни точки — её открывают кнопкой
  // «Метки» в нижнем ряду, — и это единственное место, где с планшета виден
  // список меток. Убери её там, и кнопка открывала бы пустой лист.
  for (const selector of [
    '#app[data-screen="volume"]:not(.is-mobile) {',
    '#app[data-screen="volume"]:not(.is-mobile) #panel-right',
  ]) {
    assert.ok(APP_CSS.includes(selector), "правило перестало исключать узкую раскладку: " + selector);
  }
  // Раздел списка меток в объёме по-прежнему объявлен видимым — он и приходит
  // в лист. Прячет его в обычной раскладке колонка целиком, а не он сам.
  assert.ok(
    APP_CSS.includes('#app[data-screen="volume"] [data-section-id="markList"]'),
    "список меток в объёме убрали разделом — на телефоне он пропал бы вместе с листом",
  );
});

test("в «Схеме» и в «Чертеже» колонка цела", () => {
  // Правило одно и названо режимом: других режимов в нём нет ни одного.
  const at = APP_CSS.indexOf('#app[data-screen="volume"]:not(.is-mobile) #panel-right');
  const selectors = APP_CSS.slice(at, APP_CSS.indexOf("{", at));
  assert.doesNotMatch(selectors, /data-screen="scheme"|data-screen="drawing"/);
  for (const section of ["drawWalls", "drawOpenings", "drawObjects", "markList", "properties"]) {
    assert.ok(
      APP_CSS.includes('[data-section-id="' + section + '"]'),
      "раздел правой колонки пропал из стилей: " + section,
    );
  }
});

// ——— ряды параметров: одна сборка на колонку и на окно (G349, G351) ————————

test("где живут параметры, решает одно место, и ответов у него три", () => {
  // Обычная раскладка — колонка; узкая и полный экран — окно. Довода два, и оба
  // приходят от поля: своего знания про раскладку у параметров нет.
  assert.equal(volumeParamsHome("desktop", false), "column");
  assert.equal(volumeParamsHome("mobile", false), "window");
  assert.equal(volumeParamsHome("desktop", true), "window");
  // В полном экране окно и на телефоне: два «нет колонки» друг друга не спорят.
  assert.equal(volumeParamsHome("mobile", true), "window");
  // Неизвестная раскладка — колонка: пустое поле не должно отбирать параметры
  // у того, у кого колонка есть.
  assert.equal(volumeParamsHome(undefined, undefined), "column");
});

test("ряды собираются один раз: ни колонка, ни окно не строят своих", () => {
  // Это главный урок таска 183 («вынесен общий скелет, окна остались четырьмя»)
  // и прямое требование G351: содержимое у колонки и у окна одно.
  const rows = code(PARAMS_JS);
  // Пять подписей групп — «ЧТО ПОКАЗЫВАТЬ», «ТИП ФОНА», «ВРЕМЯ СУТОК»,
  // «УСКОРЕНИЕ», «ХОДЬБА» — и каждая объявлена ровно один раз: вторая значила
  // бы вторую сборку тех же рядов.
  assert.equal(
    rows.split('class: "tools__label"').length - 1,
    5,
    "подписей групп в рядах должно быть пять — по одной на группу",
  );
  for (const key of ["floorsLabel", "backdrop", "clock", "speed", "walking"]) {
    const found = rows.match(new RegExp("text: strings\\.volume\\." + key + "\\b", "g")) || [];
    assert.equal(found.length, 1, "подпись группы собрана не один раз: " + key);
  }
  // Поля часа и даты тоже по одному: два разных поля времени разошлись бы в
  // первую же минуту.
  for (const name of ["tools__time", "tools__date"]) {
    assert.equal(rows.split('class: "' + name + '"').length - 1, 1, "поле собрано дважды: " + name);
  }
  // Окно берёт ряды у общей сборки, а не строит их.
  assert.match(rows, /body:\s*fields\.node/, "окно перестало брать ряды у общей сборки");
  assert.equal(
    rows.split("createVolumeParamsFields({").length - 1,
    1,
    "окно собирает ряды не одним вызовом общей сборки",
  );
  // Поле зовёт ту же сборку для колонки и передаёт **те же двери**, что окну:
  // час, рассвет, этажи и переход по ним считаются один раз.
  const field = code(VOLUME_JS);
  assert.match(field, /createVolumeParamsFields\(paramsDoors\)/, "колонка собирает ряды своими доводами");
  assert.match(field, /createVolumeParams\(paramsDoors\)/, "окно получает не те же двери, что колонка");
  // Своих рядов параметров поле не строит ни одного: подписи групп и поля часов
  // в нём не упоминаются вовсе.
  assert.doesNotMatch(field, /strings\.volume\.(backdrop|speed|minimap|roofOff)\b/, "поле завело свои ряды");
});

test("кнопку на поле показывает и прячет поле, а место закрывает и окно", () => {
  const field = code(VOLUME_JS);
  // Ответ один и спрашивается у `volumeParamsHome`; поле только отдаёт ему
  // раскладку и полный экран.
  assert.match(field, /volumeParamsHome\(getState\(\)\.layout, bare\(\)\)/, "поле считает место параметров само");
  assert.match(field, /paramsFields\.node\.hidden = home !== "column"/);
  assert.match(field, /paramsButton\.shown\(home === "window"\)/);
  // Смена раскладки доходит до параметров: сцена от неё не меняется, и общий
  // отбор подписки их бы не позвал.
  assert.match(field, /if \("layout" in changed\) syncParamsHome\(\)/, "переезд при смене раскладки потерян");
  // Закрывшееся место закрывает открытое окно: окно над полем, у которого
  // параметры уже в колонке, и было бы тем вторым путём, которого не хотят.
  assert.match(code(PARAMS_JS), /shown\(on\) \{[\s\S]*?open\.close\(\)/, "окно не закрывается вместе с кнопкой");
});

test("в колонке у рядов своей ширины нет — 260 точек остались окну", () => {
  // Колонка — 264 точки, тело раздела уже её на поля. Мера `min-width: 260px`
  // жила на самих рядах с таска 181, когда они бывали только в окне: оставь её
  // там — и ряды вылезли бы из колонки, которая их теперь носит.
  assert.ok(VOLUME_CSS.includes(".volume__params--window {"), "мера окна не названа своим правилом");
  const at = VOLUME_CSS.indexOf(".volume__params--window {");
  const body = VOLUME_CSS.slice(VOLUME_CSS.indexOf("{", at) + 1, VOLUME_CSS.indexOf("}", at));
  assert.match(body, /min-width:\s*260px/);
  assert.doesNotMatch(VOLUME_CSS, /\n\.volume__params \{/, "у рядов снова завелась своя ширина");
  // Класс окна ставится только окну, и ставит его общая сборка по доводу.
  assert.match(code(PARAMS_JS), /volume__params--window/, "класс окна перестал ставиться");
});

// ——— крыша по умолчанию снята (G350) —————————————————————————————————————
//
// Слова заказчика: «А ещё по умолчанию отключи показ потолка». Прочитано это
// как **крыша сверху** — вторая сторона потолка, которую снимает отметка таска
// 212, — а не как потолок над головой от первого лица: комната без потолка
// выглядит недостроенной, и вид изнутри таск 212 нарочно не менял ни на пиксель.
//
// Отличить «не трогал» от «вернул крышу на место» можно только по хранилищу,
// поэтому проверка идёт через него: пустой ключ — умолчание, записанное `false`
// — выбор человека, и он старше нового умолчания.

/** Доехали все до единого микрозадания: настройки читаются обещаниями. */
function settled() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

test("крыша снята по умолчанию, а возвращённая руками остаётся возвращённой", async () => {
  // Свежий экземпляр модуля: умолчание читается до того, как хранилище
  // ответило, — ровно как его читает первый кадр поля.
  const clean = await import("../src/panels/volumeParams.js?roof=clean");
  assert.equal(clean.volumeParamsRead().roofOff, true, "объём открылся с крышей на месте");
  assert.equal(
    await getSetting(clean.VOLUME_ROOF_SETTING),
    null,
    "в хранилище лежит отметка, хотя её никто не ставил",
  );
  clean.volumeParamsLoad();
  await settled();
  assert.equal(clean.volumeParamsRead().roofOff, true, "пустое хранилище сбило умолчание");

  // Человек вернул крышу — выбор записан, и записан именно `false`: по нему и
  // отличают «вернул» от «не трогал».
  clean.volumeParamsFlag("roofOff", false);
  assert.equal(clean.volumeParamsRead().roofOff, false);
  await settled();
  assert.equal(await getSetting(clean.VOLUME_ROOF_SETTING), false, "выбор человека не записался");

  // Новый сеанс: умолчание стоит до ответа хранилища, а ответ его перебивает.
  const stored = await import("../src/panels/volumeParams.js?roof=stored");
  assert.equal(stored.volumeParamsRead().roofOff, true);
  stored.volumeParamsLoad();
  await settled();
  assert.equal(
    stored.volumeParamsRead().roofOff,
    false,
    "новое умолчание перебило выбор человека — он снова без крыши",
  );
  // Снял галку обратно — снова взведено, и в хранилище `true`.
  stored.volumeParamsFlag("roofOff", true);
  await settled();
  assert.equal(await getSetting(stored.VOLUME_ROOF_SETTING), true);
});

test("отметка крыши читается положительным правилом, вместе с миникартой", () => {
  // Умолчание взведено, значит правило чтения — «`false` значит снято»
  // (`saved !== false`), а не «`true` значит взведено». Перепутай их — и
  // умолчание молча вернулось бы к крыше на месте: лежащий в хранилище `false`
  // прочитался бы как «не трогали».
  const rows = code(PARAMS_JS);
  const positive = rows.slice(rows.indexOf("VOLUME_MINIMAP_SETTING, \"minimap\""));
  const block = positive.slice(0, positive.indexOf("}\n"));
  assert.ok(block.includes('VOLUME_ROOF_SETTING, "roofOff"'), "крыша уехала из положительного правила");
  assert.ok(positive.includes("saved !== false"), "правило чтения не «false значит снято»");
  // И в отрицательном правиле её нет: иначе читали бы дважды и спорили.
  const negative = rows.slice(rows.indexOf("VOLUME_FLOORS_SETTING, \"floorsAll\""));
  assert.ok(
    !negative.slice(0, negative.indexOf("}\n")).includes("VOLUME_ROOF_SETTING"),
    "крыша читается двумя правилами разом",
  );
  // В объект не пишется ничего (G68): ключ знает только окно параметров.
  assert.ok(
    PARAMS_JS.includes('"volumeRoofOff"'),
    "имя настройки уехало из своего места",
  );
});
