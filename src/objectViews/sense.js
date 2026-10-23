// Изображения объектов на развёртке: датчики и камера.
import { viewArc, viewCircle, viewDrop, viewLine, viewParts, viewPoly, viewRect, viewWaves } from "./kit.js";

export const VIEWS_SENSE = {
  // Датчик климата (правка после сборки сценариев): «3 шкалы вертикальных как
  // на ртутном градуснике» — корпус, три трубки и шарик под каждой.
  climateSensor: {
    // Знак свой у типа (поле `view`), за формой изображение не закрепляется.
    shapes: [],
    mm: { width: 80, height: 120 },
    parts: viewParts(
      viewRect(-0.5, -0.5, 1, 1, 0.1),
      viewRect(-0.34, -0.38, 0.12, 0.62, 0.06),
      viewRect(-0.06, -0.38, 0.12, 0.62, 0.06),
      viewRect(0.22, -0.38, 0.12, 0.62, 0.06),
      viewCircle(-0.28, 0.32, 0.08),
      viewCircle(0, 0.32, 0.08),
      viewCircle(0.28, 0.32, 0.08),
    ),
  },
  // Присутствие: купол с дугами обзора.
  presence: {
    shapes: ["circle-fan"],
    mm: { width: 70, height: 70 },
    parts: viewParts(
      viewArc(0, -0.16, 0.26, Math.PI, 0, true),
      viewWaves(0, -0.16, [0.36, 0.46], 0.35, Math.PI - 0.35),
    ),
  },
  // Движение: коробочка с линзой.
  motion: {
    shapes: ["triangle-dot"],
    mm: { width: 70, height: 70 },
    parts: viewParts(
      viewRect(-0.34, -0.4, 0.68, 0.56, 0.14),
      viewCircle(0, -0.12, 0.14),
      viewWaves(0, -0.12, [0.34, 0.44], 0.4, Math.PI - 0.4),
    ),
  },
  // Открытие: две части — на створке и на раме.
  opening: {
    shapes: ["square-split"],
    mm: { width: 70, height: 40 },
    parts: viewParts(
      viewRect(-0.46, -0.3, 0.5, 0.6, 0.08),
      viewRect(0.12, -0.2, 0.34, 0.4, 0.08),
      viewLine(0.04, 0, 0.12, 0),
    ),
  },
  // Протечка: шайба с каплей и усами-электродами.
  leak: {
    shapes: ["drop"],
    mm: { width: 60, height: 60 },
    parts: viewParts(
      viewCircle(0, -0.04, 0.3),
      viewDrop(0, -0.08, 0.16),
      viewLine(-0.16, 0.3, -0.16, 0.44),
      viewLine(0.16, 0.3, 0.16, 0.44),
    ),
  },
  // Камера: корпус с объективом на кронштейне.
  camera: {
    shapes: ["diamond-ring"],
    mm: { width: 120, height: 80 },
    parts: viewParts(
      viewRect(-0.46, -0.24, 0.6, 0.44, 0.08),
      viewPoly([[0.14, -0.14], [0.4, -0.3], [0.4, 0.26], [0.14, 0.1]], true),
      viewLine(-0.2, 0.2, -0.2, 0.42),
    ),
  },
};
