import { validateImageMetadata, type ImageAssetMetadata } from '../domain';
export type UploadedImage = ImageAssetMetadata & { id: string };
export const imageURL = (mapId: string, imageId: string) => `/api/maps/${encodeURIComponent(mapId)}/images/${encodeURIComponent(imageId)}`;
export async function uploadImage(mapId: string, image: Blob): Promise<UploadedImage> {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(image.type)) throw new Error('画像はPNG・JPEG・WebPを選んでください。');
  if (image.size > 10 * 1024 * 1024) throw new Error('画像は1枚10MB以内にしてください。');
  const response = await fetch(`/api/maps/${encodeURIComponent(mapId)}/images`, { method: 'POST', headers: { 'Content-Type': image.type }, body: image });
  if (!response.ok) { const data = await response.json().catch(() => null); throw new Error(data?.error || `画像を取り込めませんでした (${response.status})`); }
  const value = await response.json();
  if (!value || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.id)) throw new Error('画像の応答形式が不正です。');
  const { id: _id, ...metadata } = value;
  validateImageMetadata(metadata);
  return value;
}
export async function loadImageAssets(document: import('../domain').MindmapDocument): Promise<import('../io').PortableImageAsset[]> {
  const ids = [...new Set(Object.values(document.nodes).flatMap(node => node.images || []))];
  return Promise.all(ids.map(async id => {
    const metadata = document.imageAssets?.[id];
    if (!metadata) throw new Error('画像の保存情報が見つかりません。');
    const response = await fetch(imageURL(document.documentId, id));
    if (!response.ok) throw new Error('添付画像を読み込めません。サーバーの接続を確認して再試行してください。');
    const bytes = new Uint8Array(await response.arrayBuffer());
    let binary = ''; for (let i = 0; i < bytes.length; i += 32768) binary += String.fromCharCode(...bytes.subarray(i, i + 32768));
    return { id, ...metadata, dataBase64: btoa(binary) };
  }));
}
