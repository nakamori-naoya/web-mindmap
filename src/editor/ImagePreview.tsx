import { useState } from 'react';
import { imageURL } from './imageApi';
export function ImagePreview({mapId,imageId,label}:{mapId:string;imageId:string;label:string}) {
  const [failed,setFailed]=useState(false);
  const [attempt,setAttempt]=useState(0);
  return failed ? <div role="alert" className="image-preview-error"><p>添付画像を読み込めません。ローカルサーバーの接続を確認してください。</p><button onClick={()=>{setFailed(false);setAttempt(value=>value+1);}}>画像を再読み込み</button></div> : <img key={attempt} className="image-full" src={imageURL(mapId,imageId)} alt={label} onError={()=>setFailed(true)} />;
}
