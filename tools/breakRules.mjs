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
// Правило без ответа «что оно держит» в набор не идёт: сперва `said` словами,
// потом порча. Запись, у которой `said` пересказывает код («выкинут такой-то
// `if`»), читателю таблицы не говорит ничего.
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
// шестнадцати стали адресными. Таск 281 добавил тридцать два правила слияния
// (`merge.js`) и обеих труб открытия (`deviceMigrate.js`, `projectFile.js`,
// `panels/projects.js`) — ту область, где живёт G68 и где дважды находилась
// молчаливая порча. Семь из них красного теста не имели вовсе: порча проходила
// мимо **всего** прогона, и тесты на них заведены тем же таском.

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

  // ——— слияние: чужая работа не пропадает молча (`src/merge.js`) ————————————
  //
  // Выкинут **контур помещения**, а не стена или проём, и выбор этот не
  // случайный. `mergeReferences` разыменовывает каждый список прямо
  // (`merged.openings.filter`), а `walls`, `openings`, `schemeObjects` и
  // `scenarios` у объекта прежней разметки отсутствуют вовсе — разрегистрируй
  // такую коллекцию, и слияние начинает падать на каждом объекте без чертежа:
  // замерено, 7 красных во всём прогоне, то есть ответ «что-то сломалось».
  // Контур есть у всякого объекта, собранного моделью, поэтому порча оставляет
  // сборку рабочей: 2 красных, и оба про правило — контур, обведённый
  // напарником, в слитый объект не попал и в отчёте не значится, а у объекта,
  // у которого списка контуров нет, слияние на нём падает.
  {
    rule: "mergeEntities",
    said: "коллекция объекта названа в `MERGE_ENTITIES` поимённо: той, которой здесь нет, в слитом объекте не бывает вовсе — работа напарника пропала бы целиком и молча (таск 121)",
    file: "src/merge.js",
    was: `  "groups",
  "outlines",
  "equipmentTypes",`,
    now: `  "groups",
  "equipmentTypes",`,
    tests: ["test/merge.test.js"],
  },
  {
    rule: "clashEveryKind",
    said: "столкновение номеров разводится у **каждого** вида сущностей, а не только у меток: номер раздаёт счётчик, и напарники получают один и для помещения, и для стены",
    file: "src/merge.js",
    was: `  const clashed = new Map();
  for (const entity of MERGE_ENTITIES) {`,
    now: `  const clashed = new Map();
  for (const entity of ["marks"]) {`,
    tests: ["test/merge.test.js"],
  },
  // Два правила об одном споре, и порчи у них противоположные: `clashEveryKind`
  // не разводит столкнувшиеся сущности **кроме меток**, `clashKind` разводит
  // метку со стеной, которая ей не спор. Под `--all` у обоих 6 красных, и это
  // предел адресности: правило про **все** виды, поэтому порча в любую сторону
  // задевает столько тестов, сколько видов в них столкнулось. Прежняя порча
  // `clashKind` подмешивала в сравнение сразу все коллекции и давала 10 красных
  // во всём прогоне; теперь подмешаны только метки — остальные виды спорят как
  // прежде, а красным называется нужный случай («номер метки совпал с номером
  // стены — это не столкновение»).
  {
    rule: "clashKind",
    said: "столкновение номеров ищется внутри своего вида: метка 110 рядом со стеной 110 — обычное состояние объекта, а не спор (ADR 038)",
    file: "src/merge.js",
    was: `    const mine = new Map();
    for (const item of mergeList(ours, entity)) {
      if (item && typeof item.id === "string") mine.set(item.id, item);
    }`,
    now: `    const mine = new Map();
    for (const item of [...mergeList(ours, entity), ...mergeList(ours, "marks")]) {
      if (item && typeof item.id === "string") mine.set(item.id, item);
    }`,
    tests: ["test/merge.test.js"],
  },
  {
    rule: "clashSide",
    said: "отчёт `reissued` называет сторону, чья сущность переехала: по нему её и находят, а номер человеку не виден (таск 272)",
    file: "src/merge.js",
    was: `  const side = winner === "theirs" ? "ours" : "theirs";`,
    now: `  const side = winner === "theirs" ? "theirs" : "ours";`,
    tests: ["test/comment.test.js"],
  },
  {
    rule: "clashCounters",
    said: "свободный номер на переезд берётся у счётчика, сведённого по обеим сторонам: иначе переезд встанет на номер, занятый у напарника",
    file: "src/merge.js",
    was: `  let project = { ...moving, counters: mergeCounters(moving, other) };`,
    now: `  let project = { ...moving };`,
    tests: ["test/merge.test.js"],
  },
  {
    rule: "restoreType",
    said: "тип метки, на котором остались чужие метки, возвращается: модель удалить занятый не даёт (`typeHasMarks`), а через двух участников это правило обходится",
    file: "src/merge.js",
    was: `  mergeRestore(merged, "markTypes", mergeRefs(merged.marks, "typeId"), sources, report, winner);
`,
    now: "",
    tests: ["test/merge.test.js"],
  },
  {
    rule: "keepEdited",
    said: "правка важнее удаления: сущность, которую одна сторона правила, а вторая удалила, остаётся",
    file: "src/merge.js",
    was: `      } else {
        result.push(mine);
        report.conflicts.push({ code: "deletedElsewhere", entity, id, kept: "ours", item: mine });
      }`,
    now: `      } else {
        report.conflicts.push({ code: "deletedElsewhere", entity, id, kept: "ours", item: mine });
      }`,
    tests: ["test/merge.test.js"],
  },
  {
    rule: "commentKept",
    said: "плашка ссылается на встроенный тип, которого нет ни в одном справочнике, и висячей ссылкой он не считается (G173)",
    file: "src/merge.js",
    was: `    if (mark.typeId === COMMENT_TYPE_ID) return true;
`,
    now: "",
    tests: ["test/comment.test.js"],
  },
  {
    rule: "catalogThing",
    said: "у вещи встроенного каталога вида в справочнике нет вовсе, и `kindId` с неё не спрашивают (таск 154)",
    file: "src/merge.js",
    was: `    object.catalogKey || objectKinds.has(object.kindId) ? true : dropObject(object),`,
    now: `    objectKinds.has(object.kindId) ? true : dropObject(object),`,
    tests: ["test/drawing.test.js"],
  },
  {
    rule: "wallGone",
    said: "привязка к исчезнувшей стене **убирается**, а не обнуляется: метка без привязки и метка со снятой привязкой читаются одинаково (G68)",
    file: "src/merge.js",
    was: `    if (mark.wallId && !walls.has(mark.wallId)) return markWithoutWall(next);`,
    now: `    if (mark.wallId && !walls.has(mark.wallId)) return { ...next, wallId: null, wallAtMm: null };`,
    tests: ["test/drawing.test.js"],
  },
  {
    rule: "controlsForms",
    said: "«чем управляет» перекладывается в обеих формах — строкой и записью `{id, channel}`: пересборка из одних номеров теряла бы канал на каждом слиянии",
    file: "src/merge.js",
    was: `      ? mark.controls.filter((item) => marks.has(typeof item === "string" ? item : item && item.id))`,
    now: `      ? mark.controls.filter((item) => marks.has(item))`,
    tests: ["test/markChannels.test.js"],
  },
  {
    rule: "linkOnce",
    said: "вещь чертежа одна на связь: у двух участников с одной вещью связались разные метки, и в слитом объекте у прибора было бы две строки (R01)",
    file: "src/merge.js",
    was: `    if (!object || object.schemeId !== next.schemeId || linkedObjects.has(linked)) {`,
    now: `    if (!object || object.schemeId !== next.schemeId) {`,
    tests: ["test/merge.test.js"],
  },
  {
    rule: "clusters",
    said: "намеренный повтор номера (несколько «Т1» одной группы) переезжает кластером целиком, а не разводится по метке (G25, G96)",
    file: "src/merge.js",
    was: `    const id = clusterOf(key, mark.id);`,
    now: `    const id = mark.id;`,
    tests: ["test/merge.test.js"],
  },
  {
    rule: "numberInBase",
    said: "на обозначении остаётся тот, кто стоял на нём в общем предке: его и написали на схеме, а переезжает новый",
    file: "src/merge.js",
    was: `      const byBase = (a.inBase ? 0 : 1) - (b.inBase ? 0 : 1);
      if (byBase !== 0) return byBase;
`,
    now: "",
    tests: ["test/merge.test.js"],
  },
  {
    rule: "numberCeiling",
    said: "номер выше потолка `setMarkNumber` слияние не выдаёт: того, чего не поставить рукой, в объекте не бывает",
    file: "src/merge.js",
    was: `    if (next > MARK_NUMBER_MAX) continue;
`,
    now: "",
    tests: ["test/merge.test.js"],
  },
  {
    rule: "acceptedUnion",
    said: "принятые предупреждения объединяются по ключу, а не спорят: вопрос уже отвечен, и второму участнику его не задают заново",
    file: "src/merge.js",
    was: `  merged.accepted = added.length === 0 ? mine : [...mine, ...added];`,
    now: `  merged.accepted = mine;`,
    tests: ["test/merge.test.js"],
  },
  // Самая широкая порча группы — 8 красных под `--all`, и адреснее она не
  // бывает: правило про **любую** коллекцию, которой у сторон нет, и чистка у
  // него одна на все. Красные при этом говорят одно и то же — «объект прежней
  // разметки получил поля, которых в нём не было», — а не «что-то сломалось».
  {
    rule: "absentLists",
    said: "коллекция, которой не знала ни одна сторона, не заводится пустой: два одинаковых объекта прежней разметки сходятся в «ничего не изменилось» (G68)",
    file: "src/merge.js",
    was: `  for (const entity of absent) {
    if (merged[entity].length === 0) delete merged[entity];
  }
`,
    now: "",
    tests: ["test/merge.test.js"],
  },
  {
    rule: "stampFields",
    said: "штамп сливается графа к графе: один вписал шифр, другой организацию — спора между ними нет, и работа обоих складывается",
    file: "src/merge.js",
    was: `  const stamp = {};
  for (const field of new Set([...Object.keys(mine || {}), ...Object.keys(other || {})])) {
    const left = mine ? mine[field] : "";
    const right = other ? other[field] : "";
    const value = !left ? right : !right ? left : winner === "theirs" ? right : left;
    if (value) stamp[field] = value;
  }`,
    now: `  const stamp = { ...((winner === "theirs" ? other : mine) || {}) };`,
    tests: ["test/stamp.test.js"],
  },
  {
    rule: "siteSlots",
    said: "свойства объекта сливаются слотами: адрес одного и пара координат другого складываются, спорит только один и тот же слот",
    file: "src/merge.js",
    was: `  const pick = (left, right) => (!left ? right : !right ? left : winner === "theirs" ? right : left);
  const site = {};
  const address = pick(mine.address, other.address);
  if (address) site.address = address;
  const coords = pick(
    mine.lat === null ? null : { lat: mine.lat, lon: mine.lon },
    other.lat === null ? null : { lat: other.lat, lon: other.lon },
  );
  if (coords) {
    site.lat = coords.lat;
    site.lon = coords.lon;
  }
  const top = pick(mine.topAzimuthDeg || null, other.topAzimuthDeg || null);
  if (top) site.topAzimuthDeg = top;`,
    now: `  const site = {};
  const won = winner === "theirs" ? other : mine;
  if (won.address) site.address = won.address;
  if (won.lat !== null) {
    site.lat = won.lat;
    site.lon = won.lon;
  }
  if (won.topAzimuthDeg) site.topAzimuthDeg = won.topAzimuthDeg;`,
    tests: ["test/projectSite.test.js"],
  },
  {
    rule: "relatedByUuid",
    said: "общий номер родства не доказывает, общий uuid — доказывает: справочник двух объектов из одного шаблона нумеруется одинаково, и слияние складывало бы два чужих объекта (ADR 038)",
    file: "src/merge.js",
    was: `      if (mine.has(item.id) && idNumberOf(item.id) === null) return true;`,
    now: `      if (mine.has(item.id)) return true;`,
    tests: ["test/merge.test.js"],
  },

  // ——— миграции: готовый объект не ломается (G68) ———————————————————————————
  //
  // Пять правил достройки вещи краснеют **одним файлом**
  // (`markObjectMigrate.test.js`), но разными тестами, и таблица прогона это
  // печатает: `thingFound` — «вещь того же вида второй не обрастает»,
  // `thingCode` — «Пос это ПОС», `thingStamp` — «объект не меняется вовсе»,
  // `thingsOnceFile` и `thingsOnceStored` — «обе трубы достраивают одинаково»
  // и «снятая рукой связь переживает любое число открытий». Ослабь один тест —
  // замолчит одно правило; ослабь файл целиком — замолчат пять, и снасть
  // этого не увидит: она знает только «красный или нет» (долг таска 278).
  {
    rule: "thingFound",
    said: "вещь того же вида, уже стоящая под меткой, связывается, а не обрастает второй: иначе на плане появился бы второй телевизор",
    file: "src/deviceMigrate.js",
    was: `  return best;`,
    now: `  return null;`,
    tests: ["test/markObjectMigrate.test.js"],
  },
  {
    rule: "thingCode",
    said: "код типа узнаётся без учёта регистра — так его сравнивает и модель: у заказчика полотенцесушитель назван «Пос»",
    file: "src/deviceMigrate.js",
    was: `MIGRATE_THING_KEYS[String(type.code || "").trim().toUpperCase()]`,
    now: `MIGRATE_THING_KEYS[String(type.code || "").trim()]`,
    tests: ["test/markObjectMigrate.test.js"],
  },
  {
    rule: "thingStamp",
    said: "миграция не трогает `updatedAt`: объект открылся, а не был правлен, и в истории отмены от неё ничего не появляется",
    file: "src/deviceMigrate.js",
    was: `  return { project: { ...next, updatedAt: project.updatedAt }, changed: true, made, linked };`,
    now: `  return { project: next, changed: true, made, linked };`,
    tests: ["test/markObjectMigrate.test.js"],
  },
  {
    rule: "decoupleKeys",
    said: "клавиша, на нажатия которой опирается сценарий или логика, при переводе выключателя становится отвязанной: привязанная кнопка нажатий не шлёт (G11), и сценарий замолчал бы",
    file: "src/deviceMigrate.js",
    was: `    if (used.length > 0) decouple.set(markId, used);`,
    now: `    if (false) decouple.set(markId, used);`,
    tests: ["test/deviceMigrate.test.js"],
  },
  {
    rule: "kindAddresses",
    said: "адреса в опциях логики переселяются только у записи, которую перевод правит: выведенный по виду кондиционер читается заново на каждом открытии, и второй проход сдвинул бы адреса ещё раз",
    file: "src/deviceMigrate.js",
    was: `    if (kind === "conditionerKind") continue;`,
    now: "",
    tests: ["test/deviceMigrate.test.js"],
  },
  // ——— трубы открытия: файл и база открывают объект одинаково ————————————————
  //
  // Правило одно на две трубы (`projectFile.migrateProject` и
  // `panels/projects.js: projectsMigrateStored`), а записей две — по записи на
  // трубу. Иначе сказать «обе спрашивают одно и то же» нечем: порчу в одной
  // красный тест другой не ловит, а объект, открытый из базы иначе, чем из
  // архива, — это уже два разных объекта у одного человека.
  {
    rule: "thingsOnceFile",
    said: "труба файла спрашивает «объект уже переведён?» у объекта, каким он пришёл: спроси она у перенумерованного — вещи не достроились бы ни разу",
    file: "src/projectFile.js",
    was: `thingMarksMigrated(loaded)`,
    now: `thingMarksMigrated(renumbered)`,
    tests: ["test/markObjectMigrate.test.js"],
  },
  {
    rule: "futureVersion",
    said: "файл более новой сборки отвергается внятным отказом, а не читается наполовину",
    file: "src/projectFile.js",
    was: `  if (version > FORMAT_VERSION_MAX) {
    throw fileError("futureVersion", { version, current: FORMAT_VERSION_MAX });
  }
`,
    now: "",
    tests: ["test/projectFile.test.js", "test/scenarioLibFormat.test.js"],
  },
  {
    rule: "packVerify",
    said: "собранный файл читается обратно тем же кодом, которым его прочитает человек: отдать резервную копию непрочитанной значит узнать о сбое в день восстановления",
    file: "src/projectFile.js",
    was: `  if (options.verify !== false) {
    await verifyProjectFile(blob, forFile, images, { onProgress, member: options.member });
  }
`,
    now: "",
    tests: ["test/projectFile.test.js"],
  },
  {
    rule: "libraryDoor",
    said: "дверь узнавания библиотечного скрипта доезжает до миграции: иначе файл и база переводят сценарии на ссылку по-разному",
    file: "src/projectFile.js",
    was: `      options.library,`,
    now: `      null,`,
    tests: ["test/scenarioLibLegacy.test.js"],
  },
  {
    rule: "thingsOnceStored",
    said: "труба базы спрашивает «объект уже переведён?» у объекта, каким он лёг в базу: снятую рукой связь второе открытие не возвращает",
    file: "src/panels/projects.js",
    was: `thingMarksMigrated(stored)`,
    now: `thingMarksMigrated(renumbered)`,
    tests: ["test/markObjectMigrate.test.js"],
  },
  {
    rule: "storedDevices",
    said: "труба базы переводит аксессуары тем же `migrateDevices`, что и труба файла: иначе один объект открывался бы по-разному из базы и из архива",
    file: "src/panels/projects.js",
    was: `  const devices = migrateDevices(numbered).project;`,
    now: `  const devices = numbered;`,
    tests: ["test/deviceModel.test.js"],
  },
  {
    rule: "storedVersion",
    said: "объект из базы уносит версию формата, посчитанную **по содержимому**: в базе он лежал пятёркой и на следующем открытии выглядел бы непереведённым (ADR 030)",
    file: "src/panels/projects.js",
    was: `  const version = projectFormatVersion(devices);`,
    now: `  const version = Number(devices.formatVersion) || 0;`,
    tests: ["test/markObjectMigrate.test.js"],
  },
];
