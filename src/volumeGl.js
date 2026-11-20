// Отрисовка «Объёма» видеокартой: three.js копией рядом со страницей (правка
// 2026-11-20, ADR 042).
//
// Слова заказчика: «Не устраивает сейчас — артефакты при освещении,
// производительность… достаточно плоская картинка», после прототипов — «мне
// нравится three.js, свет и тени. Давай этот вариант и сделаем, но включаемым и
// включённым по умолчанию с теми же параметрами качества, как на демке. Ну и с
// возможностью откатиться на старую отрисовку».
//
// Что здесь и чего нет:
//
//   - **сцена та же** (`volumeScene`): грани, помещения, места меток. Этот
//     модуль превращает их в сетку (`volume/mesh.js`) и рисует с буфером
//     глубины, светом ламп, солнцем и тенями. Камера, ходьба, щелчок, прицел,
//     миникарта, фон — всё прежнее и живёт там же, где жило;
//   - **картинка возвращается холстом**, а не встаёт вторым слоем: окно
//     «Объёма» кладёт её в свой кадр `drawImage` между фоном и накладками.
//     Порядок «фон → дом → сцена → дом → миникарта» и снимок вида остаются
//     одним холстом, как были;
//   - **прежний рисовальщик не тронут** и остаётся запасным путём: библиотека
//     не загрузилась (страница с диска, старый кэш), у браузера нет WebGL,
//     контекст потерян, человек снял отметку — кадр рисует Canvas 2D.
//
// Библиотека грузится как brotli (`brotliCodec.js`, там же причины): файлом из
// `./vendor/`, динамическим `import` с адресом в переменной — статический
// втянул бы 690 КБ в бандл обеих страниц.
//
// Параметры качества — уровень «Свет и тени» прототипа: тональная кривая ACES,
// мягкие тени, карта теней солнца 2048, восемь источников «вниз» конусом (два
// ближайших с тенями 1024), три «во все стороны» и один отражённый.

import {
  VOLUME_FOV_DEG,
  VOLUME_LAYER_BASE,
  VOLUME_MESH_SCALE,
  VOLUME_NIGHT_SHARE,
  volumeMeshArtLift,
  volumeMeshBuild,
  volumeMeshLampPick,
  volumeMeshLinear,
  volumeMeshThingShift,
} from "./volume.js";

/** Копия three.js рядом со страницей (`web/vendor/three/`, версия — в README там же). */
export const VOLUME_GL_MODULE = "./vendor/three/three.module.min.js";

/** Источников у видеокарты: число постоянно, погашенные стоят с нулевой силой. */
export const VOLUME_GL_SPOTS = 8;
/** Половина угла конуса: обычного потолочного и узкого луча бра «вверх и вниз»; во сколько раз узкий ярче. */
const VOLUME_GL_SPOT_ANGLE = 1.25;
const VOLUME_GL_NARROW_ANGLE = 0.42;
const VOLUME_GL_NARROW_GAIN = 2.2;
export const VOLUME_GL_POINTS = 5;
export const VOLUME_GL_SHADOWED = 2;
/** Сила источника на единицу мощности лампы сцены (подобрано на прототипе). */
export const VOLUME_GL_LAMP_GAIN = 3.6;

let volumeGlPromise = null;

/**
 * Библиотека: одна загрузка на вкладку. Не загрузилась — `null`, и это ответ,
 * а не ошибка: окно рисует прежним способом.
 */
export function volumeGlLoad() {
  if (!volumeGlPromise) {
    const path = VOLUME_GL_MODULE;
    volumeGlPromise = import(path).then(
      (module) => (module && module.WebGLRenderer ? module : null),
      () => null,
    );
  }
  return volumeGlPromise;
}

const volumeGlMix = (a, b, share) => a.map((value, at) => value + (b[at] - value) * share);
const VOLUME_GL_SKY = { day: [223, 233, 245], evening: [242, 201, 168], night: [143, 160, 216] };
const VOLUME_GL_LAND = { day: [139, 133, 119], evening: [107, 90, 80], night: [42, 47, 69] };
const VOLUME_GL_SUN = { high: [255, 244, 214], low: [255, 154, 90] };

