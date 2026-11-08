import { test, expect } from '@playwright/test';
import { createDocument } from '../../src/domain/index.ts';

test('約30日の確認を保留しても保持し、確認取消・誤入力では削除せず、明示確認したマップだけ削除する', async ({ page, baseURL }) => {
  const document = createDocument('合成・削除確認');
  const other = createDocument('合成・残す対象');
  for (const doc of [document, other]) {
    expect((await page.request.post('/api/maps', { headers: { Origin: baseURL! }, data: doc })).ok()).toBeTruthy();
  }
  let deletes = 0;
  page.on('request', request => { if (request.method() === 'DELETE' && request.url().endsWith('/permanent')) deletes++; });
  try {
    await page.goto('/');
    const card = page.locator('.map-card').filter({ hasText: document.title });
    await card.getByRole('button', { name: `${document.title}をゴミ箱へ移動` }).click();
    // ブラウザ時刻だけを31日進める。サーバーDBの実データや時計には触れない。
    await page.clock.install({ time: new Date(Date.now() + 31 * 86400000) });
    await page.reload();
    await expect(page.getByRole('status').filter({ hasText: '約30日を過ぎたマップ' })).toBeVisible();
    await page.getByRole('button', { name: '今回は保留' }).click();
    await expect(page.getByRole('button', { name: 'ゴミ箱で確認' })).toHaveCount(0);
    expect(deletes).toBe(0);
    await page.reload();
    await page.getByRole('button', { name: 'ゴミ箱で確認' }).click();
    await expect(card).toContainText('削除確認の目安を過ぎています');
    await card.getByRole('button', { name: '完全削除', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'マップの完全削除' });
    await expect(dialog).toContainText(document.title);
    await dialog.getByRole('textbox', { name: '確認のためマップ名を入力' }).fill('違う名前');
    await expect(dialog.getByRole('button', { name: '完全削除する', exact: true })).toBeDisabled();
    await dialog.getByRole('button', { name: '今回は保留' }).click();
    expect(deletes).toBe(0);
    await expect(card).toBeVisible();
    await card.getByRole('button', { name: '完全削除', exact: true }).click();
    await dialog.getByRole('textbox', { name: '確認のためマップ名を入力' }).fill(document.title);
    await dialog.getByRole('button', { name: '完全削除する', exact: true }).click();
    await expect(card).toHaveCount(0);
    expect(deletes).toBe(1);
    expect((await page.request.get(`/api/maps/${document.documentId}?trash=1`)).status()).toBe(404);
    expect((await page.request.get(`/api/maps/${other.documentId}`)).status()).toBe(200);
  } finally {
    // テスト自身が作成した合成マップだけを片付ける。
    for (const doc of [document, other]) {
      const headers = { Origin: baseURL! };
      await page.request.delete(`/api/maps/${doc.documentId}`, { headers });
      await page.request.delete(`/api/maps/${doc.documentId}/permanent`, { headers, data: { confirmation: doc.title } });
    }
  }
});

test('スマホ幅でも長い対象名が確認画面からはみ出さず、取消で保持する', async ({ page, baseURL }) => {
  const doc = createDocument('LongMindmapTitle'.repeat(18));
  const headers = { Origin: baseURL! };
  expect((await page.request.post('/api/maps', { headers, data: doc })).ok()).toBeTruthy();
  await page.request.delete(`/api/maps/${doc.documentId}`, { headers });
  try {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');
    await page.getByRole('button', { name: 'ゴミ箱', exact: true }).click();
    await page.locator('.map-card').filter({ hasText: doc.title }).getByRole('button', { name: '完全削除', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'マップの完全削除' });
    await expect(dialog).toContainText(doc.title);
    expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    expect((await page.request.get(`/api/maps/${doc.documentId}?trash=1`)).status()).toBe(200);
  } finally {
    await page.request.delete(`/api/maps/${doc.documentId}/permanent`, { headers, data: { confirmation: doc.title } });
  }
});

test('完全削除の連続送信を抑え、通信失敗を成功扱いせず対象を保持する', async ({ page, baseURL }) => {
  const doc = createDocument('合成・削除失敗');
  const headers = { Origin: baseURL! };
  await page.request.post('/api/maps', { headers, data: doc });
  await page.request.delete(`/api/maps/${doc.documentId}`, { headers });
  let releaseRequest!: () => void;
  const released = new Promise<void>(resolve => { releaseRequest = resolve; });
  let requests = 0;
  await page.route(`**/api/maps/${doc.documentId}/permanent`, async route => {
    requests++;
    await released;
    await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: '合成の通信失敗' }) });
  });
  try {
    await page.goto('/');
    await page.getByRole('button', { name: 'ゴミ箱', exact: true }).click();
    await page.locator('.map-card').filter({ hasText: doc.title }).getByRole('button', { name: '完全削除', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'マップの完全削除' });
    await dialog.getByRole('textbox', { name: '確認のためマップ名を入力' }).fill(doc.title);
    await dialog.locator('form').evaluate(form => { (form as HTMLFormElement).requestSubmit(); (form as HTMLFormElement).requestSubmit(); });
    await expect.poll(() => requests).toBe(1);
    await expect(dialog.getByRole('button', { name: '削除中…' })).toBeDisabled();
    releaseRequest();
    await expect(dialog.getByRole('alert')).toContainText('合成の通信失敗');
    expect(requests).toBe(1);
    await dialog.getByRole('button', { name: '今回は保留' }).click();
    expect((await page.request.get(`/api/maps/${doc.documentId}?trash=1`)).status()).toBe(200);
  } finally {
    releaseRequest();
    await page.unroute(`**/api/maps/${doc.documentId}/permanent`);
    await page.request.delete(`/api/maps/${doc.documentId}/permanent`, { headers, data: { confirmation: doc.title } });
  }
});
