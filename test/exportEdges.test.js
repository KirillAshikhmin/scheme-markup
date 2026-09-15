// Края выгруженного листа: подпись метки у стены не должна уезжать за обрез.
//
// Считает это чистая геометрия (`exportFitArea` зовёт только render и модель),
// поэтому проверяется в Node. Рамку подписи тест берёт у `render.labelBox` —
// у того же кода, который её рисует, а не пересчитывает своей формулой.
import { test } from "node:test";
import assert from "node:assert/strict";
import { addMark, addScheme, createProject, findMark } from "../src/model.js";
import { labelBox } from "../src/render.js";
import { exportFitArea } from "../src/exporter.js";

function edgesFixture(x, y) {
  let project = createProject({ name: "Квартира на Ленина" });
  const added = addScheme(project, { name: "1 этаж", width: 1000, height: 800 });
  project = added.project;
  const scheme = added.scheme;
  const typeId = project.markTypes.find((type) => type.code === "Р").id;
  const put = addMark(project, { schemeId: scheme.id, typeId, kind: "point", points: [{ x, y }] });
  project = put.project;
  return { project, scheme, markId: put.mark.id };
}

function edgesView(project) {
  return {
    zoom: 1,
    offsetX: 0,
    offsetY: 0,
    markSize: project.view.markSize,
    labelSize: project.view.labelSize,
  };
}

function edgesInside(area, box) {
  return (
    box.x >= area.x &&
    box.x + box.width <= area.x + area.width &&
    box.y >= area.y &&
    box.y <= area.y + area.height
  );
}

test("подпись метки у правой стены попадает на лист: холст вырастает полем", () => {
  const { project, scheme, markId } = edgesFixture(0.995, 0.5);
  const fitted = exportFitArea(project, scheme, { area: "all" });

  assert.ok(fitted.area.x + fitted.area.width > scheme.width, "лист шире плана");
  const box = labelBox(project, scheme, findMark(project, markId), edgesView(project), null);
  assert.ok(edgesInside(fitted.area, box), "подпись внутри листа");
  assert.deepEqual(fitted.missed, []);
});

test("метка у левого верхнего угла отодвигает начало листа в минус", () => {
  const { project, scheme, markId } = edgesFixture(0.004, 0.006);
  const fitted = exportFitArea(project, scheme, { area: "all" });

  assert.ok(fitted.area.x < 0 && fitted.area.y < 0, "поле слева и сверху");
  const box = labelBox(project, scheme, findMark(project, markId), edgesView(project), null);
  assert.ok(edgesInside(fitted.area, box), "подпись внутри листа");
});

test("на плане без меток поля не появляются, а чужие метки не растягивают кадр", () => {
  let { project, scheme } = edgesFixture(0.5, 0.5);
  const empty = exportFitArea(project, { ...scheme, id: "другая" }, { area: "all" });
  assert.deepEqual(empty.area, { x: 0, y: 0, width: 1000, height: 800 });

  // «Как вижу»: метка в кадре кадр расширяет, метка снаружи — нет.
  const far = exportFitArea(project, scheme, { area: { x: 0, y: 0, width: 200, height: 200 } });
  assert.deepEqual(far.area, { x: 0, y: 0, width: 200, height: 200 });

  const near = exportFitArea(project, scheme, { area: { x: 400, y: 400, width: 200, height: 200 } });
  assert.ok(near.area.width > 200 || near.area.height > 200, "кадр вырос под подпись метки внутри него");
});
