import { test, expect, type Page } from '@playwright/test';
async function create(page: Page) {
  await page.goto('/');
  await page.getByRole('button', {name:'新しいマップを作成'}).click();
  const input=page.getByRole('textbox',{name:'トピック本文',exact:true});
  await input.fill('画像のある考え'); await input.press('Enter');
  await expect(page.getByText('保存済み',{exact:true})).toBeVisible();
  return new URL(page.url()).hash.slice(5);
}
async function fixture(page: Page) {
  return Buffer.from(await page.evaluate(() => {const canvas=document.createElement('canvas'); canvas.width=320;canvas.height=180;const ctx=canvas.getContext('2d')!;ctx.fillStyle='#24576d';ctx.fillRect(0,0,320,180);ctx.fillStyle='#ffffff';ctx.font='24px sans-serif';ctx.fillText('Synthetic image',24,90);return canvas.toDataURL('image/png').split(',')[1];}), 'base64');
}
async function attach(page: Page) {
  await page.getByLabel('ノードに添付する画像').setInputFiles({name:'private-original-name.png',mimeType:'image/png',buffer:await fixture(page)});
  await expect(page.locator('.topic .node-attachment img')).toBeVisible();
  await expect(page.getByText('保存済み',{exact:true})).toBeVisible();
}
test('画像を取り込み保存し、拡大・Undo・再読込でも元パスを必要としない',async({page})=>{
  const id=await create(page);await attach(page);
  const img=page.locator('.topic .node-attachment img');
  await expect(img).toHaveAttribute('src',new RegExp(`/api/maps/${id}/images/`));
  const inputBox=await page.locator('.root-topic .node-input').boundingBox(),imageBox=await img.boundingBox();expect(inputBox!.y+inputBox!.height).toBeLessThanOrEqual(imageBox!.y);
  await page.getByRole('button',{name:'子トピックを追加',exact:true}).first().click();const child=page.getByRole('textbox',{name:'トピック本文',exact:true});await child.fill('子');await child.press('Enter');
  const textBox=await page.locator('.root-topic .node-text').boundingBox();expect(textBox!.y+textBox!.height).toBeLessThanOrEqual((await img.boundingBox())!.y);
  await page.locator('.root-topic .node-text').click();
  await img.click(); await expect(page.getByRole('dialog',{name:'添付画像の拡大表示'})).toBeVisible();
  await page.getByRole('button',{name:'ダイアログを閉じる'}).click();
  await page.getByRole('button',{name:'添付画像1を外す'}).click();await expect(img).toHaveCount(0);
  await page.getByRole('button',{name:'元に戻す',exact:true}).click();await expect(img).toBeVisible();
  await expect(page.getByText('保存済み',{exact:true})).toBeVisible();await page.reload();await expect(img).toBeVisible();
  const doc=await(await page.request.get(`/api/maps/${id}`)).json();expect(doc.schemaVersion).toBe(2);expect(JSON.stringify(doc)).not.toContain('private-original-name');
  const root=doc.nodes[doc.rootId];expect(root.images).toHaveLength(1);expect(doc.imageAssets[root.images[0]].width).toBe(320);
});
test('画像込みJSONとSVGを出力し、新規読込で画像も戻る',async({page})=>{
  const id=await create(page);await attach(page);
  await page.getByRole('button',{name:'書き出し形式を選択'}).click();
  const download=page.waitForEvent('download');await page.getByRole('button',{name:'JSONバックアップを保存'}).click();
  const file=await download;const stream=await file.createReadStream();const chunks:Buffer[]=[];for await(const chunk of stream!)chunks.push(Buffer.from(chunk));const bytes=Buffer.concat(chunks);const bundle=JSON.parse(bytes.toString());
  expect(bundle.format).toBe('mindmap-backup');expect(bundle.assets).toHaveLength(1);expect(bundle.assets[0].dataBase64).toBeTruthy();expect(bytes.toString()).not.toContain('private-original-name');
  const svgDownload=page.waitForEvent('download');await page.getByRole('button',{name:'SVG画像を保存',exact:true}).click();
  const svgStream=await(await svgDownload).createReadStream();let svg='';for await(const chunk of svgStream!)svg+=chunk.toString();expect(svg).toContain('data:image/webp;base64,');expect(svg).not.toContain('file:');
  await page.getByRole('button',{name:'ダイアログを閉じる'}).click();
  await page.getByLabel('マップを読み込むファイル').setInputFiles({name:'image-backup.json',mimeType:'application/json',buffer:bytes});
  await expect(page.getByRole('dialog')).toContainText('1 画像');await page.getByRole('button',{name:'新しいマップとして読み込む'}).click();
  await expect.poll(() => new URL(page.url()).hash.slice(5)).not.toBe(id);await expect(page.getByRole('dialog')).toHaveCount(0);await expect(page.locator('.topic .node-attachment img')).toBeVisible();
});
test('不正な画像は案内し元のノードを変えず、アップロード失敗後に再試行できる',async({page})=>{
 await create(page);
 await page.getByLabel('ノードに添付する画像').setInputFiles({name:'fake.png',mimeType:'image/png',buffer:Buffer.from('not an image')});
 await expect(page.getByRole('alert')).toBeVisible();await expect(page.locator('.node-attachment img')).toHaveCount(0);
 await attach(page);await expect(page.locator('.node-attachment img')).toHaveCount(1);
});