/** Три ступени суток одним числом `day` (1 — день, 0 — ночь), как у неба кадра. */
function volumeGlDayRgb(table, day) {
  return day > 0.5 ? volumeGlMix(table.evening, table.day, (day - 0.5) * 2) : volumeGlMix(table.night, table.evening, day * 2);
}

/**
 * Рисовальщик. `THREE` — загруженная библиотека. Бросает, если WebGL у
 * браузера нет: окно ловит и остаётся на прежней отрисовке.
 */
export function volumeGlMake(THREE) {
  const S = VOLUME_MESH_SCALE;
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  // Карты теней пересчитываются не каждый кадр, а когда меняется то, что их
  // определяет: сцена, набор и места ламп, солнце (`shadowKey`). Тень теперь у
  // каждой лампы — иначе свет проходит сквозь стены (дефект заказчика:
  // «включил свет в туалете за глухой стеной, а свет попадает и в гостиную»).
  renderer.shadowMap.autoUpdate = false;
  renderer.setClearColor(0x000000, 0);
  renderer.setPixelRatio(1);
  const canvas = renderer.domElement;
  let lost = false;
  canvas.addEventListener("webglcontextlost", (event) => {
    event.preventDefault();
    lost = true;
  });

  const world = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(60, 1, 0.08, 2500);

  const mats = {
    // Тень бросает **лицо** грани (`shadowSide`), а не изнанка, как библиотека
    // делает по умолчанию: у стены в десять сантиметров изнанка — это уже
    // поверхность соседней комнаты, и свет сочился на неё по краям проёмов и
    // у подножия стен (дефект заказчика: «свет через стены проходит… ещё и на
    // соседние стены падает»).
    solid: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0, shadowSide: THREE.FrontSide }),
    clear: new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide, transparent: true, depthWrite: false }),
    line: new THREE.LineBasicMaterial({ vertexColors: true }),
    // Светящееся (тело горящей лампы, диод, экран) и накладки кадра — без света
    // и без тональной кривой: цвет тот, что назван.
    glow: new THREE.MeshBasicMaterial({ vertexColors: true, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, toneMapped: false }),
    over: new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3, toneMapped: false }),
    overClear: new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide, transparent: true, depthWrite: false, toneMapped: false }),
    overLine: new THREE.LineBasicMaterial({ vertexColors: true, toneMapped: false }),
    // Земля плиты — только тень: сама земля нарисована фоном, и свой цвет у
    // плиты дал бы светлый прямоугольник вокруг дома.
    land: new THREE.ShadowMaterial({ opacity: 0.32 }),
  };

  const empty = () => new THREE.BufferGeometry();
  const geometry = (data, size) => {
    const out = new THREE.BufferGeometry();
    out.setAttribute("position", new THREE.BufferAttribute(data.pos, 3));
    if (data.nor) out.setAttribute("normal", new THREE.BufferAttribute(data.nor, 3));
    out.setAttribute("color", new THREE.BufferAttribute(data.col, size));
    return out;
  };
  const swap = (node, next) => {
    node.geometry.dispose();
    node.geometry = next;
    node.visible = next.getAttribute("position") !== undefined && next.getAttribute("position").count > 0;
  };

  const solid = new THREE.Mesh(empty(), mats.solid);
  solid.castShadow = true;
  solid.receiveShadow = true;
  const glass = new THREE.Mesh(empty(), mats.clear);
  glass.renderOrder = 2;
  // Тела светильников тени не бросают (дефект заказчика: «свет от люстры
  // неверно рассчитывается, откуда там такая тень?»): источник стоит внутри
  // самого светильника, и его плафоны закрывали бы от него полкомнаты.
  const fixtures = new THREE.Mesh(empty(), mats.solid);
  fixtures.receiveShadow = true;
  const land = new THREE.Mesh(empty(), mats.land);
  land.receiveShadow = true;
  const lines = new THREE.LineSegments(empty(), mats.line);
  const led = new THREE.Mesh(empty(), mats.glow);
  led.renderOrder = 1;
  const glow = new THREE.Mesh(empty(), mats.glow);
  glow.renderOrder = 1;
  const overSolid = new THREE.Mesh(empty(), mats.over);
  overSolid.renderOrder = 3;
  const overClear = new THREE.Mesh(empty(), mats.overClear);
  overClear.renderOrder = 4;
  const overLines = new THREE.LineSegments(empty(), mats.overLine);
  overLines.renderOrder = 5;
  world.add(solid, fixtures, land, glass, lines, led, glow, overSolid, overClear, overLines);

  const hemi = new THREE.HemisphereLight(0xdfe9f5, 0x8b8577, 1);
  const sun = new THREE.DirectionalLight(0xfff4d6, 0);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.bias = -0.0008;
  sun.shadow.normalBias = 0.05;
  world.add(hemi, sun, sun.target);
  // Потолочные светят вниз конусом (иначе на потолке у каждого — пересвеченное
  // пятно), настенные и напольные — во все стороны.
  const spots = [];
  for (let at = 0; at < VOLUME_GL_SPOTS; at += 1) {
    const lamp = new THREE.SpotLight(0xffe6c4, 0, 0, VOLUME_GL_SPOT_ANGLE, 0.9, 2);
    lamp.castShadow = true;
    // Ближним — карта подробнее, остальным хватает половины.
    lamp.shadow.mapSize.set(at < VOLUME_GL_SHADOWED ? 2048 : 1024, at < VOLUME_GL_SHADOWED ? 2048 : 1024);
    // Запас побольше: под скользящим светом стена шла рябью (дефект заказчика).
    lamp.shadow.bias = -0.003;
    lamp.shadow.normalBias = 0.03;
    lamp.shadow.camera.near = 0.05;
    lamp.shadow.camera.far = 12;
    world.add(lamp, lamp.target);
    spots.push(lamp);
  }
  const points = [];
  for (let at = 0; at < VOLUME_GL_POINTS; at += 1) {
    const lamp = new THREE.PointLight(0xffe6c4, 0, 0, 2);
    lamp.castShadow = true;
    lamp.shadow.mapSize.set(1024, 1024);
    lamp.shadow.bias = -0.003;
    lamp.shadow.normalBias = 0.03;
    lamp.shadow.camera.near = 0.05;
    lamp.shadow.camera.far = 14;
    world.add(lamp);
    points.push(lamp);
  }
  const fill = new THREE.PointLight(0xffe6c4, 0, 0, 2);
  // Отражённый свет тоже не ходит сквозь стены.
  fill.castShadow = true;
  fill.shadow.mapSize.set(512, 512);
  fill.shadow.bias = -0.003;
  fill.shadow.normalBias = 0.03;
  fill.shadow.camera.near = 0.05;
  fill.shadow.camera.far = 14;
  let shadowKey = "";
  world.add(fill);

  let sceneWas = null;
  let sceneStamp = 0;
  let litFaces = [];
  let glowKey = "";
  let overWas = null;
  let triangles = 0;
  let sizeKey = "";

  const linearRgb = (color, rgb) => color.setRGB(volumeMeshLinear(rgb[0] / 255), volumeMeshLinear(rgb[1] / 255), volumeMeshLinear(rgb[2] / 255));

  function sceneMesh(scene) {
    // Диоды и шкалы светятся всегда своим цветом; картинка экрана — только у
    // работающего прибора. Остальное — тело под светом.
    const isScreen = (face) => face.art === "screen";
    const isLand = (face) => face.layer === VOLUME_LAYER_BASE && face.flat === true;
    const isLed = (face) => Boolean(face.led) && !face.line && !isScreen(face);
    // Грани в одной плоскости разводятся выносом: вещи — по своему номеру,
    // фигуры полотна — по порядку записи (дефект заказчика: «на телевизоре
    // картинка артефактами идёт… или там, где плоскости пересекаются»).
    const art = volumeMeshArtLift();
    // Светильник — метка, у которой есть тело, способное светиться.
    const shining = new Set();
    for (const face of scene.faces) if (face.lit && face.markId && !face.art) shining.add(face.markId);
    const isFixture = (face) => Boolean(face.markId) && shining.has(face.markId) && !face.line && !(face.clear || face.alpha < 1);
    const mesh = volumeMeshBuild(scene.faces, {
      keep: (face) => !isLed(face) && !isScreen(face) && !isLand(face) && !isFixture(face),
      // Плита земли лежит в одной плоскости с полами (в кадре Canvas 2D их
      // разводил ярус): опускается на 4 мм (дефект заказчика: «у одноэтажных
      // объектов пересекаются фон земли и пола»).
      lift: (face) => (face.layer === VOLUME_LAYER_BASE ? -4 : face.art ? art(face) : 0),
      shift: volumeMeshThingShift,
      // Стены, полотна дверей и ворот уходят в пол на 12 см: у их подножия
      // карта теней пропускала полоску света из соседней комнаты.
      sink: (face) => (!face.markId && !face.thing && face.n && Math.abs(face.n.z) < 0.5 && !String(face.doorId || "").startsWith("thing:") ? 120 : 0),
    });
    swap(solid, geometry(mesh.solid, 3));
    swap(glass, geometry(mesh.clear, 4));
    swap(lines, geometry(mesh.lines, 3));
    swap(led, geometry(volumeMeshBuild(scene.faces, { keep: isLed, alpha: () => 1 }).solid, 3));
    swap(fixtures, geometry(volumeMeshBuild(scene.faces, { keep: (face) => isFixture(face) && !isLed(face) && !isScreen(face), shift: volumeMeshThingShift }).solid, 3));
    swap(land, geometry(volumeMeshBuild(scene.faces, { keep: isLand, alpha: () => 1, lift: () => -4 }).solid, 3));
    litFaces = scene.faces.filter((face) => !face.line && (face.lit || isScreen(face)) && face.markId);
    triangles = mesh.triangles;
    glowKey = "";
    // Тень солнца — на весь габарит сцены.
    const b = scene.boundsMm;
    if (b) {
      const reach = Math.max(8, (Math.hypot(b.maxX - b.minX, b.maxY - b.minY) * S) / 2 + 4);
      Object.assign(sun.shadow.camera, { left: -reach, right: reach, top: reach, bottom: -reach, near: 1, far: 140 });
      sun.shadow.camera.updateProjectionMatrix();
    }
  }

  function glowMesh(glowMap) {
    let key = "";
    if (glowMap && glowMap.size > 0 && litFaces.length > 0) {
      for (const [markId, item] of glowMap) {
        key += markId + ":" + Math.round((item.level || 0) * (item.fade === undefined ? 1 : item.fade) * 50) + ":" + (item.rgb || []).join(".") + (item.lamps ? JSON.stringify(item.lamps) : "") + ";";
      }
    }
    if (key === glowKey) return;
    glowKey = key;
    if (!key) {
      swap(glow, empty());
      return;
    }
    const shine = (face) => {
      const item = glowMap.get(face.markId);
      if (!item) return 0;
      // Ламп у устройства несколько (ель): тело горит, пока горит его лампа.
      if (item.lamps && Number.isInteger(face.bulb) && !item.lamps[face.bulb]) return 0;
      const fade = item.fade === undefined ? 1 : item.fade;
      return Math.max(0, Math.min(1, (item.level === undefined ? 1 : item.level) * fade));
    };
    const screen = volumeMeshArtLift();
    const mesh = volumeMeshBuild(litFaces, {
      // Стекло экрана — над телом, фигуры картинки — над стеклом и друг над другом.
      lift: (face) => (face.art === "screen" ? screen(face) : 0.5),
      shift: volumeMeshThingShift,
      keep: (face) => shine(face) > 0.01,
      alpha: () => 1,
      paint: (face) => {
        if (face.art === "screen") return face.rgb;
        const item = glowMap.get(face.markId);
        const share = 0.35 + 0.65 * shine(face);
        const rgb = item.rgb || [255, 240, 196];
        return [0, 1, 2].map((at) => Math.min(255, (face.rgb[at] * 0.25 + rgb[at] * 0.78) * share + face.rgb[at] * (1 - share)));
      },
    });
    swap(glow, geometry(mesh.solid, 3));
  }

  function overMesh(extra) {
    const list = extra && extra.length > 0 ? extra : null;
    const same = list && overWas && list.length === overWas.length && list.every((face, at) => face === overWas[at]);
    if (same || (!list && !overWas)) return;
    overWas = list ? [...list] : null;
    if (!list) {
      swap(overSolid, empty());
      swap(overClear, empty());
      swap(overLines, empty());
      return;
    }
    const mesh = volumeMeshBuild(list);
    swap(overSolid, geometry(mesh.solid, 3));
    swap(overClear, geometry(mesh.clear, 4));
    swap(overLines, geometry(mesh.lines, 3));
  }

  function look(mood, scene) {
    const tint = mood && mood.tint;
    const night = Math.max(0, Math.min(1, (Number(tint && tint.share) || 0) / VOLUME_NIGHT_SHARE));
    const day = 1 - night;
    // Ночью без ламп комната не чёрная: планировку должно быть видно.
    hemi.intensity = 0.45 + (2.1 - 0.45) * day * day;
    linearRgb(hemi.color, volumeGlDayRgb(VOLUME_GL_SKY, day));
    linearRgb(hemi.groundColor, volumeGlDayRgb(VOLUME_GL_LAND, day));
    const shadow = mood && mood.shadow;
    const fade = shadow ? Math.max(0, Math.min(1, Number(shadow.fade) || 0)) : 0;
    const rise = shadow ? Number(shadow.rise) || 0 : 0;
    if (fade > 0 && rise > 0) {
      const high = Math.max(0, Math.min(1, (rise - 4) / 16));
      sun.intensity = (1.6 + (3.6 - 1.6) * high) * fade;
      linearRgb(sun.color, volumeGlMix(VOLUME_GL_SUN.low, VOLUME_GL_SUN.high, high));
      const b = scene.boundsMm || { minX: 0, maxX: 0, minY: 0, maxY: 0 };
      const cx = ((b.minX + b.maxX) / 2) * S;
      const cz = ((b.minY + b.maxY) / 2) * S;
      const az = ((Number(shadow.az) || 0) * Math.PI) / 180;
      const up = (Math.max(rise, 3) * Math.PI) / 180;
      const far = 60;
      sun.target.position.set(cx, 0, cz);
      sun.position.set(cx + Math.cos(az) * Math.cos(up) * far, Math.sin(up) * far, cz + Math.sin(az) * Math.cos(up) * far);
    } else {
      sun.intensity = 0;
    }
  }

  function lampsPlace(list, eye) {
    const pick = volumeMeshLampPick(list || [], eye, { spots: VOLUME_GL_SPOTS, points: VOLUME_GL_POINTS });
    for (let at = 0; at < VOLUME_GL_SPOTS; at += 1) {
      const node = spots[at];
      const item = pick.spots[at];
      if (!item) {
        node.intensity = 0;
        continue;
      }
      node.position.set(item.x * S, (item.aim ? item.z : item.z - 60) * S, item.y * S);
      // Подсветка картины целит в стену под собой, остальные — отвесно вниз.
      if (item.aim) node.target.position.set(item.aim.x * S, item.aim.z * S, item.aim.y * S);
      else node.target.position.set(item.x * S, -10, item.y * S);
      // Луч бра «вверх и вниз» узкий: на стене от него клин, а не зарево.
      // Узкий конус собирает тот же поток в меньший угол — силу множим.
      node.angle = item.narrow ? VOLUME_GL_NARROW_ANGLE : VOLUME_GL_SPOT_ANGLE;
      node.penumbra = item.narrow ? 0.55 : 0.9;
      node.intensity = VOLUME_GL_LAMP_GAIN * item.power * (item.narrow ? VOLUME_GL_NARROW_GAIN : 1);
      linearRgb(node.color, item.rgb);
    }
    for (let at = 0; at < VOLUME_GL_POINTS; at += 1) {
      const node = points[at];
      const item = pick.points[at];
      if (!item) {
        node.intensity = 0;
        continue;
      }
      // Люстра под самым потолком светит из-под себя, а не из перекрытия.
      node.position.set(item.x * S, (item.hang ? item.z - 250 : item.z) * S, item.y * S);
      // Люстра на подвесе светит сильнее бра и торшера: она главный свет комнаты.
      node.intensity = VOLUME_GL_LAMP_GAIN * (item.hang ? 0.55 : 0.35) * item.power;
      linearRgb(node.color, item.rgb);
    }
    if (pick.fill) {
      fill.position.set(pick.fill.x * S, 1.1, pick.fill.y * S);
      // Отражённый свет: от него светлеет потолок над потолочными светильниками.
      fill.intensity = VOLUME_GL_LAMP_GAIN * 0.13 * pick.fill.power;
    } else fill.intensity = 0;
    return pick;
  }

  /**
   * Кадр. `frame`: `scene`, `eye` (`{at, yaw, pitch}`), `box`, `ratio`, `mood`
   * (снимок часа), `lamps` (`volumeMeshLamps`), `glow` (карта свечения
   * `volumeLiveLight().glow`), `extra` (грани поверх сцены: выделение,
   * признаки работы), `inside` — глаз в помещении.
   * Возвращает холст с картинкой или `null`, если рисовать нечем.
   */
  function draw(frame) {
    if (lost) return null;
    const scene = frame.scene;
    if (!scene || scene.empty) return null;
    const width = Math.max(1, Math.round(frame.box.width * frame.ratio));
    const height = Math.max(1, Math.round(frame.box.height * frame.ratio));
    const key = width + "x" + height;
    if (key !== sizeKey) {
      sizeKey = key;
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      // Как у кадра Canvas 2D: поле зрения меряется по длинной стороне окна.
      const focal = Math.max(width, height) / 2 / Math.tan(((VOLUME_FOV_DEG / 2) * Math.PI) / 180);
      camera.fov = (2 * Math.atan(height / 2 / focal) * 180) / Math.PI;
      camera.updateProjectionMatrix();
    }
    if (scene !== sceneWas) {
      sceneWas = scene;
      sceneMesh(scene);
      sceneStamp += 1;
    }
    glowMesh(frame.glow || null);
    overMesh(frame.extra || null);
    look(frame.mood, scene);
    const eye = frame.eye;
    lampsPlace(frame.lamps, eye.at);
    // Снаружи ближняя плоскость отодвигается: буферу глубины на десятках метров
    // иначе не хватает точности развести близкие плоскости.
    const near = frame.inside ? 0.08 : 0.5;
    if (camera.near !== near) {
      camera.near = near;
      camera.updateProjectionMatrix();
    }
    const yaw = eye.yaw || 0;
    const pitch = eye.pitch || 0;
    const cp = Math.cos(pitch);
    const px = eye.at.x * S;
    const py = eye.at.z * S;
    const pz = eye.at.y * S;
    camera.position.set(px, py, pz);
    // «Вверх» — как у `volumeBasis`: при взгляде отвесно вниз кадр не переворачивается.
    camera.up.set(-Math.sin(pitch) * Math.cos(yaw), cp, -Math.sin(pitch) * Math.sin(yaw));
    camera.lookAt(px + Math.cos(yaw) * cp, py + Math.sin(pitch), pz + Math.sin(yaw) * cp);
    // Что определяет тени: сцена, где стоят и горят ли источники, где солнце.
    let lit = String(sceneStamp);
    for (const node of [...spots, ...points, fill, sun]) {
      lit += "|" + (node.intensity > 0 ? Math.round(node.position.x * 50) + "," + Math.round(node.position.y * 50) + "," + Math.round(node.position.z * 50) : "-");
    }
    if (lit !== shadowKey) {
      shadowKey = lit;
      renderer.shadowMap.needsUpdate = true;
    }
    renderer.render(world, camera);
    return canvas;
  }

  function drop() {
    for (const node of [solid, fixtures, land, glass, lines, led, glow, overSolid, overClear, overLines]) node.geometry.dispose();
    for (const name of Object.keys(mats)) mats[name].dispose();
    renderer.dispose();
    sceneWas = null;
  }

  return { canvas, draw, drop, lost: () => lost, triangles: () => triangles };
}
