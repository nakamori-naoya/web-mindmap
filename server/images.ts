import sharp from 'sharp';
import { createHash } from 'node:crypto';

export const MAX_IMAGE_UPLOAD_BYTES = 10 * 1024 * 1024;
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
export const MAX_IMAGE_PIXELS = 25_000_000;
export const MAX_IMAGE_EDGE = 2048;
export const MAX_MAP_IMAGE_BYTES = 64 * 1024 * 1024;
export const MAX_MAP_IMAGES = 200;
export const MAX_BACKUP_BYTES = 100 * 1024 * 1024;
export type ImageMetadata = { mime: 'image/webp'; width: number; height: number; byteSize: number };
export type StoredImage = ImageMetadata & { data: Buffer; sha256: string };
export class ImageError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
const accepted = new Map([['image/png', 'png'], ['image/jpeg', 'jpeg'], ['image/webp', 'webp']]);

export async function normalizeImage(data: Buffer, contentType: string): Promise<StoredImage> {
  const mime = contentType.split(';')[0].trim().toLowerCase();
  if (!accepted.has(mime)) throw new ImageError(415, '画像はPNG・JPEG・WebPの静止画を選んでください。');
  if (!data.length) throw new ImageError(422, '空の画像は取り込めません。');
  if (data.length > MAX_IMAGE_UPLOAD_BYTES) throw new ImageError(413, '取り込める画像は10MiB以内です。');
  // SVGなど別形式を画像デコーダへ渡さず、許可したラスタ形式だけを処理する。
  const detected = rasterFormat(data);
  if (!detected) throw new ImageError(422, 'PNG・JPEG・WebPとして読み取れない画像です。');
  if (detected !== accepted.get(mime)) throw new ImageError(415, '画像の内容と種類が一致しません。');
  if (detected === 'png') requireStaticPNG(data);
  try {
    const input = sharp(data, { limitInputPixels: MAX_IMAGE_PIXELS, failOn: 'warning' });
    const metadata = await input.metadata();
    if (metadata.format !== accepted.get(mime)) throw new ImageError(415, '画像の内容と種類が一致しません。PNG・JPEG・WebPの静止画を選んでください。');
    if (!metadata.width || !metadata.height) throw new ImageError(422, '画像の寸法を読み取れません。');
    if (metadata.width * metadata.height > MAX_IMAGE_PIXELS) throw new ImageError(413, '画像は2500万画素以内にしてください。');
    if ((metadata.pages || 1) !== 1) throw new ImageError(415, 'アニメーション画像には対応していません。静止画を選んでください。');
    const output = await input.rotate().resize({ width: MAX_IMAGE_EDGE, height: MAX_IMAGE_EDGE, fit: 'inside', withoutEnlargement: true })
      .webp({ lossless: true, effort: 4 }).timeout({ seconds: 8 }).toBuffer({ resolveWithObject: true });
    if (output.data.length > MAX_IMAGE_BYTES) throw new ImageError(413, '正規化後の画像は8MiB以内にしてください。画像の大きさを小さくして再試行してください。');
    return { mime: 'image/webp', width: output.info.width, height: output.info.height, byteSize: output.data.length, data: output.data, sha256: imageHash(output.data) };
  } catch (error) {
    if (error instanceof ImageError) throw error;
    if (error instanceof Error && /pixel limit|image exceeds/i.test(error.message)) throw new ImageError(413, '画像は2500万画素以内にしてください。');
    throw new ImageError(422, '画像が壊れているか、安全に読み取れない形式です。別の画像を選んでください。');
  }
}

// バックアップ内のWebPも実デコードする。画像以外のメタデータや後置データは受け付けない。
export async function verifyPortableImage(data: Buffer, expected: ImageMetadata): Promise<StoredImage> {
  if (expected.mime !== 'image/webp' || data.length !== expected.byteSize || !data.length || data.length > MAX_IMAGE_BYTES) throw new ImageError(422, 'バックアップの画像サイズまたは種類が一致しません。');
  if (data.length < 12 || data.toString('ascii', 0, 4) !== 'RIFF' || data.toString('ascii', 8, 12) !== 'WEBP' || data.readUInt32LE(4) + 8 !== data.length) throw new ImageError(422, 'バックアップの画像が正しいWebPではありません。');
  let offset = 12;
  while (offset < data.length) {
    if (offset + 8 > data.length) throw new ImageError(422, 'バックアップの画像が壊れています。');
    const chunk = data.toString('ascii', offset, offset + 4);
    if (!['VP8 ', 'VP8L', 'VP8X', 'ALPH'].includes(chunk)) throw new ImageError(422, 'バックアップの画像に未対応のデータが含まれています。');
    offset += 8 + data.readUInt32LE(offset + 4) + (data.readUInt32LE(offset + 4) % 2);
    if (offset > data.length) throw new ImageError(422, 'バックアップの画像が壊れています。');
  }
  try {
    const input = sharp(data, { limitInputPixels: MAX_IMAGE_PIXELS, failOn: 'warning' });
    const metadata = await input.metadata();
    if (metadata.format !== 'webp' || metadata.width !== expected.width || metadata.height !== expected.height || expected.width < 1 || expected.height < 1 || expected.width > MAX_IMAGE_EDGE || expected.height > MAX_IMAGE_EDGE || (metadata.pages || 1) !== 1 || metadata.hasProfile || metadata.exif || metadata.xmp || metadata.iptc || metadata.icc) throw new ImageError(422, 'バックアップの画像の寸法または内容が一致しません。');
    await input.raw().timeout({ seconds: 8 }).toBuffer();
    return { ...expected, data, sha256: imageHash(data) };
  } catch (error) {
    if (error instanceof ImageError) throw error;
    throw new ImageError(422, 'バックアップの画像が壊れています。');
  }
}
export function imageHash(data: Uint8Array) { return createHash('sha256').update(data).digest('hex'); }

function rasterFormat(data: Buffer): 'png' | 'jpeg' | 'webp' | null {
  if (data.length >= 8 && data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'png';
  if (data.length >= 3 && data[0] === 255 && data[1] === 216 && data[2] === 255) return 'jpeg';
  if (data.length >= 12 && data.toString('ascii', 0, 4) === 'RIFF' && data.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  return null;
}

// libvipsがAPNGを1枚のPNGとして読む場合にも、2枚目以降を黙って捨てない。
function requireStaticPNG(data: Buffer) {
  let offset = 8;
  while (offset < data.length) {
    if (offset + 12 > data.length) throw new ImageError(422, 'PNGの内容が途中で切れています。');
    const length = data.readUInt32BE(offset);
    const next = offset + 12 + length;
    if (next > data.length) throw new ImageError(422, 'PNGの内容が途中で切れています。');
    const type = data.toString('ascii', offset + 4, offset + 8);
    if (['acTL', 'fcTL', 'fdAT'].includes(type)) throw new ImageError(415, 'アニメーションPNGには対応していません。静止画を選んでください。');
    if (type === 'IEND') {
      if (length !== 0 || next !== data.length) throw new ImageError(422, 'PNGの末尾に不正なデータがあります。');
      return;
    }
    offset = next;
  }
  throw new ImageError(422, 'PNGの終端がありません。');
}
