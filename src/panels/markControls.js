// Окно выбора метки: поиск, фильтр по помещению, значок и обозначение — то же,
// что на плане. Одно на всю сборку: им выбирают и подчинённые метки для
// «чем управляет», и метку места для единицы оборудования, и связанные с ней.
//
// Отдельный файл, потому что это диалог со своей жизнью: список меток сбоку
// открывает его и получает ответ, а как он устроен внутри — его дело. В самом
// списке этому коду тесно: строка метки и так собирает семь полей.
import { strings, text } from "../strings.js";
import {
  TYPE_CHANNELS_MAX,
  findMark,
  findRoom,
  labelOf,
  markControlLinks,
  roomsInOrder,
  schemesInOrder,
  typeChannels,
} from "../model.js";
import { shapeIcon } from "../render.js";
import { uiButton, uiEl, uiModal } from "./ui.js";
import { filtersMarkRows } from "./filters.js";

// Кандидаты: метки объекта в том же порядке, что и список сбоку, — схема за
// схемой, внутри по справочнику и номеру. Помещение сужает список: с
// рукописного листа «В3 — на В33 (Т1, Т2, Т3)» видно, что выключатель ищут
// среди светильников своей комнаты.
export function markControlsCandidates(project, excludeId, roomId) {
  const rows = [];
  for (const scheme of schemesInOrder(project)) {
    for (const row of filtersMarkRows(project, scheme.id, { roomId: roomId || null })) {
      if (row.mark.id !== excludeId) rows.push({ ...row, scheme });
    }
  }
  return rows;
}

