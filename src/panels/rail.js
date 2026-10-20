// Рейка заголовков: что ниже кадра — то у нижней кромки колонки.
//
// Слова заказчика (таск 194, G295): «помимо sticky headers сверху, он должен
// быть и снизу. Что бы группы были видны всегда». К верху заголовок липнет
// сам — `position: sticky` в `.panel__head`. К низу чистым CSS не выходит, и
// упирается это не в подбор чисел, а в правило: клетка, в которой `sticky`
// разрешено двигать заголовок, — его собственный раздел. Чтобы показать
// заголовок раздела, который ещё **ниже** кадра, его надо поднять выше своего
// раздела — а туда sticky не ходит и ходить не может.
//
// Трюк, которым это делают чистым CSS, один: разложить все заголовки прямыми
// детьми прокручиваемой колонки и выдать каждому свой `top` и свой `bottom`
// ступенькой. Он умеет и верх и низ, но платит двумя вещами, на которых стоит
// колонка: раздел перестаёт быть флекс-ящиком (а им делится высота и им
// сворачивается тело — таск 153, таск 175), и сверху заголовки начинают
// копиться лестницей. Верх колонки заказчик уже принял в таске 175, и менять
// его этот таск не просил.
//
// **Приём: заголовок остаётся на своём месте в раскладке, а рисуется ниже —
// `transform: translateY`.** Место под заголовком остаётся за ним, высота
// содержимого и прокрутка не меняются ни на точку (а значит, не дёргается ни
// ползунок, ни подведённая к глазам строка), трансформация не заставляет
// браузер пересобирать раздел.
//
// **Цена.** Её платит прокрутка: раз в кадр колонка меряет прямоугольники
// своих разделов и пишет трансформации. Поэтому здесь всё, что можно, сделано
// дешёвым: один `requestAnimationFrame` на кадр на обе колонки, чтения (пять
// прямоугольников на колонку) идут отдельно от записей, а запись в CSS-меру
// (`--panel-rail`, `--panel-head`) и класс идут только на смену значения —
// наследуемая мера, переписанная вслепую, пересчитала бы стили у всех
// восьмидесяти строк списка. Сложить рейку в один DOM-узел и показывать в ней
// клоны заголовков было бы дешевле на чтениях, но клон — это второй заголовок:
// своя подстановка строк, свой счётчик, свой `aria-expanded` и своя подсветка
// позванного раздела. Второго заголовка в сборке быть не должно.
//
// **Нажатие на заголовок у кромки перелистывает к его разделу** (таск 198,
// G303). Слова заказчика: «нажал — прыгнуло туда — да, так и надо, а то
// приходится самому листать, это не очевидно». Таск 194 решил иначе — узел в
// рейке тот же самый, значит и нажатие то же, — и довод был: придумывать
// кнопке второй смысл в зависимости от того, где она нарисована, хуже.
// Заказчик этот довод отклонил, и правило теперь такое: **заголовок, стоящий
// не на своём месте, — указатель на раздел, а не кнопка сворачивания**.
// Одинаково для обеих кромок: прижатый браузером к верхней (раздел начался
// выше кадра) и поднятый рейкой к нижней ведут себя одним образом. Заголовок
// на своём месте — прежняя кнопка. Сворачивание из рейки не пропало: галочка
// слева от имени — своя кнопка (`.panel__fold`), и смысл у неё один и тот же,
// где бы заголовок ни был нарисован.

import { strings } from "../strings.js";

// Какую долю кадра рейке отдавать нельзя. Разделов в колонке четыре-пять, и на
// обычном экране рейка до этого не дотягивается вовсе; правило нужно низкому
// кадру, где пять заголовков закрыли бы собой всё: там ближние разделы дороже
// дальних, и лучше две группы и содержимое, чем пять групп и ничего.
export const PANEL_RAIL_SHARE = 0.5;

