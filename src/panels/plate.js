// Плашка поверх поля: подсказка слева и сводка справа (G228, таск 153).
//
// Слова заказчика, посмотревшего три режима подряд: «На чертеже панели не
// скрываются, на схеме вопросик скрывающийся слева (как и должно быть), а в
// Объёме — справа. Сделай подсказки все слева, чтобы скрывались, а информацию,
// так же чтобы скрывалась, справа, левее кнопки полноэкранности, с иконкой i
// (info). И там как раз размеры, количество и т.д.»
//
// Отсюда правило, одно на все три режима:
//
//   **слева — подсказка**, знак «?», она про руки: что делают клик, клавиши и
//     мышь прямо сейчас;
//   **справа — сводка**, знак «i», она про объект: размеры, счёт, недостающее.
//     Стоит левее кнопки полноэкранности, потому что кнопка там была раньше и
//     двигать её незачем.
//
// Обе сворачиваются в свой знак и **помнят себя порознь**: свернул сводку —
// свёрнута сводка, а не подсказка, и после перезагрузки обе на своих местах.
// Механизм взят у подсказки холста целиком (те же классы, та же точка на
// кнопке, та же настройка в браузере) — второго в сборке нет.
//
// Что показывает знак на свёрнутой плашке:
//
//   **подсказка** — текст сменился, пока она была свёрнута (`plateUnseen`):
//     «второй Esc возвращает в „Выделение“» нельзя съесть молча;
//   **сводка** — в ней есть о чём предупредить (неразмещённые метки, запасной
//     габарит). Свёрнутая сводка не должна прятать плохие новости — заказчик
//     назвал это прямо.
import { getSetting, setSetting } from "../store.js";
import { strings } from "../strings.js";
import { uiEl, uiIcon } from "./ui.js";

/**
 * Текст плашки сменился, пока она была свёрнута.
 *
 * Разворачивать её за человека нельзя: он свернул её осознанно, и она
 * выпрыгивала бы под рукой на каждую смену типа — ровно то, от чего он
 * избавился. Но и молча съесть «второй Esc возвращает в „Выделение“» нельзя,
 * поэтому кнопка получает точку и другую подпись.
 *
 * `seen` — текст, который человек видел последним (плашка была развёрнута).
 * Ничего не видел — знака нет: точка на первой же подсказке после перезагрузки
 * была бы шумом.
 *
 * Живёт здесь, а не в холсте, с тех пор как плашек стало две на три режима
 * (G228): холст зовёт её отсюда, как и все остальные.
 */
export function plateUnseen(seen, current) {
  if (seen === null || current === null) return false;
  return seen !== current;
}

// Свёрнутость живёт здесь, а не в самой плашке: поверхности пересобираются
// (сменили схему, вышли и вернулись в режим), а выбор человека — нет.
const plateCollapsed = new Map();
// Что человек уже прочёл: текст, который стоял в развёрнутой плашке.
const plateSeen = new Map();

/**
 * Собрать плашку.
 *
 * `side` — «left» для подсказки, «right» для сводки; `setting` — ключ, по
 * которому помнится свёрнутость. Знак выбирает сторона, и доводом он не
 * передаётся нарочно: правило «слева „?“, справа „i“» одно на сборку, и
 * позволить его перебить значило бы завести второй вид плашки.
 *
 * Наружу уходят три двери: `node` — сама плашка, `update` — что в ней написано,
 * `fold` — просьба поля сложить её в знак, не трогая памяти человека.
 */
export function createFieldPlate({ side, setting }) {
  const info = side === "right";
  const body = uiEl("div", { class: "canvas-hint__text" });
  const toggle = uiEl(
    "button",
    {
      class: "canvas-hint__toggle",
      type: "button",
      on: { click: () => flip() },
    },
    info ? uiIcon("info") : uiIcon("hint"),
  );
  // Кнопка стоит первой у обеих: у подсказки она слева от текста (как на
  // холсте), у сводки её ставит к правому краю сама раскладка (`row-reverse` в
  // стилях) — свёрнутая плашка обязана остаться в том углу, где была её кнопка.
  const node = uiEl("div", { class: "canvas-hint" + (info ? " canvas-hint--info" : "") }, [toggle, body]);
  let alert = false;
  let text = "";
  // Плашку может сложить не человек, а само поле: в полном экране «Объёма» над
  // сценой остаётся только знак (таск 166, G246). Это **не** выбор человека, и
  // памяти свёрнутости оно не трогает — вышли из полного экрана, и плашка
  // вернулась такой, какой была. `asked` помнит последнюю просьбу поля, чтобы
  // складывать один раз за заход: развернул человек её в полном экране — она
  // останется развёрнутой, а не схлопнется на следующем же кадре.
  let folded = false;
  let asked = false;

  function collapsed() {
    return plateCollapsed.get(setting) === true;
  }

  function flip() {
    const was = shutNow();
    // Человек трогает свою память, а не чужую просьбу: сложенную полем плашку
    // он разворачивает тем же нажатием, и дальше она его.
    folded = false;
    plateCollapsed.set(setting, !was);
    setSetting(setting, collapsed());
    render();
  }

  function shutNow() {
    return folded || collapsed();
  }

  /**
   * Сложить плашку в знак (или вернуть ей волю человека) — просьба поля.
   *
   * Повторная просьба того же ничего не делает: поле спрашивает это на каждом
   * кадре, а человек имеет право развернуть плашку и в полном экране.
   */
  function fold(on) {
    const want = Boolean(on);
    if (want === asked) return;
    asked = want;
    folded = want;
    render();
  }

  function render() {
    const shut = shutNow();
    node.classList.toggle("is-collapsed", shut);
    body.hidden = shut;
    // Развёрнутую плашку человек видит — значит, этот текст прочитан.
    if (!shut) plateSeen.set(setting, text);
    const seen = plateSeen.has(setting) ? plateSeen.get(setting) : null;
    const unseen = shut && (alert || plateUnseen(seen, text));
    toggle.classList.toggle("is-new", Boolean(unseen));
    const words = info ? strings.canvas.info : strings.canvas.hintWords;
    let label = words.collapse;
    if (shut) label = unseen ? words.expandNew : words.expand;
    toggle.title = label;
    toggle.setAttribute("aria-label", label);
    toggle.setAttribute("aria-expanded", shut ? "false" : "true");
  }

  /**
   * Что в плашке. `parts` — строка или готовые узлы (у сводки это строки
   * подряд), `options.alert` — есть о чём предупредить, `options.hidden` —
   * показывать нечего вовсе.
   */
  function update(parts, options = {}) {
    const list = parts == null ? [] : Array.isArray(parts) ? parts : [parts];
    const nodes = list.map((part) => (typeof part === "string" ? uiEl("p", { text: part }) : part));
    body.replaceChildren(...nodes);
    text = nodes.map((part) => part.textContent || "").join(" ");
    alert = Boolean(options.alert);
    node.hidden = Boolean(options.hidden) || text.trim() === "";
    render();
  }

  render();
  // Настройка читается асинхронно, как у подсказки холста: плашка стартует
  // развёрнутой и схлопывается, когда хранилище ответит. То, что человек успел
  // увидеть до ответа, прочитанным не считается — он на неё не смотрел.
  if (!plateCollapsed.has(setting)) {
    Promise.resolve(getSetting(setting))
      .then((saved) => {
        if (saved !== true || plateCollapsed.get(setting) === true) return;
        plateCollapsed.set(setting, true);
        plateSeen.delete(setting);
        render();
      })
      .catch(() => {});
  }

  return { node, update, fold };
}
