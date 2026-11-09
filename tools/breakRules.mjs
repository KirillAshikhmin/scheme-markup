// Набор «сломай правило»: **данные, а не код**. Прогоняет его
// `tools/break-rules.mjs`, там же сказано, зачем это есть.
//
// Одна запись — одно правило сборки и один способ сломать его нарочно:
//
//   rule   короткое имя правила, им же правило зовут из командной строки;
//   said   чем правило держит объект — словами, без имён функций там, где
//          можно словами: эту строку читает человек в таблице прогона;
//   file   файл от корня `scheme_image/`;
//   was    кусок этого файла **дословно**, который обязан встретиться в нём
//          ровно один раз (иначе прогон отказывается и говорит, сколько нашёл);
//   now    чем его заменить (пустая строка — выкинуть);
//   tests  файлы прогона, которые обязаны покраснеть. Их же прогон и зовёт:
//          называть здесь весь `npm test` незачем, а назвать не тот файл —
//          значит соврать о том, кто правило стережёт.
//
// **Заводишь новое правило номеров, слияния или миграции — заводи и запись
// здесь.** Правило, у которого нет записи, не проверено ничем: тест, зелёный
// на сломанной модели, тестом не является, и узнать это можно только сломав.
//
// **Порча обязана быть адресной.** Правка, после которой краснеет полпрогона,
// отвечает «что-то сломалось», а не «вот эта гарантия под охраной»: такую
// красноту даст и опечатка. Хорошая порча оставляет сборку рабочей везде, кроме
// одного случая, — и тогда красный тест называет именно его (таск 278).
//
// Сам набор гниёт молча: `was` — дословный кусок файла, и переформатирование
// `model.js` обнуляет запись. Это ловит `test/breakRules.test.js` — сверка
// данных без единого прогона, она входит в `npm test`, в отличие от самой
// снасти.
//
// Набор собран в таске 275, перенесён сюда таском 277 и заточен таском 278:
// семнадцатое правило прикрыло дом (`sim/home.js`, ADR 041), а три порчи из
// шестнадцати стали адресными.