/**
 * Где стоит каждый заголовок при такой прокрутке.
 *
 * `items` — разделы колонки сверху вниз: `{ top, box, head }`, где `top` —
 * место раздела в содержимом колонки (не на экране: прокрутка на него не
 * влияет), `box` — высота раздела, `head` — высота его заголовка. `frame` —
 * что показано: `{ scrollTop, clientHeight }`.
 *
 * Отдаёт массив той же длины: `{ shift, side }`. `shift` — на сколько сдвинуть
 * заголовок от его места (вниз — к верхней кромке, вверх — к нижней), `side` —
 * где он оказался: `""` — на своём месте, `"top"` — ступенькой у верхней
 * кромки, `"bottom"` — у нижней. Сторона нужна наружу затем, что по ней
 * решается смысл нажатия (таск 198): заголовок не на своём месте — указатель.
 *
 * **Лестница с обеих сторон** (таск 201, G305). Слова заказчика: «заголовки
 * должны отображаться все имеющиеся на экране свёрнутые, а не только
 * ближайший». До этого у каждой кромки стоял один заголовок — ближайший
 * уехавший, — и верх держал сам браузер (`position: sticky`). Теперь обе
 * кромки считаются здесь и по одному правилу:
 *
 * — **Сверху** идём с начала и копим `used`. Раздел, чьё место уже выше строки
 *   `scrollTop + used`, встаёт ступенькой на эту строку, и его заголовок
 *   занимает следующие `head` точек. Первый, кто до строки не дотянулся, стоит
 *   сам — и все, кто ниже него, тоже.
 * — **Снизу** идём с конца и копим `stack`: последний раздел встаёт у самой
 *   кромки, предыдущий над ним. Первый, кто дотянулся до своей строки, стоит
 *   сам — и все, кто выше.
 *
 * В обе стороны заголовок **снимается со ступеньки ровно там, где сдвиг
 * обнуляется**: перехода не видно, прыжка нет.
 *
 * Свёрнутый раздел — такая же ступенька, как остальные: в лестнице стоят все
 * разделы колонки, и видно их всегда. (До таска 201 свёрнутый к верху не
 * липнул вовсе — браузеру было некуда двигать его заголовок внутри раздела
 * высотой в этот самый заголовок.)
 *
 * **Предохранитель.** Обе лестницы вместе не съедают больше `PANEL_RAIL_SHARE`
 * кадра. Лишние ступеньки снимаются с дальних концов — сверху с самой верхней,
 * снизу с самой нижней: дальний раздел и так за соседями, а ближний — тот, к
 * которому человек подойдёт следующим движением. Уступает та лестница, в
 * которой ступенек больше; поровну — уступает верхняя, потому что нижняя
 * показывает, куда ещё идти.
 */
export function panelRailPins(items, frame) {
  const count = items ? items.length : 0;
  const pins = [];
  for (let k = 0; k < count; k += 1) pins.push({ shift: 0, side: "" });
  const view = Math.max(0, (frame && frame.clientHeight) || 0);
  if (!count || view <= 0) return pins;
  const from = (frame && frame.scrollTop) || 0;
  const edge = from + view;

  // Верхняя лестница — разделы `[topFrom, topTo)`: те, чьё место уже выше своей
  // строки. Нижняя — `[botFrom, botTo)`: те, кто до своей строки не дотянулся.
  let topFrom = 0;
  let topTo = 0;
  let upper = 0;
  while (topTo < count && items[topTo].top <= from + upper) {
    upper += items[topTo].head;
    topTo += 1;
  }
  let botFrom = count;
  let botTo = count;
  let lower = 0;
  for (let k = count - 1; k >= topTo; k -= 1) {
    if (items[k].top <= edge - lower - items[k].head) break;
    botFrom = k;
    lower += items[k].head;
  }

  // Предохранитель: лестницы делят кадр с содержимым, а не занимают его.
  const cap = view * PANEL_RAIL_SHARE;
  while (upper + lower > cap) {
    const top = topTo - topFrom;
    const bottom = botTo - botFrom;
    if (top === 0 && bottom === 0) break;
    if (bottom === 0 || (top > 0 && top >= bottom)) {
      upper -= items[topFrom].head;
      topFrom += 1;
    } else {
      botTo -= 1;
      lower -= items[botTo].head;
    }
  }

  let line = from;
  for (let k = topFrom; k < topTo; k += 1) {
    const shift = Math.max(0, Math.round(line - items[k].top));
    line += items[k].head;
    if (!shift) continue;
    pins[k] = { shift, side: "top" };
  }
  line = edge;
  for (let k = botTo - 1; k >= botFrom; k -= 1) {
    line -= items[k].head;
    const shift = Math.min(0, Math.round(line - items[k].top));
    if (!shift) continue;
    pins[k] = { shift, side: "bottom" };
  }
  return pins;
}

/**
 * Куда прокрутить колонку, чтобы раздел встал к верхней кромке.
 *
 * Считает это рейка, а не тот, кто её зовёт: раздел обязан встать **под**
 * лестницей — под заголовками тех, кто в целевом положении окажется выше
 * кадра, — иначе перелистывание прячет его за той же рейкой, из которой его
 * позвали.
 *
 * С таском 201 ответ перестал быть нулём: выше позванного раздела в лестнице
 * встанут **все** разделы до него, и накладка — сумма их заголовков. Больше
 * доли кадра лестница не берёт, поэтому и здесь стоит тот же предохранитель:
 * считать накладку по ступенькам, которых не будет, — значит промахнуться.
 */
