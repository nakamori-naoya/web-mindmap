import { validateDocument, type MindmapDocument } from "../domain";
export interface MapSummary {
  id: string;
  title: string;
  updatedAt: string;
  deletedAt: string | null;
}
export interface Snapshot {
  id: string;
  createdAt: string;
}
export async function request<T>(
  path: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  const response = await fetch(path, {
    method,
    headers: body === undefined ? {} : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) {
    const data = await response.json().catch(() => null);
    throw new Error(data?.error || `要求に失敗しました (${response.status})`);
  }
  if (response.status === 204) return undefined as T;
  return response.json();
}
export async function readDocument(path: string): Promise<MindmapDocument> {
  const value = await request<unknown>(path);
  validateDocument(value);
  return value as MindmapDocument;
}
