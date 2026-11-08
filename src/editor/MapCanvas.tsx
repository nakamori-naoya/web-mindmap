import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { getDescendantIds, type Camera, type MindmapDocument } from "../domain";
import { clearMeasurementCache, layoutDocument } from "../layout";
import { NodeImage } from "./NodeImage";
export type Editing = {
  id: string;
  draft: string;
  original: string;
  beforeNew?: MindmapDocument;
};
type Props = {
  document: MindmapDocument;
  selected: string[];
  editing: Editing | null;
  onSelect(ids: string[]): void;
  onStartEdit(id: string): void;
  onDraft(value: string): void;
  onFinishEdit(): boolean;
  onCancelEdit(): void;
  onAdd(kind: "child" | "next" | "previous"): void;
  onMove(id: string, parentId: string, beforeId?: string): void;
  onCamera(camera: Camera): void;
  onToggle(id: string): void;
  onImageFiles(id: string, files: File[]): void;
  onImageOpen(id: string, index: number): void;
  onKey(event: ReactKeyboardEvent): void;
  onContextAction(
    action:
      | "child"
      | "sibling"
      | "edit"
      | "copy"
      | "paste"
      | "duplicate"
      | "delete"
      | "collapse",
  ): void;
  focusEnabled?: boolean;
  onActivate?(): void;
  canvasRef: React.RefObject<HTMLDivElement | null>;
};
type Gesture = {
  type: "pan" | "select" | "node";
  startX: number;
  startY: number;
  x: number;
  y: number;
  camera: Camera;
  id?: string;
  moved: boolean;
  target?: { id: string; placement: "before" | "after" | "child" };
};
export default function MapCanvas(props: Props) {
  const { document: doc, selected, editing, canvasRef } = props;
  const [fontGeneration, setFontGeneration] = useState(0);
  const preview = useMemo(() => {
    if (!editing || !doc.nodes[editing.id]) return doc;
    return {
      ...doc,
      nodes: {
        ...doc.nodes,
        [editing.id]: { ...doc.nodes[editing.id], text: editing.draft },
      },
    };
  }, [doc, editing?.id, editing?.draft]);
  const editingMaximumHeight = Math.max(
    120,
    ((canvasRef.current?.clientHeight || 600) - 96) / doc.viewState.camera.zoom,
  );
  const layout = useMemo(
    () =>
      layoutDocument(preview, {
        maximumNodeHeights: editing
          ? { [editing.id]: editingMaximumHeight }
          : undefined,
      }),
    [preview, fontGeneration, editing?.id, editingMaximumHeight],
  );
  const [menu, setMenu] = useState<{ x: number; y: number; id: string } | null>(
    null,
  );
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const composing = useRef(false);
  const [gesture, setGesture] = useState<Gesture | null>(null);
  const gestureRef = useRef<Gesture | null>(null);
  const spaceHeld = useRef(false);
  const spacePanned = useRef(false);
  const camera = doc.viewState.camera;
  useLayoutEffect(() => {
    if (!editing || props.focusEnabled === false || !canvasRef.current) return;
    const node = layout.nodes.find((value) => value.id === editing.id);
    if (!node) return;
    const canvas = canvasRef.current;
    const left = node.x * camera.zoom + camera.x;
    const top = node.y * camera.zoom + camera.y;
    const right = left + node.width * camera.zoom;
    const bottom = top + node.textHeight * camera.zoom;
    const dx =
      node.width * camera.zoom > canvas.clientWidth - 32
        ? 16 - left
        : left < 16
          ? 16 - left
          : right > canvas.clientWidth - 16
            ? canvas.clientWidth - 16 - right
            : 0;
    const dy =
      top < 16
        ? 16 - top
        : bottom > canvas.clientHeight - 16
          ? canvas.clientHeight - 16 - bottom
          : 0;
    if (Math.abs(dx) > 1 || Math.abs(dy) > 1)
      props.onCamera({ ...camera, x: camera.x + dx, y: camera.y + dy });
  }, [editing?.id, editing?.draft, layout, props.focusEnabled]);

  useEffect(() => {
    void window.document.fonts.ready.then(() => {
      clearMeasurementCache();
      setFontGeneration((value) => value + 1);
    });
  }, []);
  useEffect(() => {
    if (props.focusEnabled === false) return;
    if (selected.length === 1 && inputRef.current && !editing) {
      inputRef.current.focus({ preventScroll: true });
      inputRef.current.select();
    }
    if (
      editing &&
      inputRef.current &&
      window.document.activeElement !== inputRef.current
    ) {
      inputRef.current.focus({ preventScroll: true });
      inputRef.current.setSelectionRange(
        editing.draft.length,
        editing.draft.length,
      );
    }
  }, [selected[0], editing?.id, props.focusEnabled]);
  useEffect(() => {
    const keyDown = (e: KeyboardEvent) => {
      if (
        e.code === "Space" &&
        !(
          e.target instanceof HTMLInputElement ||
          e.target instanceof HTMLTextAreaElement ||
          (e.target as HTMLElement)?.isContentEditable
        )
      ) {
        if (!spaceHeld.current) spacePanned.current = false;
        spaceHeld.current = true;
        e.preventDefault();
      }
    };
    const keyUp = (e: KeyboardEvent) => {
      if (e.code === "Space" && spaceHeld.current) {
        spaceHeld.current = false;
        if (!spacePanned.current && selected[0]) props.onStartEdit(selected[0]);
      }
    };
    window.addEventListener("keydown", keyDown);
    window.addEventListener("keyup", keyUp);
    return () => {
      window.removeEventListener("keydown", keyDown);
      window.removeEventListener("keyup", keyUp);
    };
  });
  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const wheel = (event: WheelEvent) => {
      if (event.target instanceof HTMLTextAreaElement && editing) return;
      event.preventDefault();
      if (event.ctrlKey || event.metaKey) {
        const rect = el.getBoundingClientRect();
        const px = event.clientX - rect.left,
          py = event.clientY - rect.top;
        const zoom = Math.min(
          3,
          Math.max(0.1, camera.zoom * Math.exp(-event.deltaY * 0.01)),
        );
        props.onCamera({
          x: px - ((px - camera.x) * zoom) / camera.zoom,
          y: py - ((py - camera.y) * zoom) / camera.zoom,
          zoom,
        });
      } else
        props.onCamera({
          ...camera,
          x: camera.x - event.deltaX,
          y: camera.y - event.deltaY,
        });
    };
    el.addEventListener("wheel", wheel, { passive: false });
    return () => el.removeEventListener("wheel", wheel);
  }, [camera, editing, props.onCamera]);
  const world = (x: number, y: number) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    return {
      x: (x - rect.left - camera.x) / camera.zoom,
      y: (y - rect.top - camera.y) / camera.zoom,
    };
  };
  const updateGesture = (value: Gesture | null) => {
    gestureRef.current = value;
    setGesture(value);
  };
  const begin = (event: React.PointerEvent, id?: string) => {
    if (event.button !== 0 && event.button !== 1) return;
    const target = event.target as HTMLElement;
    if (
      target.closest("button,a") ||
      (editing && id === editing.id && target instanceof HTMLTextAreaElement)
    )
      return;
    if (editing && !props.onFinishEdit()) return;
    setMenu(null);
    if (id && event.shiftKey) {
      props.onSelect(
        selected.includes(id)
          ? selected.filter((value) => value !== id)
          : [...selected, id],
      );
      return;
    }
    if (id && !spaceHeld.current && event.button !== 1) props.onSelect([id]);
    const type =
      spaceHeld.current || event.button === 1 || (!id && !event.shiftKey)
        ? "pan"
        : id
          ? "node"
          : "select";
    if (type !== "node") event.preventDefault();
    if (type === "pan" && !id) props.onSelect([]);
    event.currentTarget.setPointerCapture(event.pointerId);
    updateGesture({
      type,
      startX: event.clientX,
      startY: event.clientY,
      x: event.clientX,
      y: event.clientY,
      camera,
      id,
      moved: false,
    });
  };
  const move = (event: React.PointerEvent) => {
    const g = gestureRef.current;
    if (!g) return;
    const moved =
      g.moved ||
      Math.hypot(event.clientX - g.startX, event.clientY - g.startY) >= 5;
    const next: Gesture = { ...g, x: event.clientX, y: event.clientY, moved };
    if (moved && g.type === "pan") {
      spacePanned.current = true;
      props.onCamera({
        ...camera,
        x: g.camera.x + event.clientX - g.startX,
        y: g.camera.y + event.clientY - g.startY,
      });
    }
    if (moved && g.type === "node" && g.id !== doc.rootId) {
      const point = world(event.clientX, event.clientY);
      const forbidden = new Set([g.id!, ...getDescendantIds(doc, g.id!)]);
      const target = layout.nodes.find(
        (node) =>
          !forbidden.has(node.id) &&
          point.x >= node.x - 16 &&
          point.x <= node.x + node.width + 16 &&
          point.y >= node.y - 16 &&
          point.y <= node.y + node.height + 16,
      );
      if (target) {
        const relative = (point.y - target.y) / target.height;
        next.target = {
          id: target.id,
          placement:
            target.id === doc.rootId
              ? "child"
              : relative < 0.24
                ? "before"
                : relative > 0.76
                  ? "after"
                  : "child",
        };
      } else next.target = undefined;
      const rect = canvasRef.current!.getBoundingClientRect();
      const velocity = (position: number, low: number, high: number) =>
        position < low + 40
          ? Math.min(14, (low + 40 - position) / 3)
          : position > high - 40
            ? -Math.min(14, (position - high + 40) / 3)
            : 0;
      const dx = velocity(event.clientX, rect.left, rect.right),
        dy = velocity(event.clientY, rect.top, rect.bottom);
      if (dx || dy)
        props.onCamera({ ...camera, x: camera.x + dx, y: camera.y + dy });
    }
    updateGesture(next);
  };
  const finish = () => {
    const g = gestureRef.current;
    if (!g) return;
    if (g.moved && g.type === "node" && g.id !== doc.rootId && g.target) {
      const target = doc.nodes[g.target.id];
      if (g.target.placement === "child") props.onMove(g.id!, target.id);
      else {
        const siblings = doc.nodes[target.parentId!].childIds;
        props.onMove(
          g.id!,
          target.parentId!,
          g.target.placement === "before"
            ? target.id
            : siblings[siblings.indexOf(target.id) + 1],
        );
      }
    }
    if (g.moved && g.type === "select") {
      const a = world(g.startX, g.startY),
        b = world(g.x, g.y);
      props.onSelect(
        layout.nodes
          .filter(
            (n) =>
              n.x + n.width >= Math.min(a.x, b.x) &&
              n.x <= Math.max(a.x, b.x) &&
              n.y + n.height >= Math.min(a.y, b.y) &&
              n.y <= Math.max(a.y, b.y),
          )
          .map((n) => n.id),
      );
    }
    updateGesture(null);
  };
  const rect = canvasRef.current?.getBoundingClientRect();
  const view = rect
    ? {
        x: -camera.x / camera.zoom - 100,
        y: -camera.y / camera.zoom - 100,
        width: rect.width / camera.zoom + 200,
        height: rect.height / camera.zoom + 200,
      }
    : null;
  const rendered = layout.nodes.filter(
    (n) =>
      selected.includes(n.id) ||
      editing?.id === n.id ||
      !view ||
      (n.x + n.width > view.x &&
        n.x < view.x + view.width &&
        n.y + n.height > view.y &&
        n.y < view.y + view.height),
  );
  return (
    <div
      ref={canvasRef}
      className={`canvas ${gesture?.moved ? "gesturing" : ""}`}
      role="region"
      aria-label="マインドマップキャンバス"
      tabIndex={0}
      onPointerDownCapture={() => props.onActivate?.()}
      onFocusCapture={() => props.onActivate?.()}
      onKeyDown={(event) => {
        if (menu && event.key === "Escape") {
          setMenu(null);
          event.preventDefault();
          return;
        }
        if (event.key === "Escape" && gestureRef.current) {
          updateGesture(null);
          event.preventDefault();
          return;
        }
        props.onKey(event);
      }}
      onPointerDown={(event) => {
        if (
          event.target === event.currentTarget ||
          (event.target as HTMLElement).classList.contains("world") ||
          (event.target as HTMLElement).tagName === "svg"
        )
          begin(event);
      }}
      onPointerMove={move}
      onPointerUp={finish}
      onPointerCancel={() => updateGesture(null)}
      onDragOver={event => { if (event.dataTransfer.types.includes("Files")) event.preventDefault(); }}
      onDrop={event => { if (event.dataTransfer.files.length) { event.preventDefault(); if (selected[0]) props.onImageFiles(selected[0], Array.from(event.dataTransfer.files)); } }}
    >
      <div className="canvas-grid" />
      {menu && (
        <div
          className="context-menu"
          role="menu"
          aria-label="トピックの操作"
          style={{ left: Math.max(0, menu.x), top: Math.max(0, menu.y) }}
          onPointerDown={(e) => e.stopPropagation()}
        >
          {(
            [
              ["edit", "本文を編集"],
              ["child", "子トピックを追加"],
              ["sibling", "兄弟トピックを追加"],
              ["copy", "コピー"],
              ["paste", "貼り付け"],
              ["duplicate", "複製"],
              [
                "collapse",
                doc.viewState.collapsedNodeIds.includes(menu.id)
                  ? "枝を展開"
                  : "枝を折り畳む",
              ],
              ["delete", "枝を削除"],
            ] as const
          ).map(([action, label]) => (
            <button
              key={action}
              role="menuitem"
              disabled={
                (action === "delete" && menu.id === doc.rootId) ||
                (action === "collapse" && !doc.nodes[menu.id].childIds.length)
              }
              onClick={() => {
                setMenu(null);
                props.onContextAction(action);
              }}
            >
              {label}
            </button>
          ))}
        </div>
      )}
      <div
        className="world"
        style={
          {
            transform: `translate(${camera.x}px, ${camera.y}px) scale(${camera.zoom})`,
            "--inverse-zoom": 1 / camera.zoom,
          } as React.CSSProperties
        }
      >
        <svg className="edges" aria-hidden="true">
          <g>
            {layout.edges.map((edge) => (
              <path
                key={edge.id}
                d={edge.path}
                stroke={edge.color}
                fill="none"
                strokeWidth={2.5}
              />
            ))}
          </g>
        </svg>
        {rendered.map((position) => {
          const node = doc.nodes[position.id];
          const isSelected = selected.includes(node.id),
            isEditing = editing?.id === node.id;
          const target =
            gesture?.target?.id === node.id ? gesture.target.placement : null;
          return (
            <div
              key={node.id}
              className={`topic ${node.images?.length ? "has-images" : ""} ${node.id === doc.rootId ? "root-topic" : ""} ${isSelected ? "selected" : ""} ${target ? `drop-${target}` : ""} ${gesture?.moved && gesture.id === node.id ? "drag-origin" : ""}`}
              data-node-id={node.id}
              data-side={position.side}
              style={
                {
                  left: position.x,
                  top: position.y,
                  width: position.width,
                  minHeight: position.height,
                  fontSize: position.fontSize,
                  "--branch": position.color,
                } as React.CSSProperties
              }
              onPointerDown={(event) => {
                event.stopPropagation();
                begin(event, node.id);
              }}
              onDoubleClick={() => props.onStartEdit(node.id)}
              onDragOver={event => { if (event.dataTransfer.types.includes("Files")) { event.preventDefault(); event.stopPropagation(); } }}
              onDrop={event => { if (event.dataTransfer.files.length) { event.preventDefault(); event.stopPropagation(); props.onImageFiles(node.id, Array.from(event.dataTransfer.files)); } }}
              onContextMenu={(event) => {
                event.preventDefault();
                if (editing && !props.onFinishEdit()) return;
                props.onSelect([node.id]);
                const rect = canvasRef.current!.getBoundingClientRect();
                setMenu({
                  id: node.id,
                  x: Math.min(event.clientX - rect.left, rect.width - 190),
                  y: Math.min(event.clientY - rect.top, rect.height - 370),
                });
              }}
            >
              {isSelected && selected.length === 1 ? (
                <textarea
                  ref={inputRef}
                  aria-label="トピック本文"
                  className={`node-input ${isEditing ? "editing" : ""}`}
                  value={isEditing ? editing.draft : node.text}
                  rows={Math.max(1, position.lines.length)}
                  spellCheck={false}
                  style={
                    isEditing
                      ? {
                          maxHeight: Math.max(32, Math.min(editingMaximumHeight - 18, position.textHeight - 16)),
                          overflowY: "auto",
                        }
                      : undefined
                  }
                  onCompositionStart={() => {
                    composing.current = true;
                    if (!isEditing) props.onStartEdit(node.id);
                  }}
                  onCompositionEnd={(event) => {
                    composing.current = false;
                    props.onDraft(event.currentTarget.value);
                  }}
                  onChange={(event) => {
                    if (!isEditing) props.onStartEdit(node.id);
                    props.onDraft(event.target.value);
                  }}
                  onKeyDown={(event) => {
                    if (
                      composing.current ||
                      event.nativeEvent.isComposing ||
                      event.keyCode === 229
                    ) {
                      event.stopPropagation();
                      return;
                    }
                    if (isEditing) {
                      event.stopPropagation();
                      if (event.key === "Enter" && !event.shiftKey) {
                        event.preventDefault();
                        props.onFinishEdit();
                      } else if (event.key === "Escape") {
                        event.preventDefault();
                        props.onCancelEdit();
                      } else if (event.key === "Tab") {
                        event.preventDefault();
                        if (props.onFinishEdit()) props.onAdd("child");
                      }
                    } else {
                      if (event.key === " ") {
                        event.preventDefault();
                        event.stopPropagation();
                        if (!spaceHeld.current) spacePanned.current = false;
                        spaceHeld.current = true;
                      } else if (event.key === "F2") {
                        event.preventDefault();
                        event.stopPropagation();
                        props.onStartEdit(node.id);
                      } else if (
                        event.key.length === 1 &&
                        !event.metaKey &&
                        !event.ctrlKey &&
                        !event.altKey
                      )
                        props.onStartEdit(node.id);
                    }
                  }}
                  onKeyUp={(event) => {
                    if (event.code === "Space" && spaceHeld.current) {
                      event.preventDefault();
                      event.stopPropagation();
                      spaceHeld.current = false;
                      if (!spacePanned.current) props.onStartEdit(node.id);
                    }
                  }}
                  onBlur={() => {
                    if (isEditing && !composing.current) props.onFinishEdit();
                  }}
                />
              ) : (
                <div className="node-text">{node.text}</div>
              )}
              {position.images?.map((attachment, index) => <div key={attachment.id} className="node-attachment" style={{ position: "absolute", left: attachment.x, top: attachment.y, width: attachment.width, height: attachment.height }}><NodeImage mapId={doc.documentId} imageId={attachment.id} label={`${node.text}の添付画像${index + 1}`} onOpen={() => props.onImageOpen(node.id, index)} /></div>)}
              {node.link && (
                <a
                  className="node-link"
                  href={node.link}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={`${node.text}のリンクを開く`}
                >
                  ↗
                </a>
              )}
              {node.note && (
                <span className="note-indicator" title="メモあり">
                  ≡
                </span>
              )}
              {node.childIds.length > 0 && (
                <button
                  className={`collapse ${position.side === "left" ? "left" : ""}`}
                  aria-label={
                    doc.viewState.collapsedNodeIds.includes(node.id)
                      ? `${node.text}を展開（${position.hiddenCount}件）`
                      : `${node.text}を折り畳む`
                  }
                  onClick={() => props.onToggle(node.id)}
                >
                  {doc.viewState.collapsedNodeIds.includes(node.id)
                    ? `+${position.hiddenCount}`
                    : "−"}
                </button>
              )}
              {isSelected && selected.length === 1 && !isEditing && (
                <>
                  <button
                    className={`add-child ${position.side === "left" ? "left" : ""}`}
                    aria-label="子トピックを追加"
                    onClick={() => props.onAdd("child")}
                  >
                    +
                  </button>
                  <button
                    className="add-sibling"
                    aria-label="次の兄弟トピックを追加"
                    onClick={() => props.onAdd("next")}
                  >
                    +
                  </button>
                </>
              )}
            </div>
          );
        })}
      </div>
      {gesture?.type === "select" && gesture.moved && rect && (
        <div
          className="selection-rectangle"
          style={{
            left: Math.min(gesture.startX, gesture.x) - rect.left,
            top: Math.min(gesture.startY, gesture.y) - rect.top,
            width: Math.abs(gesture.x - gesture.startX),
            height: Math.abs(gesture.y - gesture.startY),
          }}
        />
      )}
      {gesture?.type === "node" && gesture.moved && (
        <div
          className="drag-badge"
          style={{
            left: gesture.x - (rect?.left || 0) + 18,
            top: gesture.y - (rect?.top || 0) + 18,
          }}
        >
          {gesture.target
            ? gesture.target.placement === "child"
              ? "子へ移動"
              : "兄弟の間へ移動"
            : "移動先を選択 · 空白で取消"}
        </div>
      )}
    </div>
  );
}
