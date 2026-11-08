import {
  BRANCH_COLORS,
  type Camera,
  type MindmapDocument,
  type Side,
} from "../domain/index";
export type LayoutNode = {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  lines: string[];
  side: Side;
  color: string;
  fontSize: number;
  hiddenCount: number;
};
export type LayoutEdge = {
  id: string;
  source: string;
  target: string;
  path: string;
  color: string;
};
export type Bounds = { x: number; y: number; width: number; height: number };
export type LayoutResult = {
  nodes: LayoutNode[];
  edges: LayoutEdge[];
  bounds: Bounds;
};
export type MeasureText = (text: string, fontSize: number) => number;
const FONT =
  '-apple-system,BlinkMacSystemFont,"Segoe UI","Noto Sans JP",sans-serif';
const measured = new Map<string, number>();
let context: CanvasRenderingContext2D | null | undefined;
export const measureText: MeasureText = (text, fontSize) => {
  const key = `${fontSize}:${text}`;
  const cached = measured.get(key);
  if (cached !== undefined) return cached;
  if (context === undefined)
    context =
      typeof document === "undefined"
        ? null
        : document.createElement("canvas").getContext("2d");
  let width: number;
  if (context) {
    context.font = `${fontSize}px ${FONT}`;
    width = context.measureText(text).width;
  } else
    width = Array.from(text).reduce(
      (sum, character) =>
        sum + (/[\u0020-\u007e]/.test(character) ? 0.6 : 1) * fontSize,
      0,
    );
  if (measured.size > 30000) measured.clear();
  measured.set(key, width);
  return width;
};
export function clearMeasurementCache() {
  measured.clear();
}
function wrap(
  text: string,
  fontSize: number,
  maximum: number,
  measure: MeasureText,
): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split("\n")) {
    if (!paragraph) {
      lines.push("");
      continue;
    }
    let line = "";
    for (const character of Array.from(paragraph)) {
      if (line && measure(line + character, fontSize) > maximum) {
        lines.push(line);
        line = character;
      } else line += character;
    }
    lines.push(line);
  }
  return lines;
}
export function layoutDocument(
  document: MindmapDocument,
  options: {
    includeCollapsed?: boolean;
    measureText?: MeasureText;
    maximumNodeHeights?: Record<string, number>;
  } = {},
): LayoutResult {
  const measure = options.measureText || measureText;
  const collapsed = options.includeCollapsed
    ? new Set<string>()
    : new Set(document.viewState.collapsedNodeIds);
  const sizes = new Map<
    string,
    {
      width: number;
      height: number;
      lines: string[];
      fontSize: number;
      span: number;
      descendants: number;
    }
  >();
  const verticalGap = 64;
  const horizontalGap = 96;
  const calculate = (id: string): number => {
    const node = document.nodes[id];
    const fontSize = node.style?.fontSize || (id === document.rootId ? 22 : 16);
    const maxWidth = id === document.rootId ? 360 : 320;
    const border = id === document.rootId ? 2 : 0;
    const inset = 24 + border;
    const lines = wrap(
      node.text || "トピック",
      fontSize,
      maxWidth - inset,
      measure,
    );
    const width = Math.ceil(
      Math.max(
        80,
        Math.min(
          maxWidth,
          Math.max(...lines.map((line) => measure(line, fontSize)), 0) + inset,
        ),
      ),
    );
    const height = Math.min(
      Math.ceil(lines.length * fontSize * 1.5 + 16 + border),
      options.maximumNodeHeights?.[id] ?? Infinity,
    );
    let descendants = 0;
    let childHeight = 0;
    for (const childId of node.childIds) {
      const span = calculate(childId);
      descendants += sizes.get(childId)!.descendants + 1;
      childHeight += span;
    }
    if (node.childIds.length > 1)
      childHeight += (node.childIds.length - 1) * verticalGap;
    const span = collapsed.has(id) ? height : Math.max(height, childHeight);
    sizes.set(id, { width, height, lines, fontSize, span, descendants });
    return span;
  };
  calculate(document.rootId);
  const nodes: LayoutNode[] = [];
  const edges: LayoutEdge[] = [];
  const rootSize = sizes.get(document.rootId)!;
  const root: LayoutNode = {
    id: document.rootId,
    x: -rootSize.width / 2,
    y: -rootSize.height / 2,
    ...rootSize,
    side: "right",
    color: "#69B4FF",
    hiddenCount: collapsed.has(document.rootId) ? rootSize.descendants : 0,
  };
  nodes.push(root);
  const place = (
    id: string,
    parent: LayoutNode,
    centerY: number,
    side: Side,
    inheritedColor: string,
  ) => {
    const source = document.nodes[id];
    const size = sizes.get(id)!;
    const color = source.style?.branchColor || inheritedColor;
    const node: LayoutNode = {
      id,
      x:
        side === "right"
          ? parent.x + parent.width + horizontalGap
          : parent.x - horizontalGap - size.width,
      y: centerY - size.height / 2,
      width: size.width,
      height: size.height,
      lines: size.lines,
      fontSize: size.fontSize,
      side,
      color,
      hiddenCount: collapsed.has(id) ? size.descendants : 0,
    };
    nodes.push(node);
    const fromX = side === "right" ? parent.x + parent.width : parent.x;
    const toX = side === "right" ? node.x : node.x + node.width;
    const fromY = parent.y + parent.height / 2;
    const toY = node.y + node.height / 2;
    const middle = (fromX + toX) / 2;
    edges.push({
      id: `${parent.id}:${id}`,
      source: parent.id,
      target: id,
      color,
      path: `M ${fromX} ${fromY} C ${middle} ${fromY}, ${middle} ${toY}, ${toX} ${toY}`,
    });
    if (collapsed.has(id)) return;
    const children = source.childIds;
    const total =
      children.reduce((sum, child) => sum + sizes.get(child)!.span, 0) +
      Math.max(0, children.length - 1) * verticalGap;
    let cursor = centerY - total / 2;
    for (const childId of children) {
      const span = sizes.get(childId)!.span;
      place(childId, node, cursor + span / 2, side, color);
      cursor += span + verticalGap;
    }
  };
  if (!collapsed.has(root.id)) {
    for (const side of ["left", "right"] as const) {
      const children = document.nodes[root.id].childIds.filter(
        (id) =>
          (document.layout === "logic"
            ? "right"
            : document.nodes[id].side || "right") === side,
      );
      const total =
        children.reduce((sum, id) => sum + sizes.get(id)!.span, 0) +
        Math.max(0, children.length - 1) * verticalGap;
      let cursor = -total / 2;
      for (const id of children) {
        const span = sizes.get(id)!.span;
        const index = document.nodes[root.id].childIds.indexOf(id);
        place(
          id,
          root,
          cursor + span / 2,
          side,
          BRANCH_COLORS[index % BRANCH_COLORS.length],
        );
        cursor += span + verticalGap;
      }
    }
  }
  const left = Math.min(...nodes.map((node) => node.x));
  const top = Math.min(...nodes.map((node) => node.y));
  const right = Math.max(...nodes.map((node) => node.x + node.width));
  const bottom = Math.max(...nodes.map((node) => node.y + node.height));
  return {
    nodes,
    edges,
    bounds: { x: left, y: top, width: right - left, height: bottom - top },
  };
}
export function screenToWorld(
  point: { x: number; y: number },
  camera: Camera,
): { x: number; y: number } {
  return {
    x: (point.x - camera.x) / camera.zoom,
    y: (point.y - camera.y) / camera.zoom,
  };
}
export function worldToScreen(
  point: { x: number; y: number },
  camera: Camera,
): { x: number; y: number } {
  return {
    x: point.x * camera.zoom + camera.x,
    y: point.y * camera.zoom + camera.y,
  };
}
export function fitCamera(
  bounds: Bounds,
  width: number,
  height: number,
  padding = 64,
): Camera {
  const zoom = Math.max(
    0.1,
    Math.min(
      3,
      (width - padding * 2) / Math.max(1, bounds.width),
      (height - padding * 2) / Math.max(1, bounds.height),
    ),
  );
  return {
    zoom,
    x: width / 2 - (bounds.x + bounds.width / 2) * zoom,
    y: height / 2 - (bounds.y + bounds.height / 2) * zoom,
  };
}
export function zoomCamera(
  camera: Camera,
  zoom: number,
  point: { x: number; y: number },
): Camera {
  const world = screenToWorld(point, camera);
  const next = Math.max(0.1, Math.min(3, zoom));
  return {
    zoom: next,
    x: point.x - world.x * next,
    y: point.y - world.y * next,
  };
}