// По чему ищет строка поиска окна. В строке списка человек видит обозначение,
// название типа и место — по ним и ищем, добавив код типа (его набирают
// вместо названия: «В» вместо «выключатель») и две подписи, которые он сам же
// и писал: расположение словами и обозначение из оригинального проекта.
//
// Помещение в запрос намеренно не входит, хотя поиск в шапке по нему ищет:
// здесь у помещения свой фильтр рядом, и два способа сузить по комнате
// дрались бы — «Кухня» в поиске при фильтре «Спальная» не нашла бы ничего, и
// объяснить это было бы нечем.
function markControlsHaystack(row) {
  return [
    row.label,
    row.type ? row.type.code : "",
    row.type ? row.type.name : "",
    row.mark.location,
    row.mark.original,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

// Буква или цифра — то, что считается серединой слова. Всё остальное
// (пробел, дефис, точка) — граница: «12» обязано находить «L-12».
const MARK_SEARCH_LETTER = /[0-9a-zа-яё]/;

// Запрос ловится с начала слова, а не где попало в строке. Правило не
// украшение: одна буква «В» при поиске серединой строки поднимала весь свет —
// «с-в-етильник», — а Enter отмечает первую строку, и первой оказывалась не
// та. С начала слова «В» — это выключатели, «свет» — светильники, «12» —
// «L-12» из оригинала.
function markControlsHit(haystack, needle) {
  let at = haystack.indexOf(needle);
  while (at >= 0) {
    if (at === 0 || !MARK_SEARCH_LETTER.test(haystack[at - 1])) return true;
    at = haystack.indexOf(needle, at + 1);
  }
  return false;
}

// Подходит ли строка под запрос. Пустой запрос подходит всему: поиск сужает
// список, а не заменяет его.
export function markControlsMatches(row, query) {
  const needle = String(query == null ? "" : query).trim().toLowerCase();
  if (!needle) return true;
  return markControlsHit(markControlsHaystack(row), needle);
}

// Сколько отмеченных меток не видно в показанных строках. Отдельной функцией,
// потому что считают это двое: отрисовка списка и щелчок по галочке, а
// разойдись они — счётчик «Отмечено» соврал бы ровно в тот момент, когда на
// него и смотрят.
export function markControlsHiddenCount(rows, chosen) {
  const shown = new Set((Array.isArray(rows) ? rows : []).map((row) => row.mark.id));
  return [...new Set(Array.isArray(chosen) ? chosen : [])].filter((id) => !shown.has(id)).length;
}

/**
 * Что показать в списке окна: помещение и поиск сужают его вместе, а не
 * отменяют друг друга.
 *
 * Отвечает `{rows, elsewhere, hidden}`:
 * - `rows` — строки списка;
 * - `elsewhere` — сколько нашлось бы, сними фильтр помещения. Считается
 *   только когда в помещении пусто: молча пустой список — плохой ответ, а
 *   «здесь нет, в других — три» окно может и сказать, и предложить;
 * - `hidden` — сколько уже отмеченных меток сейчас не видно. Отмеченное
 *   живёт отдельно от списка и при сужении не теряется, но счётчик
 *   «Отмечено: N» без этого числа выглядел бы соврамши.
 */
export function markControlsView(project, options = {}) {
  const exclude = options.exclude || null;
  const roomId = options.roomId || "";
  const query = options.query || "";
  const chosen = Array.isArray(options.chosen) ? options.chosen : [];
  const rows = markControlsCandidates(project, exclude, roomId).filter((row) => markControlsMatches(row, query));
  const hidden = markControlsHiddenCount(rows, chosen);
  const elsewhere =
    rows.length === 0 && roomId
      ? markControlsCandidates(project, exclude, "").filter((row) => markControlsMatches(row, query)).length
      : 0;
  return { rows, elsewhere, hidden };
}

/**
 * Помещение, с которым окно открывается «для метки».
 *
 * Слова заказчика: «при открытии окна Чем управляет у метки — сразу фильтруй
 * по метке комнаты, для которой выбираем». Случай у него частый: выключатель
 * включает свет в своей же комнате, и выбирать помещение руками каждый раз —
 * лишнее движение.
 *
 * Пустая строка — «Все помещения»: у метки помещения нет, метка не нашлась
 * или помещение успели удалить. Значение только начальное — фильтр остаётся
 * живым, и на «Все помещения» пользователь переключается как раньше.
 */
export function markControlsInitialRoom(project, markId) {
  const mark = markId ? findMark(project, markId) : null;
  if (!mark || !mark.roomId) return "";
  return findRoom(project, mark.roomId) ? mark.roomId : "";
}

/**
 * Окно выбора меток — кирпичами из ui.js: стопка диалогов, Escape и возврат
 * фокуса у них общие.
 * `options`: `{title, hint, chosen: [markId], exclude: markId, multiple,
 * roomId, channels, channelOf}`, где `roomId` — помещение, на котором фильтр
 * стоит при открытии, `channels` — сколько каналов у метки, для которой
 * выбирают, а `channelOf` — уже назначенные каналы (`Map` или функция).
 * Отвечает списком отмеченных меток (в режиме одной — списком из одной) или
 * `null`, если передумали. В режиме одной выбор сразу закрывает окно: лишнее
 * подтверждение там, где выбирают одну строку, только мешает.
 *
 * **Канал спрашивается только там, где он есть.** `channels` больше одного —
 * у каждой строки появляется выбор клавиши; один канал (и любое окно выбора
 * места или связи оборудования) — окно выглядит ровно как раньше, и отвечает
 * оно тогда списком идентификаторов, а не связей с каналом.
 *
 * Поиск и фильтр помещения сужают список вместе; отмеченное живёт отдельно от
 * списка и сужение его не теряет — что из него сейчас не видно, говорит
 * счётчик под списком.
 */
export function openMarkPicker(project, options = {}) {
  return new Promise((resolve) => {
    const multiple = options.multiple !== false;
    const excludeId = options.exclude || null;
    const chosen = new Set(Array.isArray(options.chosen) ? options.chosen : []);
    // Каналов больше одного — у строк появляется выбор клавиши. Один канал:
    // окно то же, что было, и отвечает оно идентификаторами.
    const channelCount = Number.isInteger(options.channels) && options.channels > 1 ? options.channels : 1;
    const pickChannel = multiple && channelCount > 1;
    // Уже назначенные каналы. Живут отдельно от галочек: снял и вернул
    // галочку — канал остался тем же, а не обнулился под рукой.
    const channels = new Map();
    if (typeof options.channelOf === "function") {
      for (const id of chosen) {
        const value = options.channelOf(id);
        if (Number.isInteger(value) && value >= 1) channels.set(id, value);
      }
    }
    const manySchemes = schemesInOrder(project).length > 1;
    const list = uiEl("div", { class: "controls-pick__list" });
    const note = uiEl("p", { class: "controls-pick__note" });
    const rooms = uiEl("select", {
      class: "ui-select",
      title: strings.controls.room,
      on: { change: () => renderList() },
    });
    rooms.append(uiEl("option", { value: "", text: strings.filters.allRooms }));
    for (const room of roomsInOrder(project)) {
      rooms.append(uiEl("option", { value: room.id, text: room.name }));
    }
    // Начальное помещение ставится до первой отрисовки списка — иначе окно
    // моргнуло бы полным списком и тут же сузило его. Значения без своего
    // пункта select не примет и останется на «Все помещения».
    rooms.value = options.roomId || "";

    // Поиск — тем же приёмом, что в окне типа и в окне модели: строка сверху,
    // стрелка вниз уводит в список. `type: "search"` даёт крестик очистки —
    // третьего вида окна здесь не заводим.
    const search = uiEl("input", {
      class: "ui-input",
      type: "search",
      placeholder: strings.controls.search,
      title: multiple ? strings.controls.searchHint : strings.controls.searchHintOne,
      on: {
        input: () => renderList(),
        keydown: (event) => onSearchKey(event),
      },
    });

    // Строки последней отрисовки: Enter и стрелка берут метку отсюда, а не
    // вычитывают её обратно из разметки.
    let shownRows = [];

    function renderNote(hidden = markControlsHiddenCount(shownRows, [...chosen])) {
      if (!multiple) {
        note.textContent = "";
        return;
      }
      // Счётчик считает всё отмеченное, включая спрятанное сужением, — и
      // прямо говорит, сколько его спрятано: иначе «Отмечено: 5» над списком
      // из двух строк читается как ошибка.
      note.textContent =
        hidden > 0
          ? text("controls.chosenHidden", { count: chosen.size, hidden })
          : text("controls.chosen", { count: chosen.size });
    }

    function markLine(row) {
      const room = row.mark.roomId ? findRoom(project, row.mark.roomId) : null;
      // Где метка стоит: помещение, а для многоэтажного объекта — и схема.
      const where = [room ? room.name : "", manySchemes ? row.scheme.name : ""].filter(Boolean).join(" · ");
      return [
        // Метка узнаётся так же, как на плане: обозначение, цвет, форма.
        shapeIcon(row.style.shape, row.style.color, 20),
        uiEl("span", { class: "controls-pick__label", text: row.label }),
        uiEl("span", { class: "controls-pick__name", text: row.type ? row.type.name : "" }),
        uiEl("span", { class: "controls-pick__room", text: where }),
      ];
    }

    // Пустая выдача объясняет себя: «в этом помещении нет, а в других —
    // столько-то» и кнопка, которая снимает фильтр помещения. Молчаливый
    // пустой список заставлял бы гадать, кто из двух фильтров виноват.
    function emptyBox(query, elsewhere) {
      const others = project.marks.some((item) => item.id !== excludeId);
      if (!others) return [uiEl("p", { class: "panel__empty", text: strings.controls.empty })];
      if (elsewhere > 0) {
        return [
          uiEl("p", {
            class: "panel__empty",
            text: query ? text("controls.foundElsewhere", { count: elsewhere }) : strings.controls.nothingFound,
          }),
          uiButton(strings.controls.allRooms, {
            on: {
              click: () => {
                rooms.value = "";
                renderList();
                search.focus();
              },
            },
          }),
        ];
      }
      return [
        uiEl("p", { class: "panel__empty", text: query ? strings.controls.searchEmpty : strings.controls.nothingFound }),
      ];
    }

    /**
     * Выбор канала в строке. Пустой пункт — «канал не указан»: связь без
     * канала законна, и умолчание остаётся за ней.
     *
     * **Канал сверх числа каналов типа в списке остаётся.** Уменьшили число
     * каналов у типа, а связь на третьем осталась: не окажись третьего пункта
     * в списке, окно молча свело бы её к «не указан» — то есть потеряло бы
     * работу, которую никто не просил терять. О таком канале говорит панель
     * предупреждений, а снимает его пользователь руками.
     */
    function channelSelect(row, box) {
      const current = channels.get(row.mark.id) || null;
      const select = uiEl("select", {
        class: "ui-select controls-pick__channel",
        title: strings.controls.channelTitle,
        attrs: { "aria-label": strings.controls.channel },
      });
      select.append(uiEl("option", { value: "", text: strings.controls.channelNone }));
      const values = [];
      for (let value = 1; value <= Math.min(channelCount, TYPE_CHANNELS_MAX); value += 1) values.push(value);
      if (current !== null && !values.includes(current)) values.push(current);
      for (const value of values.sort((first, second) => first - second)) {
        select.append(uiEl("option", { value: String(value), text: text("controls.channelOne", { channel: value }) }));
      }
      select.value = current === null ? "" : String(current);
      // Щелчок по выбору не должен считаться щелчком по строке: строка — это
      // `label`, и она переключила бы галочку заодно.
      select.addEventListener("click", (event) => event.stopPropagation());
      select.addEventListener("change", () => {
        const value = select.value === "" ? null : Number(select.value);
        if (value === null) channels.delete(row.mark.id);
        else channels.set(row.mark.id, value);
        // Назвали клавишу — значит нагрузка эта. Отмечать её ещё и галочкой
        // было бы вторым движением на одно решение.
        if (value !== null && !box.checked) {
          box.checked = true;
          chosen.add(row.mark.id);
          renderNote();
        }
      });
      return select;
    }

    function renderList() {
      const query = search.value;
      const view = markControlsView(project, {
        exclude: excludeId,
        roomId: rooms.value,
        query,
        chosen: [...chosen],
      });
      const rows = view.rows;
      shownRows = rows;
      renderNote(view.hidden);
      if (rows.length === 0) {
        list.replaceChildren(...emptyBox(query.trim(), view.elsewhere));
        return;
      }
      list.replaceChildren(
        ...rows.map((row) => {
          if (!multiple) {
            return uiEl(
              "button",
              {
                class: "controls-pick__row controls-pick__row--one" + (chosen.has(row.mark.id) ? " is-active" : ""),
                type: "button",
                on: { click: () => done([row.mark.id]) },
              },
              markLine(row),
            );
          }
          const box = uiEl("input", { class: "controls-pick__check", type: "checkbox" });
          box.checked = chosen.has(row.mark.id);
          box.addEventListener("change", () => {
            if (box.checked) chosen.add(row.mark.id);
            else chosen.delete(row.mark.id);
            renderNote();
          });
          return uiEl("label", { class: "controls-pick__row" }, [
            box,
            ...markLine(row),
            pickChannel ? channelSelect(row, box) : null,
          ]);
        }),
      );
    }

    // Куда уводит стрелка вниз из поиска и по чему ходят стрелки в списке:
    // галочка в режиме многих, кнопка строки — в режиме одной.
    function rowStops() {
      return [...list.querySelectorAll(".controls-pick__check, .controls-pick__row--one")];
    }

    /**
     * Enter в поиске. В соседних окнах он берёт первую строку и закрывает
     * окно — здесь выбор множественный, и «взять одну и закрыть» потеряло бы
     * остальные. Поэтому Enter **отмечает первую строку и очищает поиск**:
     * набрал «Т1» — Enter, «Т2» — Enter, и так весь список, не трогая мышь.
     * Снять галочку он не может: повторный Enter по уже отмеченной оставляет
     * её отмеченной — иначе быстрый набор молча снимал бы своё же.
     *
     * Пустой поиск Enter не перехватывает: там окно ведёт себя как раньше —
     * `uiModal` нажимает основное действие, «Сохранить связь». Не нашлось
     * ничего — Enter не делает ничего: закрывать окно посреди набранного
     * запроса он не должен.
     *
     * В режиме одной метки окно ничем не отличается от соседних, и Enter в
     * нём тоже берёт первую строку и закрывает окно.
     */
    function onSearchKey(event) {
      if (event.key === "ArrowDown") {
        const first = rowStops()[0];
        if (!first) return;
        event.preventDefault();
        first.focus();
        return;
      }
      if (event.key !== "Enter" || search.value.trim() === "") return;
      event.preventDefault();
      const first = shownRows[0];
      if (!first) return;
      if (!multiple) {
        done([first.mark.id]);
        return;
      }
      chosen.add(first.mark.id);
      search.value = "";
      renderList();
      search.focus();
    }

    // Стрелки по списку — как в окне модели. Вверх с первой строки возвращает
    // в поиск: оттуда пришли, туда и уходим.
    list.addEventListener("keydown", (event) => {
      // В режиме одной метки Enter по строке обязан её выбрать. Свой он здесь
      // потому же, почему в соседних окнах: основное действие этого окна —
      // «Отмена», и `uiModal` нажал бы её раньше, чем браузер превратит Enter
      // в клик по строке, — выбор терялся бы. В режиме галочек Enter не
      // перехватывается: там он по-прежнему «Сохранить связь», а ставит и
      // снимает галочку пробел.
      if (event.key === "Enter" && !multiple) {
        const row = event.target;
        if (!row || !row.classList || !row.classList.contains("controls-pick__row--one")) return;
        event.preventDefault();
        row.click();
        return;
      }
      const step = { ArrowDown: 1, ArrowUp: -1 }[event.key];
      if (!step) return;
      const stops = rowStops();
      const index = stops.indexOf(event.target);
      if (index < 0) return;
      event.preventDefault();
      if (index === 0 && step === -1) {
        search.focus();
        search.select();
        return;
      }
      const next = stops[Math.min(stops.length - 1, index + step)];
      if (next) next.focus();
    });

    renderList();
    let modal;
    const done = (value) => {
      modal.close();
      resolve(value);
    };
    const actions = [uiButton(strings.dialog.cancel, { on: { click: () => done(null) } })];
    if (multiple) {
      actions.push(
        uiButton(strings.controls.save, {
          class: "ui-btn ui-btn--accent",
          on: {
            click: () =>
              done(
                pickChannel
                  ? [...chosen].map((id) => ({ id, channel: channels.get(id) || null }))
                  : [...chosen],
              ),
          },
        }),
      );
    }
    modal = uiModal({
      title: options.title || strings.controls.room,
      // Поиск стоит первым полем окна — и потому, что так устроены соседние
      // окна, и потому, что `uiModal` отдаёт фокус первому полю: открылось —
      // можно набирать.
      body: uiEl("div", { class: "controls-pick" }, [
        options.hint ? uiEl("p", { class: "modal__hint", text: options.hint }) : null,
        search,
        rooms,
        list,
        note,
      ]),
      actions,
      onCancel: () => resolve(null),
    });
  });
}

// «Чем управляет» — тот же выбор, только список берётся у самой метки, а
// фильтр при открытии стоит на её помещении.
//
// Уже отмеченные метки из других помещений фильтр и поиск с глаз убирают, но
// не теряют: отмеченное живёт отдельно от списка, счётчик «Отмечено: N»
// считает их все и говорит, сколько из них сейчас скрыто, а «Сохранить связь»
// возвращает их вместе с новыми.
export async function openMarkControlsPicker(project, markId) {
  const mark = findMark(project, markId);
  const links = markControlLinks(mark);
  const channels = mark ? typeChannels(project, mark.typeId) : 1;
  const picked = await openMarkPicker(project, {
    title: text("controls.title", { label: labelOf(project, markId) }),
    // Подсказка у многоканального типа своя: она объясняет колонку, которой
    // у одноканального нет вовсе.
    hint: channels > 1 ? strings.controls.hint + " " + text("controls.channelHint", { count: channels }) : strings.controls.hint,
    chosen: links.map((link) => link.id),
    exclude: markId,
    multiple: true,
    roomId: markControlsInitialRoom(project, markId),
    channels,
    channelOf: (id) => {
      const link = links.find((item) => item.id === id);
      return link ? link.channel : null;
    },
  });
  if (!picked) return null;
  // Наружу всегда связи, а не идентификаторы: вызывающему не надо помнить, с
  // каким типом он открыл окно.
  return picked.map((item) => (typeof item === "string" ? { id: item, channel: null } : item));
}
