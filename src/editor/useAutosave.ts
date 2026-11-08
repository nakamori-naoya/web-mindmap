import { useEffect, useRef, useState } from "react";
import type { MindmapDocument } from "../domain";
import { request } from "./api";
export type SaveStatus = "saved" | "pending" | "saving" | "failed";
export function useAutosave() {
  const [status, setStatus] = useState<SaveStatus>("saved");
  const [error, setError] = useState("");
  const pending = useRef<MindmapDocument | null>(null);
  const active = useRef(false);
  const debounce = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const maximum = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const flushRef = useRef<() => Promise<boolean>>(async () => true);
  const clearTimers = () => {
    clearTimeout(debounce.current);
    clearTimeout(maximum.current);
    debounce.current = maximum.current = undefined;
  };
  const flush = async (): Promise<boolean> => {
    clearTimers();
    if (active.current) return false;
    if (!pending.current) return true;
    active.current = true;
    let succeeded = true;
    while (pending.current) {
      const document = pending.current;
      pending.current = null;
      setStatus("saving");
      try {
        await request(`/api/maps/${document.documentId}`, "PUT", document);
        setError("");
      } catch (cause) {
        if (!pending.current) pending.current = document;
        setError(
          cause instanceof Error
            ? cause.message
            : "ローカルサーバーへ接続できません",
        );
        setStatus("failed");
        succeeded = false;
        break;
      }
    }
    active.current = false;
    if (succeeded) setStatus(pending.current ? "pending" : "saved");
    return succeeded;
  };
  flushRef.current = flush;
  const schedule = (document: MindmapDocument) => {
    pending.current = document;
    setStatus("pending");
    clearTimeout(debounce.current);
    debounce.current = setTimeout(() => void flushRef.current(), 500);
    if (!maximum.current)
      maximum.current = setTimeout(() => void flushRef.current(), 2000);
  };
  const reset = () => {
    clearTimers();
    pending.current = null;
    setStatus("saved");
    setError("");
  };
  useEffect(() => {
    const unload = (event: BeforeUnloadEvent) => {
      if (pending.current || active.current) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", unload);
    const visibility = () => {
      if (document.visibilityState === "hidden") void flushRef.current();
    };
    document.addEventListener("visibilitychange", visibility);
    return () => {
      clearTimers();
      window.removeEventListener("beforeunload", unload);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, []);
  return {
    status,
    error,
    schedule,
    flush,
    reset,
    hasPending: () => Boolean(pending.current || active.current),
  };
}
