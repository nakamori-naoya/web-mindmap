import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import {
  addNode,
  BRANCH_COLORS,
  copySubtrees,
  createDocument,
  DocumentHistory,
  executeCommand,
  getDescendantIds,
  getTopLevelSelection,
  isSafeLink,
  pasteSubtrees,
  validateDocument,
  type Camera,
  type Command,
  type CopiedSubtrees,
  type MindmapDocument,
} from "../domain";
import { layoutDocument } from "../layout";
import {
  downloadFile,
  exportJSON,
  exportMarkdown,
  exportPNG,
  exportSVG,
  importJSON,
  importMarkdown,
  parseBackupJSON,
  exportBackupJSON,
  type PortableImageAsset,
} from "../io";
import MapCanvas, { type Editing } from "../editor/MapCanvas";
import OutlineEditor from "../editor/OutlineEditor";
import {
  request,
  readDocument,
  type MapSummary,
  type Snapshot,
} from "../editor/api";
import { useAutosave } from "../editor/useAutosave";
import { Help } from "./Help";
import { imageURL, uploadImage, loadImageAssets } from "../editor/imageApi";
import { ImagePreview } from "../editor/ImagePreview";
import { isTrashReviewDue, trashReviewDate } from "../editor/trashRetention";
type Modal = "help" | "export" | "recovery" | "import" | "image" | "delete" | null;
const errorText = (error: unknown) =>
  error instanceof Error ? error.message : "処理を完了できませんでした。";