test('ノードへの画像ドロップと画像の貼り付けは本文の通常貼り付けを妨げない',async({page,context})=>{
 await context.grantPermissions(['clipboard-read','clipboard-write']);await create(page);const bytes=await fixture(page);
 await page.locator('.root-topic').evaluate((element,data)=>{const dt=new DataTransfer();const raw=Uint8Array.from(atob(data),c=>c.charCodeAt(0));dt.items.add(new File([raw],'drop.png',{type:'image/png'}));element.dispatchEvent(new DragEvent('drop',{bubbles:true,dataTransfer:dt}));},bytes.toString('base64'));
 await expect(page.locator('.node-attachment img')).toHaveCount(1);
 // 異なる画像を用意し、同一データの重複排除とは独立に貼付を確認する。
 await page.evaluate(async()=>{const c=document.createElement('canvas');c.width=80;c.height=120;c.getContext('2d')!.fillRect(0,0,80,120);const blob=await new Promise<Blob>(resolve=>c.toBlob(blob=>resolve(blob!),'image/png'));await navigator.clipboard.write([new ClipboardItem({'image/png':blob})]);});
 await page.getByRole('region',{name:'マインドマップキャンバス'}).focus();await page.keyboard.press('Meta+V');await expect(page.locator('.node-attachment img')).toHaveCount(2);
 await page.keyboard.press('F2');const input=page.getByRole('textbox',{name:'トピック本文',exact:true});await input.fill('本文');await input.press('End');
 await page.evaluate(()=>navigator.clipboard.writeText('に貼り付け'));await input.press('Meta+V');await expect(input).toHaveValue('本文に貼り付け');await input.press('Enter');
 await expect(page.locator('.node-attachment img')).toHaveCount(2);
});
test('画像付きの枝を別のマップへ貼り付け、画像を新しいIDで保全する',async({page,context})=>{
 await context.grantPermissions(['clipboard-read','clipboard-write']);const source=await create(page);await attach(page);
 const sourceDoc=await(await page.request.get(`/api/maps/${source}`)).json();const sourceImage=sourceDoc.nodes[sourceDoc.rootId].images[0];
 await page.getByRole('button',{name:'コピー',exact:true}).click();await page.getByRole('button',{name:'マップ一覧へ戻る'}).click();
 await page.getByRole('button',{name:'新しいマップを作成'}).click();const input=page.getByRole('textbox',{name:'トピック本文',exact:true});await input.fill('貼り付け先');await input.press('Enter');
 const target=new URL(page.url()).hash.slice(5);await page.getByRole('button',{name:'貼り付け',exact:true}).click();await expect(page.locator('.node-attachment img')).toHaveCount(1);await expect(page.getByText('保存済み',{exact:true})).toBeVisible();
 const targetDoc=await(await page.request.get(`/api/maps/${target}`)).json();const image=Object.values(targetDoc.nodes).flatMap((node:any)=>node.images||[])[0];expect(image).not.toBe(sourceImage);expect((await page.request.get(`/api/maps/${target}/images/${image}`)).ok()).toBe(true);
});

test('画像入りPNGに画像の色が描かれ、取り込み中に選択しても添付先は変わらない',async({page})=>{
 const id=await create(page);const current=await(await page.request.get(`/api/maps/${id}`)).json();const rootId=current.rootId;
 await page.keyboard.press('Tab');const input=page.getByRole('textbox',{name:'トピック本文',exact:true});await input.fill('別のトピック');await input.press('Enter');
 await page.locator('.root-topic .node-text').click();let release:()=>void=()=>{};const gate=new Promise<void>(resolve=>release=resolve);
 await page.route('**/images',async route=>{if(route.request().method()==='POST')await gate;await route.continue();});
 await page.getByLabel('ノードに添付する画像').setInputFiles({name:'synthetic.png',mimeType:'image/png',buffer:await fixture(page)});
 await expect(page.getByText('画像を取り込んでいます…',{exact:false})).toBeVisible();
 await page.getByRole('button',{name:'マップ一覧へ戻る'}).click();expect(new URL(page.url()).hash.slice(5)).toBe(id);
 await page.locator('.topic:not(.root-topic)').click();release();await expect(page.locator('.root-topic .node-attachment img')).toBeVisible();await expect(page.locator('.topic:not(.root-topic) .node-attachment img')).toHaveCount(0);
 await expect(page.getByText('保存済み',{exact:true})).toBeVisible();const doc=await(await page.request.get(`/api/maps/${id}`)).json();expect(doc.nodes[rootId].images).toHaveLength(1);
 const download=page.waitForEvent('download');await page.getByRole('button',{name:'PNG画像を保存',exact:true}).click();const stream=await(await download).createReadStream();const chunks:Buffer[]=[];for await(const c of stream!)chunks.push(Buffer.from(c));const png=Buffer.concat(chunks);expect(png.subarray(0,8).toString('hex')).toBe('89504e470d0a1a0a');
 const {default:sharp}=await import('sharp');const decoded=await sharp(png).removeAlpha().raw().toBuffer({resolveWithObject:true});let blue=0;for(let i=0;i<decoded.data.length;i+=decoded.info.channels)if(decoded.data[i]>=30&&decoded.data[i]<=45&&decoded.data[i+1]>=80&&decoded.data[i+1]<=95&&decoded.data[i+2]>=100&&decoded.data[i+2]<=120)blue++;expect(blue).toBeGreaterThan(500);
 await page.screenshot({path:test.info().outputPath('node-image-editor.png')});
});