export function panelRailTopInset(items, index, frame) {
  let inset = 0;
  for (let k = 0; k < index && k < items.length; k += 1) inset += items[k].head;
  const view = Math.max(0, (frame && frame.clientHeight) || 0);
  if (view <= 0) return inset;
  const cap = view * PANEL_RAIL_SHARE;
  for (let k = 0; k < index && inset > cap; k += 1) inset -= items[k].head;
  return Math.max(0, inset);
}

// Высоты лестниц по колонкам: `{top, bottom}`. Их спрашивают прокрутки к
// выделенной строке — рейка закрывает кадр так же непрозрачно, как прилипшие
// фильтры и кнопка смыкания.
const railHeight = new WeakMap();

/**
 * Кто из предков узла прокручивается.
 *
 * Своего прокручиваемого ящика у списков в колонке нет: с таска 194 прокрутка
 * одна на всю колонку, а на телефоне — у тела раздела, которое кладут листом.
 * Поэтому не имя узла, а первый предок, которому есть что прокручивать.
 */
export function panelScrollBox(node) {
  for (let box = node && node.parentElement; box; box = box.parentElement) {
    const overflow = getComputedStyle(box).overflowY;
    if ((overflow === "auto" || overflow === "scroll") && box.scrollHeight > box.clientHeight) return box;
  }
  return null;
}

/**
 * Сколько кадра закрыто непрозрачной накладкой — сверху (`head`) или снизу
 * (`foot`). Меряется по месту, а не по числам из стилей: прилипший блок
 * сдвинут отрицательным отступом, у кнопки смыкания свой, и оба меняются от
 * раскладки. `frame` — прямоугольник прокручиваемого ящика.
 */
export function panelCover(frame, element, side) {
  if (!element || element.hidden) return 0;
  const rect = element.getBoundingClientRect();
  if (rect.height === 0) return 0;
  return Math.max(0, side === "head" ? rect.bottom - frame.top : frame.bottom - rect.top);
}

// Высота лестницы у колонки, в которой лежит узел: `"top"` — сколько закрыто
// сверху, `"bottom"` — снизу (ноль — ступенек нет). Прокрутка к строке обязана
// это знать: подвести строку под рейку — то же, что подвести её под прилипшие
// фильтры.
export function panelRailInset(node, side) {
  for (let box = node; box; box = box.parentElement) {
    const rail = railHeight.get(box);
    if (rail !== undefined) return side === "top" ? rail.top : rail.bottom;
  }
  return 0;
}

// Заголовок, стоящий не на своём месте: поднят (`transform`), помечен классом
// и подписан подсказкой — нажатие перелистнёт, а не свернёт. Пишем только на
// смену значения: слепая запись стоила бы пересчёта стилей всему, что внутри.
function railPin(node, pin) {
  const css = pin.shift ? "translateY(" + pin.shift + "px)" : "";
  if (node.style.transform !== css) node.style.transform = css;
  node.classList.toggle("is-above", pin.side === "top");
  node.classList.toggle("is-below", pin.side === "bottom");
  node.classList.toggle("is-pinned", pin.side !== "");
  const title = node.querySelector(".panel__title");
  if (!title) return;
  const hint = pin.side ? strings.panels.jump : "";
  if (title.title !== hint) title.title = hint;
}

function railVar(node, name, value) {
  const css = value + "px";
  if (node.style.getPropertyValue(name) !== css) node.style.setProperty(name, css);
}

// Разделы колонки в порядке сверху вниз — одними чтениями, без единой записи:
// запись в стиль между двумя `getBoundingClientRect` заставляла бы браузер
// пересчитывать раскладку посреди обмера. Скрытый раздел (чужой режим,
// спрятанная колонка, лист на телефоне без заголовков) в счёт не идёт: высоты
// заголовка у него нет, и места в рейке он не занимает.
function railItems(column) {
  const rect = column.getBoundingClientRect();
  // Где в кадре лежит начало содержимого: по нему место раздела переводится из
  // экранного в содержимое — прокрутка на такое место не влияет.
  const base = rect.top + column.clientTop - column.scrollTop;
  const items = [];
  for (const section of column.querySelectorAll(".panel__section")) {
    const node = section.querySelector(".panel__head");
    if (!node) continue;
    const box = section.getBoundingClientRect();
    items.push({ section, node, head: node.offsetHeight, top: box.top - base, box: box.height });
  }
  return items;
}