export const BREAK_RULES = [
  // ——— простые ссылки: вид назван в `ID_OWNERS` ——————————————————————————
  {
    rule: "roomId",
    said: "помещение метки названо ссылкой, и перенумерация его переписывает",
    file: "src/model.js",
    was: `      roomId: "rooms",
`,
    now: "",
    tests: ["test/markIds.test.js"],
  },
  {
    rule: "wallId",
    said: "стена метки названа ссылкой",
    file: "src/model.js",
    was: `      wallId: "walls",
      objectId`,
    now: "      objectId",
    tests: ["test/markIds.test.js"],
  },
  {
    rule: "objectId",
    said: "связанная вещь чертежа названа ссылкой (ADR 031)",
    file: "src/model.js",
    was: `      objectId: "schemeObjects",
`,
    now: "",
    tests: ["test/markIds.test.js"],
  },
  {
    rule: "kindId",
    said: "вид вещи прежней разметки назван ссылкой",
    file: "src/model.js",
    was: `{ key: "schemeObjects", refs: { schemeId: "schemes", kindId: "schemeObjectKinds" } }`,
    now: `{ key: "schemeObjects", refs: { schemeId: "schemes" } }`,
    tests: ["test/markIds.test.js"],
  },
  {
    rule: "links",
    said: "список связанных меток у расстановки оборудования назван списком ссылок",
    file: "src/model.js",
    was: `    lists: { links: "marks" },
`,
    now: "",
    tests: ["test/markIds.test.js"],
  },
  {
    rule: "markIds",
    said: "состав блока назван списком ссылок",
    file: "src/model.js",
    was: `lists: { markIds: "marks" }`,
    now: "lists: {}",
    tests: ["test/markIds.test.js"],
  },
  // Порча адресная нарочно (таск 278). Прежняя снимала `nested` и `nestedKey`
  // разом, то есть **разрегистрировала вид**, и краснел структурный тест
  // «дверь есть у каждого вида»: ловилась регистрация, а не переезд номеров.
  // Теперь вид зарегистрирован, счётчик и занятый номер у направляющих свои, а
  // выкинут ровно переезд вложенных: номера направляющих остаются прежними,
  // пока вокруг них всё перенумеровано.
  {
    rule: "guides",
    said: "номер направляющей схемы переезжает своим видом, как сущность верхнего уровня (ADR 038)",
    file: "src/model.js",
    was: `      if (owner.nested && Array.isArray(item[owner.nested])) {
        fresh[owner.nested] = item[owner.nested].map((child) => ({
          ...child,
          id: moveBy(owner.nestedKey, child.id),
        }));
      }
`,
    now: "",
    tests: ["test/markIds.test.js"],
  },

  // ——— ссылки непростой формы: каждая переписывается поимённо ——————————————
  {
    rule: "controls",
    said: "«чем управляет» переезжает — и строкой, и записью `{id, channel}`",
    file: "src/model.js",
    was: `      if (Array.isArray(mark.controls)) {
        fresh.controls = mark.controls.map((item) =>
          typeof item === "string"
            ? moveBy("marks", item)
            : item && typeof item === "object"
              ? { ...item, id: moveBy("marks", item.id) }
              : item,
        );
      }
`,
    now: "",
    tests: ["test/markIds.test.js"],
  },
  {
    rule: "doorId",
    said: "дверь датчика открытия переезжает вместе с проёмом",
    file: "src/model.js",
    was: `      if (deviceObject(mark.device) && mark.device.doorId) {
        fresh.device = { ...mark.device, doorId: moveBy("openings", mark.device.doorId) };
      }
`,
    now: "",
    tests: ["test/markIds.test.js"],
  },
  {
    rule: "tree",
    said: "дерево блоков сценария обходится вглубь: `markId` и `scenarioId` на любом ярусе",
    file: "src/model.js",
    was: `  if (Array.isArray(patch.scenarios)) {
    const kinds = { markId: "marks", scenarioId: "scenarios" };`,
    now: `  if (false) {
    const kinds = { markId: "marks", scenarioId: "scenarios" };`,
    tests: ["test/markIds.test.js", "test/idsMigrate.test.js"],
  },
  {
    rule: "acceptedKeys",
    said: "ключи принятых предупреждений переписываются, и человек не получает заново список, на который ответил",
    file: "src/model.js",
    was: `  const accepted = acceptedOf(project);
  if (accepted.length > 0 && maps.size > 0) {`,
    now: `  const accepted = acceptedOf(project);
  if (false) {`,
    tests: ["test/idsMigrate.test.js"],
  },

  // ——— ссылка в никуда: гашение `ID_GONE` и его условие ————————————————————
  {
    rule: "gone",
    said: "адрес аксессуара, чьей метки в объекте нет, гасится в `ID_GONE`, а не остаётся числом",
    file: "src/model.js",
    was: `  return gone ? ID_GONE + match[2] : value;`,
    now: `  return value;`,
    tests: ["test/idsMigrate.test.js"],
  },
  {
    rule: "goneNumbered",
    said: "гасится только там, где метки объекта были пронумерованы: у объекта поры uuid короткое число в опциях адресом не было",
    file: "src/model.js",
    was: `    const gone = Boolean(whole) && (project.marks || []).some((mark) => idNumberOf(mark && mark.id) !== null);`,
    now: `    const gone = Boolean(whole);`,
    tests: ["test/idsMigrate.test.js"],
  },

  // ——— касса номеров: выдача не лезет поверх занятого ————————————————————
  {
    rule: "claim",
    said: "принятый снаружи номер двигает счётчик своего вида (`idMint.claim`)",
    file: "src/model.js",
    was: `  const id = given ? mint.claim("scenarios", source.id) : mint.next("scenarios");`,
    now: `  const id = given ? source.id : mint.next("scenarios");`,
    tests: ["test/markIds.test.js"],
  },
  // **Две половины одного `Math.max` — две разные гарантии, и каждую стережёт
  // свой тест** (таск 278). Строка в сборке одна, и развести эти правила по
  // файлам нечем: оба красных теста живут в `test/markIds.test.js`. Разведены
  // они тем, **что** краснеет, и таблица прогона это печатает:
  //
  //   floors   → «счётчики потеряны — ни одна дверь не выдаёт номер поверх
  //              занятого» (счётчика нет вовсе, прикрывает только занятый номер);
  //   counters → «после любой команды счётчик вида не меньше выданного, и
  //              удаление номер не возвращает (G09)» (сущность удалена, её
  //              номер из обхода ушёл, прикрывает только счётчик).
  {
    rule: "floors",
    said: "выдача не лезет поверх номера, уже занятого живой сущностью (объект из ссылки, слитый из двух)",
    file: "src/model.js",
    was: `      const value = Math.max(Number(counters[key]) || 0, floors.get(collection) || 0) + 1;`,
    now: `      const value = (Number(counters[key]) || 0) + 1;`,
    tests: ["test/markIds.test.js"],
  },
  // Порча адресная нарочно (таск 278). Прежняя выкидывала счётчик целиком —
  // выдача ломалась на любом объекте, где он впереди занятого номера, и
  // краснело полпрогона: «что-то сломалось», а не «правило под охраной». Эта
  // держится за счётчик там, где у вида **нет ни одной сущности**, и берёт
  // занятый номер, где есть: пока сущности живы и счётчик с ними в ногу, выдача
  // не меняется ни на один номер, и падает ровно случай «сущность удалена,
  // счётчик позади» — тот, из-за которого номер выдаётся второй раз.
  {
    rule: "counters",
    said: "выдача не лезет поверх счётчика вида, даже если сущность с таким номером удалена",
    file: "src/model.js",
    was: `      const value = Math.max(Number(counters[key]) || 0, floors.get(collection) || 0) + 1;`,
    now: `      const value = (floors.has(collection) ? floors.get(collection) : Number(counters[key]) || 0) + 1;`,
    tests: ["test/markIds.test.js"],
  },

  // ——— дом: ссылка привязки одна, и она не в опциях (ADR 041) ——————————————
  //
  // Семнадцатое правило и единственное за пределами `src/model.js` (таск 278).
  // Решение ADR 041 несимметрично нарочно: вглубь по значению обходится дерево
  // блоков сценария (`homeLeadMarks`), а привязка — на один уровень
  // (`homeLeadBindings`). Следующий автор, увидев в `options` ключ `markId`,
  // захочет «починить» несимметричность — и молча перепишет выбор человека в
  // опциях. Порча ровно эта: вернуть дому глубокий обход привязки.
  {
    rule: "bindOptions",
    said: "дом обходит привязку на один уровень: опцию, которую автор скрипта назвал `markId`, он не переписывает (ADR 041)",
    file: "src/sim/home.js",
    was: `    logicBindings: homeLeadBindings(structuredClone(logicBindingsOf(project)), followers),`,
    now: `    logicBindings: homeLeadMarks(structuredClone(logicBindingsOf(project)), followers),`,
    tests: ["test/deviceGroup.test.js"],
  },
];
