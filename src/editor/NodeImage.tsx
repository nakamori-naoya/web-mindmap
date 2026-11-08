import { useState } from 'react';
import { imageURL } from './imageApi';
type Props = { mapId: string; imageId: string; label: string; onOpen(): void };
export function NodeImage({ mapId, imageId, label, onOpen }: Props) {
  const [failed, setFailed] = useState(false);
  const [generation, setGeneration] = useState(0);
  return failed ? <div className="image-missing" role="alert"><span>画像を読み込めません</span><button onClick={() => { setFailed(false); setGeneration(value => value + 1); }}>再試行</button></div> : <button className="image-open" aria-label={`${label}を拡大`} onClick={onOpen} onPointerDown={event => event.stopPropagation()} onDoubleClick={event => event.stopPropagation()}><img key={generation} src={imageURL(mapId, imageId)} alt={label} draggable={false} onError={() => setFailed(true)} /></button>;
}