const RAIL_FREE = { shift: 0, side: "" };

function syncColumn(column) {
  const all = railItems(column);
  const shown = all.filter((item) => item.head > 0);
  const pins = panelRailPins(shown, { scrollTop: column.scrollTop, clientHeight: column.clientHeight });
  let top = 0;
  let bottom = 0;
  for (let k = 0; k < shown.length; k += 1) {
    railPin(shown[k].node, pins[k]);
    if (pins[k].side === "top") top += shown[k].head;
    else if (pins[k].side === "bottom") bottom += shown[k].head;
  }
  for (const item of all) if (item.head <= 0) railPin(item.node, RAIL_FREE);
  // Прилипший блок внутри тела (фильтры списка меток) липнет **под** лестницей,
  // а не под одним своим заголовком: с таска 201 сверху стоят все уехавшие
  // разделы, и своего заголовка там уже мало. Мера одна на колонку и меряется
  // по ступенькам, а не числом в стилях.
  //
  // Первая ступенька лестницы, стоящая на своём месте (прокрутка в самом
  // верху), в меру не входит: её сдвиг ноль, и содержимое под ней не уезжает.
  railVar(column, "--panel-head", top);
  railVar(column, "--panel-rail", bottom);
  railHeight.set(column, { top, bottom });
}

/**
 * Нажали заголовок — перелистнуть к его разделу, если заголовок нарисован у
 * кромки (таск 198, G303).
 *
 * Отдаёт `true`, если нажатие было указателем и колонка перелистнута, и
 * `false`, если заголовок стоит на своём месте: тогда это прежняя кнопка
 * сворачивания, и решает не рейка. Знание «у кромки или нет» берётся из
 * класса, который рейка поставила в последнем кадре прокрутки, — второго
 * обмера ради одного клика не нужно.
 *
 * Прокрутка **мгновенная**, не плавная, и это выбор. Колонка на объекте
 * заказчика — 3785 точек: плавный перелёт через неё занимает полсекунды, всё
 * это время перестраивает рейку на каждом кадре и показывает по дороге строки,
 * которых никто не звал. Слова заказчика («нажал — прыгнуло туда») — про
 * прыжок. Мгновенная ещё и не спорит с рукой: начал человек листать сам —
 * спорить не с чем, перелёт уже кончился.
 */
export function panelRailJump(node) {
  const head = node && node.closest ? node.closest(".panel__head") : null;
  if (!head || !head.classList.contains("is-pinned")) return false;
  const section = head.closest(".panel__section");
  const column = section ? section.closest(".panel") : null;
  if (!column) return false;
  const shown = railItems(column).filter((item) => item.head > 0);
  const index = shown.findIndex((item) => item.node === head);
  if (index < 0) return false;
  const frame = { scrollTop: column.scrollTop, clientHeight: column.clientHeight };
  column.scrollTop = shown[index].top - panelRailTopInset(shown, index, frame);
  syncPanelRail();
  return true;
}

let railColumns = [];
let railPending = false;

// Один кадр на обе колонки: прокрутка правой пересчитает и левую, но левая —
// это пять чтений, а два расписания на кадр были бы двумя пересчётами стилей.
export function syncPanelRail() {
  if (railPending || railColumns.length === 0) return;
  if (typeof requestAnimationFrame !== "function") {
    for (const column of railColumns) syncColumn(column);
    return;
  }
  railPending = true;
  requestAnimationFrame(() => {
    railPending = false;
    for (const column of railColumns) syncColumn(column);
  });
}

export function wirePanelRail() {
  if (typeof document === "undefined") return;
  railColumns = [...document.querySelectorAll(".panel")];
  if (railColumns.length === 0) return;
  const observer =
    typeof ResizeObserver === "function" ? new ResizeObserver(() => syncPanelRail()) : null;
  for (const column of railColumns) {
    column.addEventListener("scroll", syncPanelRail, { passive: true });
    if (!observer) continue;
    // Колонка — чтобы знать кадр, разделы — чтобы знать места: раздел меняет
    // рост, когда его свернули, когда в списке прибыло строк и когда режим
    // экрана убрал соседа.
    observer.observe(column);
    for (const section of column.querySelectorAll(".panel__section")) observer.observe(section);
  }
  if (typeof window !== "undefined" && !observer) window.addEventListener("resize", syncPanelRail);
  syncPanelRail();
}