const dateText = (date: string) =>
  new Date(date).toLocaleString("ja-JP", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
export default function App() {
  const [doc, setDoc] = useState<MindmapDocument | null>(null);
  const docRef = useRef(doc);
  const [maps, setMaps] = useState<MapSummary[]>([]);
  const [trash, setTrash] = useState(false);
  const [trashMaps, setTrashMaps] = useState<MapSummary[]>([]);
  const [reviewNow, setReviewNow] = useState(Date.now);
  const [reviewDeferred, setReviewDeferred] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<MapSummary | null>(null);
  const [deleteConfirmation, setDeleteConfirmation] = useState("");
  const [deleteError, setDeleteError] = useState("");
  const [deleteBusy, setDeleteBusy] = useState(false);
  const deleteBusyRef = useRef(false);
  const dueTrashCount = trashMaps.filter(map => isTrashReviewDue(map.deletedAt, reviewNow)).length;
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  const [editing, setEditing] = useState<Editing | null>(null);
  const editingRef = useRef(editing);
  const [panel, setPanel] = useState(() => window.innerWidth > 768);
  const [editingSurface, setEditingSurface] = useState<"canvas" | "outline">("canvas");
  const editingSurfaceRef = useRef(editingSurface);
  const activate = (surface: "canvas" | "outline") => { editingSurfaceRef.current = surface; setEditingSurface(surface); };
  const [titleDraft, setTitleDraft] = useState<string | null>(null);
  const titleDraftRef = useRef<string | null>(null);
  const [linkDrafts, setLinkDrafts] = useState<Record<string, string>>({});
  const linkDraftsRef = useRef<Record<string, string>>({});
  const linkSession = useRef<MindmapDocument | null>(null);
  const fitAfterOpen = useRef(false);
  const [outline, setOutline] = useState(false);
  const [modal, setModal] = useState<Modal>(null);
  const [theme, setTheme] = useState<"dark" | "light" | "system">(() => {
    const value = localStorage.getItem("mindmap-theme");
    return value === "light" || value === "system" ? value : "dark";
  });
  const [osDark, setOsDark] = useState(
    matchMedia("(prefers-color-scheme: dark)").matches,
  );
  const [query, setQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchIndex, setSearchIndex] = useState(-1);
  const [importPreview, setImportPreview] = useState<MindmapDocument | null>(
    null,
  );
  const [importAssets, setImportAssets] = useState<PortableImageAsset[] | null>(null);
  const [imageBusy, setImageBusy] = useState(false);
  const imageBusyRef = useRef(false);
  const [imageError, setImageError] = useState("");
  const [imagePreview, setImagePreview] = useState<{ mapId: string; imageId: string; label: string } | null>(null);
  const imageRetry = useRef<{ nodeId: string; files: File[] } | null>(null);
  const imageFileRef = useRef<HTMLInputElement>(null);
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [snapshotPreview, setSnapshotPreview] =
    useState<MindmapDocument | null>(null);
  const [snapshotId, setSnapshotId] = useState("");
  const [pngScale, setPngScale] = useState(1);
  const [exporting, setExporting] = useState(false);
  const history = useRef(new DocumentHistory());
  const clipboard = useRef<CopiedSubtrees | null>(null);
  const modalRef = useRef<HTMLElement>(null);
  const noteSession = useRef<MindmapDocument | null>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const autosave = useAutosave();
  const resolvedTheme =
    theme === "system" ? (osDark ? "dark" : "light") : theme;
  const change = (value: MindmapDocument, save = true) => {
    docRef.current = value;
    setDoc(value);
    if (save) autosave.schedule(value);
  };
  const setEdit = (value: Editing | null) => {
    editingRef.current = value;
    setEditing(value);
  };
  const select = (ids: string[]) => {
    selectedRef.current = ids;
    setSelected(ids);
  };
  const attempt = (action: () => void) => {
    try {
      action();
    } catch (cause) {
      setError(errorText(cause));
    }
  };
  const commit = (command: Command, record = true) => {
    if (imageBusyRef.current && command.type !== "SetCamera") { setImageError("画像の取り込みが終わってから編集してください。"); return; }
    const current = docRef.current;
    if (!current) return;
    const next = executeCommand(current, command);
    if (next === current) return;
    if (record) history.current.record(current);
    change(next);
  };
  const loadMaps = async (showTrash = trash) => {
    setLoading(true);
    try {
      const rows = await request<MapSummary[]>(
        `/api/maps${showTrash ? "?trash=1" : ""}`,
      );
      if (
        !Array.isArray(rows) ||
        rows.some(
          (row) => typeof row.id !== "string" || typeof row.title !== "string",
        )
      )
        throw new Error("一覧の応答形式が不正です");
      setMaps(rows);
      setReviewNow(Date.now());
      if (showTrash) setTrashMaps(rows);
      setError("");
      if (!showTrash) {
        try { setTrashMaps(await request<MapSummary[]>("/api/maps?trash=1")); }
        catch { setTrashMaps([]); setError("削除確認の対象を取得できませんでした。再読み込みしてください。"); }
      }
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setLoading(false);
    }
  };
  const closeModal = () => { if (!deleteBusyRef.current) setModal(null); };
  const deleteMap = async () => {
    if (!deleteTarget || deleteBusyRef.current || deleteConfirmation !== deleteTarget.title) return;
    deleteBusyRef.current = true;
    setDeleteBusy(true);
    setDeleteError("");
    try {
      await request(`/api/maps/${deleteTarget.id}/permanent`, "DELETE", { confirmation: deleteConfirmation });
      setModal(null);
      setDeleteTarget(null);
      await loadMaps(true);
      setNotice("確認したマップを完全削除しました。");
    } catch (cause) { setDeleteError(errorText(cause) + " 一覧を再読み込みして現在の状態を確認してください。"); }
    finally { deleteBusyRef.current = false; setDeleteBusy(false); }
  };
  useEffect(() => {
    const timer = window.setInterval(() => setReviewNow(Date.now()), 60_000);
    const update = () => setReviewNow(Date.now());
    window.addEventListener("focus", update);
    return () => { window.clearInterval(timer); window.removeEventListener("focus", update); };
  }, []);
  const openDocument = (value: MindmapDocument, editRoot = false) => {
    validateDocument(value);
    autosave.reset();
    titleDraftRef.current = null; setTitleDraft(null);
    linkDraftsRef.current = {}; setLinkDrafts({});
    activate("canvas");
    history.current.clear();
    change(value, false);
    select([value.rootId]);
    setEdit(
      editRoot
        ? {
            id: value.rootId,
            draft: value.nodes[value.rootId].text,
            original: value.nodes[value.rootId].text,
          }
        : null,
    );
    setError("");
    setImageError(""); imageRetry.current = null;
    setModal(null);
    setQuery("");
    setSearchOpen(false);
    if (location.hash !== `#map=${value.documentId}`)
      location.hash = `map=${value.documentId}`;
  };
  useEffect(() => {
    if (!doc || !fitAfterOpen.current) return;
    fitAfterOpen.current = false;
    const frame = requestAnimationFrame(() => fit());
    return () => cancelAnimationFrame(frame);
  }, [doc?.documentId]);
  useEffect(() => {
    if (autosave.status === "saved") setError(current => current.startsWith("未保存の内容があります") ? "" : current);
  }, [autosave.status]);
  const hasAuxiliaryDraft = () => {
    const current = docRef.current;
    if (!current) return false;
    return imageBusyRef.current || (titleDraftRef.current !== null && !titleDraftRef.current.trim()) || Object.entries(linkDraftsRef.current).some(([id, value]) => current.nodes[id] && value !== (current.nodes[id].link || ""));
  };
  const openMap = async (id: string) => {
    setLoading(true);
    try {
      openDocument(await readDocument(`/api/maps/${id}`));
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setLoading(false);
    }
  };
  const createMap = async () => {
    setLoading(true);
    try {
      const value = createDocument();
      await request("/api/maps", "POST", value);
      const rect = canvasRef.current?.getBoundingClientRect();
      value.viewState.camera = {
        x: (rect?.width || window.innerWidth - (panel && window.innerWidth > 768 ? 320 : 0)) / 2,
        y: (rect?.height || window.innerHeight - 140) / 2,
        zoom: 1,
      };
      openDocument(value, true);
      autosave.schedule(value);
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    const hash = async () => {
      const id = location.hash.match(/^#map=([0-9a-f-]+)$/i)?.[1];
      if (id && id === docRef.current?.documentId) return;
      if (docRef.current && hasAuxiliaryDraft()) {
        location.hash = `map=${docRef.current.documentId}`;
        setError("入力中のマップ名またはリンクを確認してください。空の名前や未完成のURLはまだ保存されていません。");
        return;
      }
      if (docRef.current && editingRef.current && !finishEdit()) {
        location.hash = `map=${docRef.current.documentId}`;
        return;
      }
      if (
        docRef.current &&
        autosave.hasPending() &&
        !(await autosave.flush())
      ) {
        location.hash = `map=${docRef.current.documentId}`;
        setError(
          "未保存の内容があります。保存を再試行するかJSONを保存してください。",
        );
        return;
      }
      if (id) {
        if (id !== docRef.current?.documentId) void openMap(id);
      } else {
        setDoc(null);
        docRef.current = null;
        setEdit(null);
        void loadMaps(false);
      }
    };
    void hash();
    window.addEventListener("hashchange", hash);
    return () => window.removeEventListener("hashchange", hash);
  }, []);
  useEffect(() => {
    document.documentElement.dataset.theme = resolvedTheme;
    localStorage.setItem("mindmap-theme", theme);
  }, [theme, resolvedTheme]);
  useEffect(() => {
    const media = matchMedia("(prefers-color-scheme: dark)");
    const update = () => setOsDark(media.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  useEffect(() => {
    if (notice) {
      const timer = setTimeout(() => setNotice(""), 6000);
      return () => clearTimeout(timer);
    }
  }, [notice]);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (
        editingRef.current &&
        editingRef.current.draft !== editingRef.current.original || hasAuxiliaryDraft()
      ) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, []);
  useEffect(() => {
    if (!modal) return;
    const previous = document.activeElement as HTMLElement | null;
    const trap = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeModal();
        return;
      }
      if (event.key !== "Tab") return;
      const items = modalRef.current?.querySelectorAll<HTMLElement>(
        "button:not(:disabled),input,select,textarea,a[href]",
      );
      if (!items?.length) return;
      const first = items[0],
        last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", trap);
    return () => {
      window.removeEventListener("keydown", trap);
      previous?.focus();
    };
  }, [modal]);
  const startEdit = (id: string) => {
    if (imageBusyRef.current) { setImageError("画像の取り込みが終わってから本文を編集してください。"); return; }
    if (editingRef.current && editingRef.current.id !== id && !finishEdit())
      return;
    const current = docRef.current;
    if (!current?.nodes[id]) return;
    select([id]);
    const active = editingRef.current;
    if (active?.id === id) return;
    setEdit({
      id,
      draft: current.nodes[id].text,
      original: current.nodes[id].text,
    });
  };
  const updateDraft = (draft: string) => {
    const active = editingRef.current;
    if (!active) return;
    setEdit({ ...active, draft });
  };
  const finishEdit = () => {
    const active = editingRef.current,
      current = docRef.current;
    if (!active || !current) return true;
    if (active.draft.length > 2000) {
      setError(
        "トピック本文は2000文字以内にしてください。長文はメモへ入力できます。",
      );
      return false;
    }
    if (active.draft !== active.original || !active.draft.trim()) {
      try {
        commit(
          { type: "EditText", id: active.id, text: active.draft },
          !active.beforeNew,
        );
      } catch (cause) {
        setError(errorText(cause));
        return false;
      }
    }
    setError("");
    setEdit(null);
    if (editingSurfaceRef.current === "canvas") canvasRef.current?.focus({ preventScroll: true });
    return true;
  };
  const cancelEdit = () => {
    const active = editingRef.current;
    if (!active) return;
    if (active.beforeNew) {
      const parent =
        docRef.current?.nodes[active.id]?.parentId || active.beforeNew.rootId;
      history.current.discardLast();
      change(active.beforeNew);
      select([parent]);
    }
    setEdit(null);
    if (editingSurfaceRef.current === "canvas") canvasRef.current?.focus({ preventScroll: true });
  };
  const add = (kind: "child" | "next" | "previous") =>
    attempt(() => {
      if (imageBusyRef.current) return;
      if (!finishEdit()) return;
      const current = docRef.current,
        id = selectedRef.current[0];
      if (!current || !id) return;
      const node = current.nodes[id];
      let parent =
        kind === "child" || id === current.rootId ? id : node.parentId!;
      let before: string | undefined;
      if (kind !== "child" && id !== current.rootId) {
        const siblings = current.nodes[parent].childIds;
        before = kind === "previous" ? id : siblings[siblings.indexOf(id) + 1];
      }
      const result = addNode(current, parent, "", before);
      history.current.record(current);
      change(result.document);
      select([result.nodeId]);
      setEdit({
        id: result.nodeId,
        draft: "",
        original: "",
        beforeNew: current,
      });
    });
  const undo = () => {
    if (imageBusyRef.current) return;
    titleDraftRef.current = null; setTitleDraft(null);
    linkDraftsRef.current = {}; setLinkDrafts({});
    setEdit(null);
    const current = docRef.current;
    if (!current) return;
    const next = history.current.undo(current);
    change(next);
    select(
      selected.filter((id) => next.nodes[id]).length
        ? selected.filter((id) => next.nodes[id])
        : [next.rootId],
    );
  };
  const redo = () => {
    if (imageBusyRef.current) return;
    titleDraftRef.current = null; setTitleDraft(null);
    linkDraftsRef.current = {}; setLinkDrafts({});
    setEdit(null);
    const current = docRef.current;
    if (!current) return;
    const next = history.current.redo(current);
    change(next);
    select(
      selected.filter((id) => next.nodes[id]).length
        ? selected.filter((id) => next.nodes[id])
        : [next.rootId],
    );
  };
  const remove = () =>
    attempt(() => {
      if (imageBusyRef.current) return;
      if (!finishEdit()) return;
      const current = docRef.current;
      if (!current) return;
      const ids = getTopLevelSelection(
        current,
        selectedRef.current.filter((id) => id !== current.rootId),
      );
      if (!ids.length) {
        setNotice("中心トピックは削除できません");
        return;
      }
      const count = ids.reduce(
        (sum, id) => sum + getDescendantIds(current, id).length + 1,
        0,
      );
      if (
        count >= 20 &&
        !confirm(`${count}件のトピックを削除しますか？ Undoで元に戻せます。`)
      )
        return;
      const parent = current.nodes[ids[0]].parentId!;
      commit({ type: "DeleteSubtree", ids });
      setEdit(null);
      select([parent]);
      setNotice(`${count}件を削除しました。元に戻すボタンで復元できます。`);
    });
  const addImages = async (nodeId: string, files: File[]) => {
    if (imageBusyRef.current || !files.length) return;
    const initial = docRef.current;
    if (!initial?.nodes[nodeId]) { setImageError("画像を添付するトピックを選択してください。"); return; }
    if (!finishEdit()) return;
    if ((initial.nodes[nodeId].images?.length || 0) + files.length > 8) { setImageError("1つのトピックには画像を8枚まで添付できます。"); return; }
    imageBusyRef.current = true; setImageBusy(true); setImageError("");
    imageRetry.current = { nodeId, files };
    const mapId = initial.documentId;
    try {
      const uploaded = [];
      for (const file of files) uploaded.push(await uploadImage(mapId, file));
      const current = docRef.current;
      if (!current || current.documentId !== mapId || !current.nodes[nodeId]) throw new Error("添付先のマップを開き直して画像を再試行してください。");
      let next = current;
      for (const { id: assetId, ...metadata } of uploaded) next = executeCommand(next, { type: "AttachImage", id: nodeId, assetId, metadata });
      history.current.record(current); change(next);
      imageRetry.current = null; setImageError(""); setNotice(`${uploaded.length}枚の画像を添付しました。元ファイルを移動しても表示できます。`);
    } catch (cause) { setImageError(errorText(cause)); }
    finally { imageBusyRef.current = false; setImageBusy(false); if (!hasAuxiliaryDraft()) setError(value => value.startsWith("入力中のマップ名") ? "" : value); if (imageFileRef.current) imageFileRef.current.value = ""; }
  };
  const openImage = (nodeId: string, index: number) => {
    if (!finishEdit()) return;
    const current = docRef.current, imageId = current?.nodes[nodeId]?.images?.[index];
    if (!current || !imageId) return;
    setImagePreview({ mapId: current.documentId, imageId, label: `${current.nodes[nodeId].text}の添付画像${index + 1}` });
    setModal("image");
  };
  const clipboardImages = async (event: React.ClipboardEvent) => {
    const target = event.target as HTMLElement;
    if (editingRef.current || target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement && !target.classList.contains("node-input")) return;
    const files = Array.from(event.clipboardData.files).filter(file => file.type.startsWith("image/"));
    if (!files.length) return;
    event.preventDefault();
    const id = selectedRef.current[0];
    if (!id) { setImageError("画像を添付するトピックを選択してください。"); return; }
    await addImages(id, files);
  };
  const copy = async () => {
    const current = docRef.current;
    if (!current || !selectedRef.current.length) return;
    clipboard.current = copySubtrees(current, selectedRef.current);
    const text = selectedRef.current
      .map((id) => current.nodes[id].text)
      .join("\n");
    try {
      if (
        navigator.clipboard?.write &&
        typeof ClipboardItem !== "undefined" &&
        ClipboardItem.supports?.("web application/x-mindmap+json")
      )
        await navigator.clipboard.write([
          new ClipboardItem({
            "web application/x-mindmap+json": new Blob(
              [JSON.stringify(clipboard.current)],
              { type: "application/x-mindmap+json" },
            ),
            "text/plain": new Blob([text], { type: "text/plain" }),
          }),
        ]);
      else {
        await navigator.clipboard.writeText(JSON.stringify(clipboard.current));
        setNotice(
          "枝をコピーしました。アプリ専用形式をテキストとして保存しています。",
        );
      }
    } catch {
      setNotice(
        "この画面内にコピーしました。クリップボードへのアクセスは利用できません。",
      );
    }
  };
  const paste = async () => {
    if (imageBusyRef.current) return;
    try {
      let copied = clipboard.current;
      let readCustom = false;
      if (navigator.clipboard?.read) {
        try {
          const items = await navigator.clipboard.read();
          const imageItem = items.find(item => item.types.some(type => ['image/png', 'image/jpeg', 'image/webp'].includes(type)));
          if (imageItem && !items.some(item => item.types.includes("web application/x-mindmap+json"))) {
            const type = imageItem.types.find(type => ['image/png', 'image/jpeg', 'image/webp'].includes(type))!;
            const target = selectedRef.current[0];
            if (!target) throw new Error("画像を添付するトピックを選択してください。");
            await addImages(target, [new File([await imageItem.getType(type)], 'clipboard-image', { type })]);
            return;
          }
          for (const item of items) {
            if (!item.types.includes("web application/x-mindmap+json")) continue;
            const value = JSON.parse(await (await item.getType("web application/x-mindmap+json")).text());
            if (value.format === "mindmap-subtrees") { copied = value; readCustom = true; break; }
          }
        } catch { /* 権限がない場合はテキスト形式か画面内コピーを使う */ }
      }
      if (navigator.clipboard?.readText && !readCustom) {
        try {
          const value = JSON.parse(await navigator.clipboard.readText());
          if (value.format === "mindmap-subtrees") copied = value;
        } catch {
          /* アプリ内コピーを使う */
        }
      }
      if (!copied) throw new Error("先にトピックをコピーしてください");
      const current = docRef.current;
      if (!current) return;
      const imageIds = [...new Set(Object.values(copied.nodes).flatMap(node => node.images || []))];
      if (imageIds.length && copied.sourceDocumentId !== current.documentId) {
        if (!copied.sourceDocumentId) throw new Error("コピー元の画像情報がないため貼り付けられません。元の枝をコピーし直してください。");
        const sourceId = copied.sourceDocumentId;
        const prepared = structuredClone(copied);
        prepared.imageAssets = {};
        for (const oldId of imageIds) {
          const response = await fetch(imageURL(sourceId, oldId));
          if (!response.ok) throw new Error("コピー元の画像を読み込めません。元のマップを確認してください。");
          const { id: newId, ...metadata } = await uploadImage(current.documentId, await response.blob());
          prepared.imageAssets[newId] = metadata;
          for (const node of Object.values(prepared.nodes)) if (node.images) node.images = node.images.map(id => id === oldId ? newId : id);
        }
        prepared.sourceDocumentId = current.documentId;
        copied = prepared;
      }
      if (docRef.current?.documentId !== current.documentId) throw new Error("貼り付け先のマップが変わりました。貼り付けをやり直してください。");
      const beforePaste = docRef.current;
      const result = pasteSubtrees(
        beforePaste,
        selectedRef.current[0] || current.rootId,
        copied,
      );
      history.current.record(beforePaste);
      change(result.document);
      select(result.nodeIds);
    } catch (cause) {
      setError(errorText(cause));
    }
  };
  const duplicate = () =>
    attempt(() => {
      if (imageBusyRef.current) return;
      const current = docRef.current;
      if (!current || !selected[0]) return;
      const result = pasteSubtrees(
        current,
        current.nodes[selected[0]].parentId || current.rootId,
        copySubtrees(current, selected),
      );
      history.current.record(current);
      change(result.document);
      select(result.nodeIds);
    });
  const setCamera = (camera: Camera) =>
    attempt(() => commit({ type: "SetCamera", camera }, false));
  const fit = () => {
    const current = docRef.current,
      canvas = canvasRef.current;
    if (!current || !canvas) return;
    const { bounds } = layoutDocument(current);
    const zoom = Math.min(
      1.4,
      Math.max(
        0.1,
        Math.min(
          (canvas.clientWidth - 128) / bounds.width,
          (canvas.clientHeight - 128) / bounds.height,
        ),
      ),
    );
    setCamera({
      zoom,
      x: canvas.clientWidth / 2 - (bounds.x + bounds.width / 2) * zoom,
      y: canvas.clientHeight / 2 - (bounds.y + bounds.height / 2) * zoom,
    });
  };
  const reveal = (id: string) => {
    if (!finishEdit()) return;
    const current = docRef.current,
      canvas = canvasRef.current;
    if (!current || !canvas) return;
    let parent = current.nodes[id].parentId;
    const ancestors: string[] = [];
    while (parent) {
      ancestors.push(parent);
      parent = current.nodes[parent].parentId;
    }
    let next = current;
    for (const ancestor of ancestors)
      if (next.viewState.collapsedNodeIds.includes(ancestor))
        next = executeCommand(next, { type: "ToggleCollapse", id: ancestor });
    if (next !== current) change(next);
    const node = layoutDocument(next).nodes.find((n) => n.id === id);
    if (node)
      setCamera({
        zoom: next.viewState.camera.zoom,
        x:
          canvas.clientWidth / 2 -
          (node.x + node.width / 2) * next.viewState.camera.zoom,
        y:
          canvas.clientHeight / 2 -
          (node.y + node.height / 2) * next.viewState.camera.zoom,
      });
    select([id]);
  };
  const searchResults =
    doc && query.trim()
      ? Object.values(doc.nodes)
          .filter((node) =>
            `${node.text}\n${node.note}`
              .toLocaleLowerCase()
              .includes(query.toLocaleLowerCase()),
          )
          .map((node) => node.id)
      : [];
  const searchNext = (direction = 1) => {
    if (!searchResults.length) return;
    const index =
      (searchIndex + direction + searchResults.length) % searchResults.length;
    setSearchIndex(index);
    reveal(searchResults[index]);
  };
  const exportFile = async (format: "json" | "markdown" | "svg" | "png") => {
    if (imageBusyRef.current) { setError("画像の取り込みが終わってから書き出してください。"); return; }
    if (!finishEdit()) return;
    const current = docRef.current;
    if (!current) return;
    setExporting(true);
    try {
      const name = current.title.replace(/[\\/:*?"<>|]/g, "_").slice(0, 100);
      const assets = format === "markdown" ? [] : await loadImageAssets(current);
      if (format === "png")
        downloadFile(
          await exportPNG(current, pngScale, resolvedTheme, assets),
          `${name}.png`,
        );
      else if (format === "svg")
        downloadFile(
          exportSVG(current, { theme: resolvedTheme, assets }),
          `${name}.svg`,
          "image/svg+xml",
        );
      else if (format === "json")
        downloadFile(assets.length ? exportBackupJSON(current, assets) : exportJSON(current), `${name}.json`, "application/json");
      else {
        if (
          !confirm(
            "Markdownには画像、枝色、文字サイズ、リンクなど一部の情報を保存できません。完全なバックアップにはJSONを使用してください。続けますか？",
          )
        )
          return;
        downloadFile(exportMarkdown(current), `${name}.md`, "text/markdown");
      }
      setNotice(`${format.toUpperCase()}を書き出しました`);
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setExporting(false);
    }
  };
  const importFile = async (file: File) => {
    setLoading(true);
    setModal("import");
    setImportPreview(null); setImportAssets(null);
    try {
      if (file.size > (/\.json$/i.test(file.name) ? 100 : 10) * 1024 * 1024)
        throw new Error("JSONバックアップは100MB、Markdownは10MB以内にしてください。");
      const text = await file.text();
      let value: MindmapDocument;
      if (/\.json$/i.test(file.name)) {
        const parsed = parseBackupJSON(text);
        if (JSON.parse(text).format === 'mindmap-backup') { value = parsed.document; setImportAssets(parsed.assets); }
        else value = importJSON(text, { newIdentity: true });
      } else value = importMarkdown(text, file.name.replace(/\.[^.]+$/, ""));
      validateDocument(value);
      setImportPreview(value);
      setError("");
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setLoading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };
  const acceptImport = async () => {
    if (!importPreview) return;
    setLoading(true);
    try {
      if (hasAuxiliaryDraft()) throw new Error("入力中のマップ名またはリンクを確認してください。未完成の入力はまだ保存されていません。");
      if (!finishEdit()) return;
      if (doc && !(await autosave.flush()))
        throw new Error(
          "現在のマップが未保存です。保存を再試行するかJSONを保存してください。",
        );
      const created = importAssets !== null
        ? await request<MindmapDocument>("/api/maps/import", "POST", { format: "mindmap-backup", schemaVersion: 1, document: importPreview, assets: importAssets })
        : await request<MindmapDocument>("/api/maps", "POST", importPreview);
      fitAfterOpen.current = true;
      openDocument(created);
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setLoading(false);
    }
  };
  const showRecovery = async () => {
    if (!doc || !finishEdit()) return;
    if (hasAuxiliaryDraft()) { setError("入力中のマップ名またはリンクを確認してください。未完成の入力はまだ保存されていません。"); return; }
    setModal("recovery");
    setError("");
    setSnapshotId("");
    setSnapshotPreview(null);
    try {
      setSnapshots(
        await request<Snapshot[]>(`/api/maps/${doc.documentId}/snapshots`),
      );
    } catch (cause) {
      setError(errorText(cause));
    }
  };
  const key = (event: ReactKeyboardEvent) => {
    if (
      event.nativeEvent.isComposing ||
      event.keyCode === 229 ||
      editingRef.current
    )
      return;
    const input =
      event.target instanceof HTMLTextAreaElement ||
      event.target instanceof HTMLInputElement;
    if (
      input &&
      !(event.target as HTMLElement).classList.contains("node-input")
    )
      return;
    const command = event.metaKey || event.ctrlKey;
    if (command) {
      const k = event.key.toLowerCase();
      if (k === "z") {
        event.preventDefault();
        event.shiftKey ? redo() : undo();
      } else if (k === "s") {
        event.preventDefault();
        void exportFile("json");
      } else if (k === "f") {
        event.preventDefault();
        if (event.shiftKey) fit();
        else {
          setSearchOpen(true);
          setTimeout(() => searchRef.current?.focus(), 0);
        }
      } else if (k === "c") {
        event.preventDefault();
        void copy();
      } else if (k === "v") {
        event.preventDefault();
        void paste();
      } else if (k === "d") {
        event.preventDefault();
        duplicate();
      }
      return;
    }
    const current = docRef.current,
      id = selectedRef.current[0];
    if (!current || !id) return;
    if (event.key === "Tab") {
      event.preventDefault();
      add("child");
    } else if (event.key === "Enter") {
      event.preventDefault();
      add(event.shiftKey ? "previous" : "next");
    } else if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault();
      remove();
    } else if (event.key === "F2") {
      event.preventDefault();
      startEdit(id);
    } else if (event.key.startsWith("Arrow")) {
      event.preventDefault();
      const node = current.nodes[id];
      const position = layoutDocument(current).nodes.find((n) => n.id === id);
      const outward = position?.side === "left" ? "ArrowLeft" : "ArrowRight";
      let next: string | undefined;
      if (event.key === outward)
        next = current.viewState.collapsedNodeIds.includes(id)
          ? undefined
          : node.childIds[0];
      else if (event.key === "ArrowLeft" || event.key === "ArrowRight")
        next = node.parentId || undefined;
      else if (node.parentId) {
        const siblings = current.nodes[node.parentId].childIds;
        next =
          siblings[siblings.indexOf(id) + (event.key === "ArrowDown" ? 1 : -1)];
      }
      if (next) select([next]);
    }
  };
  const selectedNode = doc && selected[0] ? doc.nodes[selected[0]] : null;
  const closeOutline = () => {
    if (!finishEdit()) return;
    setOutline(false);
    activate("canvas");
  };
  const toggleOutline = () => {
    if (outline) { closeOutline(); return; }
    setOutline(true);
    if (window.innerWidth <= 768) setPanel(false);
  };
  const togglePanel = () => {
    if (window.innerWidth <= 768 && outline) {
      if (!finishEdit()) return;
      setOutline(false);
      activate("canvas");
    }
    setPanel(value => !value);
  };
  const goHome = async () => {
    if (hasAuxiliaryDraft()) { setError("入力中のマップ名またはリンクを確認してください。未完成の入力はまだ保存されていません。"); return; }
    if (!finishEdit()) return;
    if (!(await autosave.flush())) {
      setError(
        "未保存の内容があります。保存を再試行するかJSONを保存してから一覧へ戻ってください。",
      );
      return;
    }
    location.hash = "";
  };
  return (
    <div className="app" onPaste={event => void clipboardImages(event)}>
      <input
        ref={fileRef}
        type="file"
        accept=".json,.md,.markdown"
        className="visually-hidden"
        aria-label="マップを読み込むファイル"
        onChange={(event) => {
          if (event.target.files?.[0]) void importFile(event.target.files[0]);
        }}
      />
      <input ref={imageFileRef} type="file" accept="image/png,image/jpeg,image/webp" multiple className="visually-hidden" aria-label="ノードに添付する画像" onChange={event => { const files = Array.from(event.target.files || []); const id = selectedRef.current[0]; if (id) void addImages(id, files); else setImageError("画像を添付するトピックを選択してください。"); }} />
      {!doc ? (
        <main className="library">
          <header className="library-header">
            <div className="brand-mark">◈</div>
            <div>
              <span className="eyebrow">LOCAL MINDMAP</span>
              <h1>考えを、つなぐ。</h1>
              <p>あなたの思考を、このMacに。</p>
            </div>
            <select
              aria-label="テーマ"
              value={theme}
              onChange={(e) => setTheme(e.target.value as typeof theme)}
            >
              <option value="dark">ダーク</option>
              <option value="light">ライト</option>
              <option value="system">OSに合わせる</option>
            </select>
          </header>
          <div className="library-tools">
            <div className="tabs">
              <button
                className={!trash ? "active" : ""}
                onClick={() => {
                  setTrash(false);
                  void loadMaps(false);
                }}
              >
                マイマップ
              </button>
              <button
                className={trash ? "active" : ""}
                onClick={() => {
                  setTrash(true);
                  void loadMaps(true);
                }}
              >
                ゴミ箱
              </button>
            </div>
            <button onClick={() => fileRef.current?.click()}>↑ 読み込む</button>
            <button
              className="primary"
              onClick={() => void createMap()}
              disabled={loading}
              aria-label="新しいマップを作成"
            >
              ＋ 新しいマップ
            </button>
          </div>
          {!trash && dueTrashCount > 0 && !reviewDeferred && (
            <div className="trash-review-notice" role="status">
              <p>ゴミ箱に移して約30日を過ぎたマップが{dueTrashCount}件あります。完全削除するか確認してください。</p>
              <p className="muted">確認するまでは保持し、復元できます。保留後も次の起動・再読み込みで案内します。</p>
              <div className="card-actions">
                <button onClick={() => { setTrash(true); void loadMaps(true); }}>ゴミ箱で確認</button>
                <button onClick={() => setReviewDeferred(true)}>今回は保留</button>
              </div>
            </div>
          )}
          {trash && (
            <p className="muted">
              ゴミ箱へ移して約30日後に、完全削除するか確認します。了承するまで自動削除せず、30日後も復元できます。
            </p>
          )}
          {error && (
            <div className="error-banner" role="alert">
              {error}
              <button onClick={() => void loadMaps()}>再読み込み</button>
            </div>
          )}
          {loading && <p role="status">読み込み中…</p>}
          <div className="map-grid">
            {maps.map((map) => (
              <article className="map-card" key={map.id}>
                <button
                  className="map-open"
                  onClick={() => !trash && void openMap(map.id)}
                  disabled={trash}
                >
                  <div className="map-preview">
                    <span /> <b>◈</b>
                    <span />
                  </div>
                  <h2>{map.title}</h2>
                  <p>{dateText(map.updatedAt)} 更新</p>
                </button>
                {trash && map.deletedAt && <div className="trash-dates">
                  <p>ゴミ箱へ移した日：{new Date(map.deletedAt).toLocaleDateString("ja-JP")}</p>
                  <p>削除確認の目安：{new Date(trashReviewDate(map.deletedAt)).toLocaleDateString("ja-JP")}</p>
                  {isTrashReviewDue(map.deletedAt, reviewNow) && <p className="trash-review-due">削除確認の目安を過ぎています。保留する場合はそのまま残せます。</p>}
                </div>}
                <div className="card-actions">
                  {trash ? (
                    <>
                      <button
                        onClick={async () => {
                          try {
                            await request(
                              `/api/maps/${map.id}/restore`,
                              "POST",
                            );
                            await loadMaps(true);
                          } catch (cause) {
                            setError(errorText(cause));
                          }
                        }}
                      >
                        復元
                      </button>
                      <button
                        className="danger"
                        onClick={() => {
                          setDeleteTarget(map);
                          setDeleteConfirmation("");
                          setDeleteError("");
                          setModal("delete");
                        }}
                      >
                        完全削除
                      </button>
                    </>
                  ) : (
                    <button
                      aria-label={`${map.title}をゴミ箱へ移動`}
                      onClick={async () => {
                        try {
                          await request(`/api/maps/${map.id}`, "DELETE");
                          await loadMaps(false);
                        } catch (cause) {
                          setError(errorText(cause));
                        }
                      }}
                    >
                      ゴミ箱へ
                    </button>
                  )}
                </div>
              </article>
            ))}
          </div>
          {!loading && maps.length === 0 && (
            <div className="empty-state">
              <span>✧</span>
              <h2>
                {trash ? "ゴミ箱は空です" : "最初のアイデアから、始めよう。"}
              </h2>
              <p>
                {trash
                  ? "削除したマップがここに表示されます。"
                  : "新しいマップを作って、Tabで枝を広げてみましょう。"}
              </p>
            </div>
          )}
          <footer className="library-footer">
            <span className="status-dot" /> ローカル保存 · 外部への送信なし{" "}
            <button onClick={() => setModal("help")}>使い方</button>
          </footer>
        </main>
      ) : (
        <>
          <header className="editor-header">
            <button
              className="home-button"
              aria-label="マップ一覧へ戻る"
              onClick={() => void goHome()}
            >
              ◈
            </button>
            <div className="document-heading">
              <input
                aria-label="マップ名"
                value={titleDraft ?? doc.title}
                onChange={(e) => {
                  const value = e.target.value;
                  titleDraftRef.current = value; setTitleDraft(value);
                  if (value.trim()) attempt(() => commit({ type: "SetTitle", title: value }));
                }}
                onBlur={() => {
                  if (titleDraftRef.current !== null) attempt(() => commit({ type: "SetTitle", title: titleDraftRef.current! }));
                  titleDraftRef.current = null; setTitleDraft(null);
                }}
              />
              <span className={`save-status ${hasAuxiliaryDraft() ? "pending" : autosave.status}`} role="status">
                <i />
                {
                  (
                    {
                      saved: "保存済み",
                      pending: "未保存",
                      saving: "保存中…",
                      failed: "未保存",
                    } as const
                  )[hasAuxiliaryDraft() ? "pending" : autosave.status]
                }
              </span>
            </div>
            <div className="header-spacer" />
            <button onClick={() => setModal("help")}>
              ? <span className="desktop-label">使い方</span>
            </button>
            <button
              onClick={() => {
                setSearchOpen((value) => !value);
                setTimeout(() => searchRef.current?.focus(), 0);
              }}
              aria-label="マップ内検索"
            >
              ⌕
            </button>
            <button
              onClick={togglePanel}
              aria-label="書式パネルを切り替え"
            >
              ▤
            </button>
            <button
              className="primary export-main"
              aria-label="PNG画像を保存"
              onClick={() => void exportFile("png")}
              disabled={exporting}
            >
              ↓ PNG画像
            </button>
            <button
              aria-label="書き出し形式を選択"
              onClick={() => setModal("export")}
            >
              ⌄
            </button>
          </header>
          <div className="toolbar">
            <button
              aria-label="元に戻す"
              onClick={undo}
              disabled={!history.current.canUndo}
            >
              ↶
            </button>
            <button
              aria-label="やり直す"
              onClick={redo}
              disabled={!history.current.canRedo}
            >
              ↷
            </button>
            <span className="separator" />
            <button
              aria-label="子トピックを追加"
              onClick={() => add("child")}
              disabled={!selected.length}
            >
              ＋ 子<span className="shortcut">Tab</span>
            </button>
            <button
              aria-label="次の兄弟トピックを追加"
              onClick={() => add("next")}
              disabled={!selected.length}
            >
              ＋ 兄弟<span className="shortcut">↵</span>
            </button>
            <button onClick={() => add("previous")} disabled={!selected.length}>
              前に追加
            </button>
            <span className="separator" />
            <button onClick={() => void copy()} disabled={!selected.length}>
              コピー
            </button>
            <button onClick={() => void paste()} disabled={!selected.length}>
              貼り付け
            </button>
            <button onClick={duplicate} disabled={!selected.length}>
              複製
            </button>
            <button
              onClick={remove}
              disabled={
                !selected.length ||
                (selected.length === 1 && selected[0] === doc.rootId)
              }
            >
              削除
            </button>
            <button aria-label="画像を添付" disabled={imageBusy || selected.length !== 1} onClick={() => imageFileRef.current?.click()}>▧ 画像</button>
            <div className="header-spacer" />
            <button
              onClick={toggleOutline}
              aria-pressed={outline}
            >
              ☷ アウトライン
            </button>
            <button onClick={() => void showRecovery()}>復旧</button>
            <button onClick={() => fileRef.current?.click()}>読み込む</button>
          </div>
          {imageBusy && <div className="image-progress" role="status">画像を取り込んでいます… 元のファイルへの参照は保存しません。</div>}
          {imageError && <div className="error-banner" role="alert">{imageError}{imageRetry.current && <button onClick={() => { const retry = imageRetry.current; if (retry) void addImages(retry.nodeId, retry.files); }}>画像の取り込みを再試行</button>}<button aria-label="画像エラーを閉じる" onClick={() => setImageError("")}>×</button></div>}
          {autosave.status === "failed" && (
            <div className="error-banner" role="alert">
              <div>
                <strong>保存できていません</strong> — {autosave.error}
                。ローカルサーバーと空き容量を確認してください。
              </div>
              <button
                aria-label="保存を再試行"
                onClick={() => void autosave.flush()}
              >
                保存を再試行
              </button>
              <button onClick={() => void exportFile("json")}>
                JSONを保存
              </button>
            </div>
          )}
          {error && (
            <div className="error-banner" role="alert">
              {error}
              <button onClick={() => setError("")} aria-label="エラーを閉じる">
                ×
              </button>
            </div>
          )}
          <div className="workspace">
            {outline && (
              <aside className="outline">
                <div className="panel-heading">
                  <h2>アウトライン</h2>
                  <button aria-label="アウトラインを閉じる" onClick={closeOutline}>×</button>
                </div>
                <OutlineEditor
                  document={doc}
                  selected={selected}
                  editing={editing}
                  active={editingSurface === "outline"}
                  onKey={key}
                  onActivate={() => activate("outline")}
                  onSelect={(id) => { activate("outline"); reveal(id); }}
                  onStartEdit={(id) => { activate("outline"); startEdit(id); }}
                  onDraft={updateDraft}
                  onFinishEdit={finishEdit}
                  onCancelEdit={cancelEdit}
                  onAdd={(kind) => { activate("outline"); add(kind); }}
                />
              </aside>
            )}
            <div className="canvas-container" onPointerDownCapture={() => activate("canvas")}>
              <MapCanvas
                document={doc}
                selected={selected}
                editing={editing}
                canvasRef={canvasRef}
                focusEnabled={editingSurface === "canvas"}
                onActivate={() => activate("canvas")}
                onSelect={select}
                onStartEdit={startEdit}
                onDraft={updateDraft}
                onFinishEdit={finishEdit}
                onCancelEdit={cancelEdit}
                onAdd={add}
                onImageFiles={(id, files) => void addImages(id, files)}
                onImageOpen={openImage}
                onMove={(id, parentId, beforeId) =>
                  attempt(() =>
                    commit({ type: "MoveSubtree", id, parentId, beforeId }),
                  )
                }
                onCamera={setCamera}
                onToggle={(id) =>
                  attempt(() => commit({ type: "ToggleCollapse", id }))
                }
                onKey={key}
                onContextAction={(action) => {
                  if (action === "child") add("child");
                  else if (action === "sibling") add("next");
                  else if (action === "edit" && selectedRef.current[0])
                    startEdit(selectedRef.current[0]);
                  else if (action === "copy") void copy();
                  else if (action === "paste") void paste();
                  else if (action === "duplicate") duplicate();
                  else if (action === "delete") remove();
                  else if (action === "collapse" && selectedRef.current[0])
                    attempt(() =>
                      commit({
                        type: "ToggleCollapse",
                        id: selectedRef.current[0],
                      }),
                    );
                }}
              />
              {searchOpen && (
                <div className="search-box">
                  <input
                    ref={searchRef}
                    aria-label="検索語"
                    placeholder="トピックとメモを検索"
                    value={query}
                    onChange={(e) => {
                      setQuery(e.target.value);
                      setSearchIndex(-1);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        searchNext(e.shiftKey ? -1 : 1);
                      }
                      if (e.key === "Escape") setSearchOpen(false);
                    }}
                  />
                  <span>
                    {query
                      ? searchResults.length
                        ? searchIndex < 0 ? `${searchResults.length}件 · Enterで移動` : `${searchIndex + 1}/${searchResults.length}`
                        : "結果なし"
                      : ""}
                  </span>
                  <button
                    aria-label="前の検索結果"
                    disabled={!searchResults.length}
                    onClick={() => searchNext(-1)}
                  >
                    ↑
                  </button>
                  <button
                    aria-label="次の検索結果"
                    disabled={!searchResults.length}
                    onClick={() => searchNext()}
                  >
                    ↓
                  </button>
                  <button
                    aria-label="検索を閉じる"
                    onClick={() => setSearchOpen(false)}
                  >
                    ×
                  </button>
                </div>
              )}
              <div className="canvas-hint">
                {selected.length > 1
                  ? `${selected.length}件を選択中`
                  : "Tabで子を追加 · Enterで兄弟を追加"}{" "}
                <button onClick={() => setModal("help")}>操作ガイド</button>
              </div>
              <div className="zoom-control">
                <button
                  aria-label="縮小"
                  onClick={() =>
                    setCamera({
                      ...doc.viewState.camera,
                      zoom: Math.max(0.1, doc.viewState.camera.zoom / 1.2),
                    })
                  }
                >
                  −
                </button>
                <span>{Math.round(doc.viewState.camera.zoom * 100)}%</span>
                <button
                  aria-label="拡大"
                  onClick={() =>
                    setCamera({
                      ...doc.viewState.camera,
                      zoom: Math.min(3, doc.viewState.camera.zoom * 1.2),
                    })
                  }
                >
                  ＋
                </button>
                <span className="separator" />
                <button aria-label="全体表示" onClick={fit}>
                  ⛶
                </button>
                <button
                  aria-label="選択へ移動"
                  onClick={() => selected[0] && reveal(selected[0])}
                >
                  ◎
                </button>
              </div>
            </div>
            {panel && (
              <aside className="inspector">
                <div className="panel-heading">
                  <h2>トピック</h2>
                  <button
                    aria-label="書式パネルを閉じる"
                    onClick={() => setPanel(false)}
                  >
                    ×
                  </button>
                </div>
                {selectedNode ? (
                  <>
                    <p className="selected-label">
                      {selected.length > 1
                        ? `${selected.length}件のトピック`
                        : selectedNode.text || "新しいトピック"}
                    </p>
                    <section>
                      <h3>書式</h3>
                      <label>
                        文字サイズ
                        <select
                          aria-label="文字サイズ"
                          value={
                            selectedNode.style?.fontSize ||
                            (selectedNode.id === doc.rootId ? 22 : 16)
                          }
                          onChange={(e) =>
                            attempt(() =>
                              commit({
                                type: "SetStyle",
                                ids: selected,
                                style: { fontSize: Number(e.target.value) },
                              }),
                            )
                          }
                        >
                          {[12, 14, 16, 18, 20, 22, 24, 28, 32, 36, 40].map(
                            (size) => (
                              <option key={size} value={size}>
                                {size}px
                              </option>
                            ),
                          )}
                        </select>
                      </label>
                      <p className="field-label">枝の色</p>
                      <div className="color-swatches">
                        {BRANCH_COLORS.map((color) => (
                          <button
                            key={color}
                            aria-label={`枝色 ${color}`}
                            style={{ background: color }}
                            aria-pressed={
                              selectedNode.style?.branchColor === color
                            }
                            onClick={() =>
                              attempt(() =>
                                commit({
                                  type: "SetStyle",
                                  ids: selected,
                                  style: { branchColor: color },
                                }),
                              )
                            }
                          />
                        ))}
                        <input
                          aria-label="カスタム枝色"
                          type="color"
                          value={
                            selectedNode.style?.branchColor || BRANCH_COLORS[0]
                          }
                          onChange={(e) =>
                            attempt(() =>
                              commit({
                                type: "SetStyle",
                                ids: selected,
                                style: { branchColor: e.target.value },
                              }),
                            )
                          }
                        />
                      </div>
                      {selectedNode.parentId === doc.rootId && (
                        <label>
                          枝の方向
                          <select
                            aria-label="枝の方向"
                            value={selectedNode.side || "right"}
                            onChange={(e) =>
                              attempt(() =>
                                commit({
                                  type: "SetSide",
                                  id: selectedNode.id,
                                  side: e.target.value as "left" | "right",
                                }),
                              )
                            }
                          >
                            <option value="left">左</option>
                            <option value="right">右</option>
                          </select>
                        </label>
                      )}
                    </section>
                    <section>
                      <h3>メモ</h3>
                      <textarea
                        key={`note-${selectedNode.id}`}
                        aria-label="トピックのメモ"
                        placeholder="考えの補足や、長い文章をここに。"
                        value={selectedNode.note}
                        onFocus={() => {
                          noteSession.current = docRef.current;
                        }}
                        onChange={(e) =>
                          attempt(() => {
                            if (noteSession.current) {
                              history.current.record(noteSession.current);
                              noteSession.current = null;
                            }
                            commit(
                              {
                                type: "SetNote",
                                id: selectedNode.id,
                                note: e.target.value,
                              },
                              false,
                            );
                          })
                        }
                        onBlur={() => {
                          noteSession.current = null;
                        }}
                      />
                      <p className="field-hint">メモも自動保存します。</p>
                      <label>
                        リンク
                        <input
                          key={`link-${selectedNode.id}`}
                          aria-label="トピックのリンク"
                          type="url"
                          placeholder="https://"
                          value={linkDrafts[selectedNode.id] ?? selectedNode.link ?? ""}
                          onFocus={() => { linkSession.current = docRef.current; }}
                          onChange={(e) => {
                            const value = e.target.value;
                            const drafts = { ...linkDraftsRef.current, [selectedNode.id]: value };
                            linkDraftsRef.current = drafts; setLinkDrafts(drafts);
                            if (!isSafeLink(value)) return;
                            attempt(() => {
                              if (linkSession.current) { history.current.record(linkSession.current); linkSession.current = null; }
                              commit({ type: "SetLink", id: selectedNode.id, link: value }, false);
                              setError(current => current.startsWith("リンクは") || current.startsWith("入力中のマップ名") ? "" : current);
                            });
                          }}
                          onBlur={(e) => {
                            linkSession.current = null;
                            if (!isSafeLink(e.target.value)) setError("リンクはhttpまたはhttpsの完全なURLにしてください。入力は保持されています。");
                          }}
                        />
                      </label>
                    </section>
                    <section className="image-inspector"><h3>画像</h3><button className="wide" disabled={imageBusy || selected.length !== 1} onClick={() => imageFileRef.current?.click()}>画像を選択して添付</button><p className="field-hint">PNG・JPEG・WebP、1枚10MBまで。画像の貼り付けとノードへのドロップも使えます。元の場所に依存せず保存します。</p>{selectedNode.images?.map((id, index) => <div className="image-inspector-item" key={id}><button className="attachment-thumb" aria-label={`添付画像${index + 1}を拡大`} onClick={() => openImage(selectedNode.id, index)}><img src={imageURL(doc.documentId, id)} alt={`添付画像${index + 1}`} /></button><button aria-label={`添付画像${index + 1}を外す`} onClick={() => attempt(() => commit({ type: "DetachImage", id: selectedNode.id, assetId: id }))}>外す</button></div>)}</section>
                    {selectedNode.childIds.length > 0 && (
                      <button
                        className="wide"
                        onClick={() =>
                          attempt(() =>
                            commit({
                              type: "ToggleCollapse",
                              id: selectedNode.id,
                            }),
                          )
                        }
                      >
                        {doc.viewState.collapsedNodeIds.includes(
                          selectedNode.id,
                        )
                          ? "枝を展開"
                          : "枝を折り畳む"}
                      </button>
                    )}
                  </>
                ) : (
                  <p className="muted">
                    トピックを選ぶと書式とメモを編集できます。
                  </p>
                )}
                <section className="map-settings">
                  <h3>マップ設定</h3>
                  <label>
                    レイアウト
                    <select
                      aria-label="レイアウト"
                      value={doc.layout}
                      onChange={(e) =>
                        attempt(() =>
                          commit({
                            type: "SetLayout",
                            layout: e.target.value as MindmapDocument["layout"],
                          }),
                        )
                      }
                    >
                      <option value="mindmap">左右のマインドマップ</option>
                      <option value="logic">右向きロジックチャート</option>
                    </select>
                  </label>
                  <label>
                    テーマ
                    <select
                      aria-label="テーマ"
                      value={theme}
                      onChange={(e) => setTheme(e.target.value as typeof theme)}
                    >
                      <option value="dark">ダーク</option>
                      <option value="light">ライト</option>
                      <option value="system">OSに合わせる</option>
                    </select>
                  </label>
                </section>
              </aside>
            )}
          </div>
          <footer className="editor-footer">
            <span>
              <i className="status-dot" /> このMacに保存
            </span>
            <span>{Object.keys(doc.nodes).length} トピック</span>
            <span>Undoは再起動でリセット</span>
          </footer>
        </>
      )}
      {notice && (
        <div role="status" className="toast">
          {notice}
          <button onClick={() => setNotice("")} aria-label="通知を閉じる">
            ×
          </button>
        </div>
      )}
      {modal && (
        <div
          className="modal-backdrop"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) closeModal();
          }}
        >
          <section
            ref={modalRef}
            role="dialog"
            aria-modal="true"
            aria-label={
              modal === "delete" ? "マップの完全削除" : modal === "image" ? "添付画像の拡大表示" : modal === "help"
                ? "操作ガイド"
                : modal === "export"
                  ? "書き出し"
                  : modal === "recovery"
                    ? "保存内容の復旧"
                    : "読み込みプレビュー"
            }
            className={`modal ${modal === "image" ? "image-modal" : ""}`}
          >
            <div className="panel-heading">
              <h2>
                {modal === "delete" ? "マップを完全削除する" : modal === "image" ? "添付画像" : modal === "help"
                  ? "操作ガイド"
                  : modal === "export"
                    ? "マップを書き出す"
                    : modal === "recovery"
                      ? "保存内容の復旧"
                      : "読み込みプレビュー"}
              </h2>
              <button
                autoFocus
                aria-label="ダイアログを閉じる"
                onClick={closeModal}
                disabled={deleteBusy}
              >
                ×
              </button>
            </div>
            {modal === "delete" && deleteTarget ? <form onSubmit={event => { event.preventDefault(); void deleteMap(); }}>
              <p className="delete-target-name">「{deleteTarget.title}」と添付画像・保存版を完全削除します。元に戻せません。</p>
              <p className="muted">削除する場合は、対象のマップ名をそのまま入力してください。保留するとゴミ箱に残り、復元できます。</p>
              <p className="muted">既存のバックアップと書き出したファイルは別途保持されます。</p>
              <label className="delete-name-label">確認のためマップ名を入力
                <input aria-label="確認のためマップ名を入力" value={deleteConfirmation} onChange={event => setDeleteConfirmation(event.target.value)} disabled={deleteBusy} autoComplete="off" />
              </label>
              {deleteError && <p className="error-banner" role="alert">{deleteError}</p>}
              <div className="card-actions">
                <button type="button" onClick={closeModal} disabled={deleteBusy}>今回は保留</button>
                <button type="submit" className="danger" disabled={deleteBusy || deleteConfirmation !== deleteTarget.title}>{deleteBusy ? "削除中…" : "完全削除する"}</button>
              </div>
            </form> : modal === "image" && imagePreview ? <><ImagePreview key={imagePreview.imageId} mapId={imagePreview.mapId} imageId={imagePreview.imageId} label={imagePreview.label} /><p className="muted">画像データはアプリ内に保存されています。</p></> : modal === "help" ? (
              <Help />
            ) : modal === "export" ? (
              <div className="export-options">
                <p>画面外と折り畳み内の枝も含む、マップ全体を保存します。</p>
                <label>
                  PNG倍率
                  <select
                    aria-label="PNG倍率"
                    value={pngScale}
                    onChange={(e) => setPngScale(Number(e.target.value))}
                  >
                    <option value={1}>1x</option>
                    <option value={2}>2x</option>
                  </select>
                </label>
                <p className="muted">
                  最大4096×4096px。大きい図は上限内へ縮小します。
                </p>
                <button
                  className="primary wide"
                  onClick={() => void exportFile("png")}
                  disabled={exporting}
                >
                  PNG画像を保存
                </button>
                <button
                  className="wide"
                  onClick={() => void exportFile("svg")}
                  disabled={exporting}
                >
                  SVG画像を保存
                </button>
                <button
                  className="wide"
                  onClick={() => void exportFile("json")}
                >
                  JSONバックアップを保存
                </button>
                <button
                  className="wide"
                  onClick={() => void exportFile("markdown")}
                >
                  Markdownを保存
                </button>
              </div>
            ) : modal === "import" ? (
              <>
                <p>
                  検証後、新しいマップとして読み込みます。現在のマップは置き換えません。
                </p>
                {loading ? (
                  <p>ファイルを検証中…</p>
                ) : importPreview ? (
                  <>
                    <h3>{importPreview.title}</h3>
                    <p>{Object.keys(importPreview.nodes).length} トピック · {importAssets?.length || 0} 画像{importAssets?.length ? ` · ${(importAssets.reduce((sum, asset) => sum + asset.byteSize, 0) / 1024).toFixed(1)} KB` : ""}</p>
                    <div className="import-tree">
                      {Object.values(importPreview.nodes)
                        .slice(0, 12)
                        .map((n) => (
                          <article key={n.id}><p>{n.text}</p>{n.note && <p>メモ: {n.note}</p>}{n.link && <p>リンク: {n.link}</p>}</article>
                        ))}
                    </div>
                    <button
                      className="primary wide"
                      onClick={() => void acceptImport()}
                    >
                      新しいマップとして読み込む
                    </button>
                  </>
                ) : (
                  <p>
                    読み込みに失敗しました。別のファイルを選択してください。
                  </p>
                )}
                {error && (
                  <p role="alert" className="danger">
                    {error}
                  </p>
                )}
                <button
                  className="wide"
                  onClick={() => fileRef.current?.click()}
                >
                  ファイルを選び直す
                </button>
              </>
            ) : (
              <>
                <p>
                  直近5世代の保存内容を確認して復旧できます。復旧前の現在の内容も保存世代に残します。
                </p>
                {error && <p role="alert" className="danger">{error}</p>}
                {snapshots.length === 0 && (
                  <p className="muted">復旧できる保存世代はまだありません。</p>
                )}
                <div className="snapshot-list">
                  {snapshots.map((snapshot) => (
                    <button
                      key={snapshot.id}
                      onClick={async () => {
                        try {
                          setSnapshotPreview(
                            await readDocument(
                              `/api/maps/${doc!.documentId}/snapshots/${snapshot.id}`,
                            ),
                          );
                          setSnapshotId(snapshot.id);
                        } catch (cause) {
                          setError(errorText(cause));
                        }
                      }}
                    >
                      {dateText(snapshot.createdAt)} の内容を確認 · {snapshot.id.slice(0, 8)}
                    </button>
                  ))}
                </div>
                {snapshotPreview && (
                  <>
                    <h3>{snapshotPreview.title}</h3>
                    <p>
                      {Object.keys(snapshotPreview.nodes).length} トピック ·{" "}
                      {dateText(snapshotPreview.updatedAt)}
                    </p>
                    <div className="import-tree">
                      {Object.values(snapshotPreview.nodes)
                        .slice(0, 12)
                        .map((n) => (
                          <article key={n.id}><p>{n.text}</p>{n.note && <p>メモ: {n.note}</p>}{n.link && <p>リンク: {n.link}</p>}</article>
                        ))}
                    </div>
                    <button
                      className="primary wide"
                      onClick={async () => {
                        if (!confirm("この保存内容へ復旧しますか？")) return;
                        try {
                          if (!(await autosave.flush()))
                            throw new Error(
                              "現在の内容を保存できませんでした。先にJSONを保存してください。",
                            );
                          const value = await request<MindmapDocument>(
                            `/api/maps/${doc!.documentId}/snapshots/${snapshotId}/restore`,
                            "POST",
                          );
                          openDocument(value);
                        } catch (cause) {
                          setError(errorText(cause));
                        }
                      }}
                    >
                      この内容へ復旧
                    </button>
                  </>
                )}
              </>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
