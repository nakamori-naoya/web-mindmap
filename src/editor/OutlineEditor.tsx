import { useEffect, useLayoutEffect, useRef, type KeyboardEvent } from "react";
import type { MindmapDocument } from "../domain";
import type { Editing } from "./MapCanvas";

type Props = {
  document: MindmapDocument;
  selected: string[];
  editing: Editing | null;
  active: boolean;
  onActivate(): void;
  onSelect(id: string): void;
  onStartEdit(id: string): void;
  onDraft(value: string): void;
  onFinishEdit(): boolean;
  onCancelEdit(): void;
  onKey?(event: KeyboardEvent): void;
  onAdd(kind: "child" | "next" | "previous"): void;
};

export default function OutlineEditor(props: Props) {
  const { document: doc, selected, editing, active } = props;
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const treeRef = useRef<HTMLUListElement>(null);
  const composing = useRef(false);
  const visibleIds: string[] = [];
  const visit = (id: string) => {
    visibleIds.push(id);
    doc.nodes[id].childIds.forEach(visit);
  };
  visit(doc.rootId);

  useEffect(() => {
    if (!active) return;
    if (editing && editorRef.current) {
      editorRef.current.focus({ preventScroll: true });
    } else if (selected[0]) {
      treeRef.current
        ?.querySelector<HTMLButtonElement>(`[data-outline-id="${selected[0]}"]`)
        ?.focus({ preventScroll: true });
    }
  }, [active, editing?.id, selected[0]]);

  useLayoutEffect(() => {
    const element = editorRef.current;
    if (!element) return;
    element.style.height = "auto";
    element.style.height = `${Math.min(320, Math.max(44, element.scrollHeight))}px`;
  }, [editing?.id, editing?.draft]);

  const select = (id: string) => {
    props.onActivate();
    if (editing && editing.id !== id && !props.onFinishEdit()) return;
    props.onSelect(id);
  };
  const handleRowKey = (event: KeyboardEvent, id: string) => {
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    if (
      event.metaKey ||
      event.ctrlKey ||
      event.altKey ||
      event.key === "Delete" ||
      event.key === "Backspace"
    ) {
      props.onKey?.(event);
      return;
    }
    if (event.key === "Tab" || event.key === "Enter") {
      event.preventDefault();
      props.onAdd(
        event.key === "Tab" ? "child" : event.shiftKey ? "previous" : "next",
      );
    } else if (event.key === " " || event.key === "F2") {
      event.preventDefault();
      props.onStartEdit(id);
    } else if (event.key.startsWith("Arrow")) {
      event.preventDefault();
      const index = visibleIds.indexOf(id);
      const node = doc.nodes[id];
      const next =
        event.key === "ArrowUp"
          ? visibleIds[index - 1]
          : event.key === "ArrowDown"
            ? visibleIds[index + 1]
            : event.key === "ArrowLeft"
              ? node.parentId
              : node.childIds[0];
      if (next) select(next);
    }
  };
  const row = (id: string) => {
    const node = doc.nodes[id];
    const isSelected = selected.includes(id);
    const isEditing = active && editing?.id === id;
    return (
      <li key={id} role="none">
        <div className={`outline-row ${isSelected ? "selected" : ""}`}>
          {isEditing ? (
            <textarea
              ref={editorRef}
              aria-label="アウトラインのトピック本文"
              className="outline-input"
              value={editing.draft}
              rows={Math.max(1, editing.draft.split("\n").length)}
              spellCheck={false}
              onChange={(event) => props.onDraft(event.target.value)}
              onCompositionStart={() => {
                composing.current = true;
              }}
              onCompositionEnd={(event) => {
                composing.current = false;
                props.onDraft(event.currentTarget.value);
              }}
              onKeyDown={(event) => {
                event.stopPropagation();
                if (
                  composing.current ||
                  event.nativeEvent.isComposing ||
                  event.keyCode === 229
                )
                  return;
                if (event.key === "Escape") {
                  event.preventDefault();
                  props.onCancelEdit();
                } else if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  props.onFinishEdit();
                } else if (event.key === "Tab") {
                  event.preventDefault();
                  if (props.onFinishEdit()) props.onAdd("child");
                }
              }}
              onBlur={() => {
                if (!composing.current) props.onFinishEdit();
              }}
            />
          ) : (
            <button
              type="button"
              role="treeitem"
              aria-selected={isSelected}
              aria-label={node.text || "新しいトピック"}
              aria-expanded={node.childIds.length ? true : undefined}
              tabIndex={
                isSelected || (!selected.length && id === doc.rootId) ? 0 : -1
              }
              data-outline-id={id}
              className={isSelected ? "active" : ""}
              onClick={() => select(id)}
              onDoubleClick={() => props.onStartEdit(id)}
              onKeyDown={(event) => handleRowKey(event, id)}
            >
              {node.text || "新しいトピック"}
            </button>
          )}
        </div>
        {node.childIds.length > 0 && (
          <ul role="group">{node.childIds.map(row)}</ul>
        )}
      </li>
    );
  };

  return (
    <div
      className="outline-editor"
      onPointerDownCapture={props.onActivate}
      onFocusCapture={props.onActivate}
    >
      <div className="outline-actions" aria-label="アウトラインの追加操作">
        <button
          type="button"
          disabled={!selected.length}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => props.onAdd("child")}
        >
          ＋ 子を追加
        </button>
        <button
          type="button"
          disabled={!selected.length}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => props.onAdd("next")}
        >
          ＋ 兄弟を追加
        </button>
      </div>
      <p className="outline-hint">Tabで子・Enterで兄弟・Spaceで本文を編集</p>
      <ul ref={treeRef} role="tree" aria-label="編集できるアウトライン">
        {row(doc.rootId)}
      </ul>
    </div>
  );
}
