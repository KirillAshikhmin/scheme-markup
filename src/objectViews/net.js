// Изображения объектов на развёртке: сеть, домофон, кинотеатр, панели.
import { viewCircle, viewLine, viewLouvers, viewParts, viewPlate, viewRect, viewWaves } from "./kit.js";

export const VIEWS_NET = {
  // Точка WiFi: плоский корпус с дугами.
  wifi: {
    shapes: ["circle-wave"],
    mm: { width: 120, height: 120 },
    parts: viewParts(
      viewRect(-0.4, 0.06, 0.8, 0.28, 0.12),
      viewWaves(0, 0.06, [0.2, 0.32, 0.44], Math.PI + 0.5, -0.5),
    ),
  },
  // Умная колонка: цилиндр с сеткой.
  speaker: {
    shapes: ["circle-antenna"],
    mm: { width: 150, height: 180 },
    parts: viewParts(viewRect(-0.32, -0.42, 0.64, 0.84, 0.2), viewLouvers(3, -0.2, 0.2, -0.22, 0.22)),
  },
  // Панель управления: плашка с экраном.
  panelControl: {
    shapes: ["square-jack"],
    mm: { width: 120, height: 120 },
    parts: viewParts(viewPlate(), viewRect(-0.26, -0.26, 0.52, 0.38, 0.04), viewLine(-0.14, 0.26, 0.14, 0.26)),
  },
  // Домофон: панель с экраном и кнопкой.
  intercom: {
    shapes: ["triangle-down", "triangle-down-fill"],
    mm: { width: 150, height: 200 },
    parts: viewParts(viewPlate(), viewRect(-0.28, -0.36, 0.56, 0.4, 0.05), viewCircle(0, 0.24, 0.1)),
  },
  // Проектор: корпус с объективом и креплением.
  projector: {
    shapes: ["diamond-dot"],
    mm: { width: 300, height: 120 },
    parts: viewParts(
      viewRect(-0.5, -0.34, 0.86, 0.68, 0.1),
      viewCircle(0.36, 0, 0.16),
      viewLine(-0.3, 0.34, -0.3, 0.46),
      viewLine(0.12, 0.34, 0.12, 0.46),
    ),
  },
  // Ресивер: плоский корпус с окошком.
  receiver: {
    shapes: ["square-wave"],
    mm: { width: 430, height: 80 },
    parts: viewParts(
      viewRect(-0.5, -0.4, 1, 0.8, 0.08),
      viewRect(-0.3, -0.16, 0.34, 0.32, 0.04),
      viewCircle(0.3, 0, 0.12),
    ),
  },
};
