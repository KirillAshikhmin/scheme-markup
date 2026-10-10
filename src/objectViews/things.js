// Изображения объектов на развёртке: сантехника, электроприборы, карнизы.
import { viewArc, viewCircle, viewDrop, viewLine, viewParts, viewPlate, viewRect } from "./kit.js";

export const VIEWS_THINGS = {
  // Выход канализации: раструб с крестовиной.
  drain: {
    shapes: [],
    mm: { width: 110, height: 110 },
    parts: viewParts(
      viewCircle(0, 0, 0.32),
      viewCircle(0, 0, 0.18),
      viewLine(-0.32, 0, 0.32, 0),
      viewLine(0, -0.32, 0, 0.32),
    ),
  },
  // Кран с электроприводом: корпус крана с рукояткой привода.
  valve: {
    shapes: ["circle-valve"],
    mm: { width: 100, height: 100 },
    parts: viewParts(
      viewCircle(0, 0.08, 0.26),
      viewLine(-0.44, 0.08, -0.26, 0.08),
      viewLine(0.26, 0.08, 0.44, 0.08),
      viewLine(0, -0.18, 0, -0.42),
      viewLine(-0.18, -0.42, 0.18, -0.42),
    ),
  },
  // Водорозетка: вывод трубы с капелькой.
  waterOutlet: {
    shapes: [],
    mm: { width: 60, height: 60 },
    parts: viewParts(viewCircle(0, 0, 0.3), viewCircle(0, 0, 0.12), viewDrop(0, 0.34, 0.14)),
  },
  // Робот-пылесос: шайба сбоку, с бампером и колёсами.
  vacuum: {
    shapes: ["trapezoid-bar"],
    mm: { width: 350, height: 100 },
    parts: viewParts(
      viewRect(-0.5, -0.3, 1, 0.6, 0.26),
      viewLine(-0.5, 0.1, 0.5, 0.1),
      viewCircle(-0.26, 0.2, 0.08),
      viewCircle(0.26, 0.2, 0.08),
    ),
  },
  // Сушилка, дверца с приводом и прочая техника: коробка с приводом.
  appliance: {
    shapes: ["square-bolt", "square-ring"],
    mm: { width: 400, height: 500 },
    parts: viewParts(
      viewPlate(0.04, 0.08),
      viewLine(-0.42, -0.18, 0.42, -0.18),
      viewCircle(0, 0.16, 0.16),
      viewLine(0, 0.16, 0.1, 0.06),
    ),
  },
  // Карниз штор: труба на кронштейнах и складки ткани.
  curtainRail: {
    shapes: ["diamond"],
    mm: { width: 400, height: 120 },
    parts: viewParts(
      viewLine(-0.5, -0.28, 0.5, -0.28),
      viewLine(-0.5, -0.16, 0.5, -0.16),
      viewLine(-0.3, -0.16, -0.3, -0.34),
      viewLine(0.3, -0.16, 0.3, -0.34),
      [-0.3, 0, 0.3].map((x) => viewArc(x, 0.12, 0.16, Math.PI, 0, false)),
    ),
  },
};
