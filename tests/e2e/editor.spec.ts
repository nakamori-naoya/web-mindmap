import { resolve } from "node:path";
import { readFileSync } from "node:fs";
import { test, expect } from "@playwright/test";
test("日本語編集、階層追加、SQLite再読込とPNG出力", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "新しいマップを作成" }).click();
  await page.getByRole("textbox", { name: "トピック本文" }).fill("Redis");
  await page.getByRole("textbox", { name: "トピック本文" }).press("Enter");
  await page.getByRole("region", { name: "マインドマップキャンバス" }).focus();
  await page.keyboard.press("Tab");
  await page
    .getByRole("textbox", { name: "トピック本文" })
    .fill("レプリケーション");
  await page.getByRole("textbox", { name: "トピック本文" }).press("Enter");
  await page.keyboard.press("Enter");
  await page
    .getByRole("textbox", { name: "トピック本文" })
    .fill("シャーディング");
  await page.getByRole("textbox", { name: "トピック本文" }).press("Enter");
  await expect(page.getByText("保存済み", { exact: true })).toBeVisible();
  await page.reload();
  await expect(
    page.getByText("レプリケーション", { exact: true }).first(),
  ).toBeVisible();
  await expect(
    page.getByText("シャーディング", { exact: true }).first(),
  ).toBeVisible();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "PNG画像を保存" }).click();
  expect((await download).suggestedFilename()).toMatch(/\.png$/);
});
test("IME変換確定で構造変更しない、保存失敗を表示する", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "新しいマップを作成" }).click();
  const input = page.getByRole("textbox", { name: "トピック本文" });
  await input.dispatchEvent("compositionstart");
  await input.fill("日本語");
  await input.dispatchEvent("keydown", {
    key: "Enter",
    code: "Enter",
    isComposing: true,
  });
  await expect(input).toBeVisible();
  await input.dispatchEvent("compositionend");
  await input.press("Enter");
  await expect(page.locator(".topic")).toHaveCount(1);
  await page.route("**/api/maps/*", (route) =>
    route.request().method() === "PUT" ? route.abort() : route.continue(),
  );
  await page
    .getByRole("button", { name: "子トピックを追加", exact: true })
    .first()
    .click();
  await page.getByRole("textbox", { name: "トピック本文" }).fill("未保存の枝");
  await page.getByRole("textbox", { name: "トピック本文" }).press("Enter");
  await expect(page.getByText("未保存", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "保存を再試行" }),
  ).toBeVisible();
});
test("ズーム後のドラッグで親を変更してUndoし、空の新規ノードを取り消す", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "新しいマップを作成" }).click();
  const input = page.getByRole("textbox", { name: "トピック本文" });
  await input.fill("ドラッグ試験");
  await input.press("Enter");
  await page.keyboard.press("Tab");
  await input.fill("枝A");
  await input.press("Enter");
  await page.keyboard.press("Enter");
  await input.fill("枝B");
  await input.press("Enter");
  await page.keyboard.press("Tab");
  await input.fill("配下");
  await input.press("Enter");
  await page.getByRole("button", { name: "縮小", exact: true }).click();
  await page.getByRole("button", { name: "縮小", exact: true }).click();
  await expect(page.locator(".zoom-control")).toContainText("69%");
  const source = page.locator(".topic").filter({ hasText: /^配下/ });
  const target = page.locator(".topic").filter({ hasText: /^枝A/ });
  const from = await source.boundingBox(),
    to = await target.boundingBox();
  await page.mouse.move(from!.x + from!.width / 2, from!.y + from!.height / 2);
  await page.mouse.down();
  await page.mouse.move(to!.x + to!.width / 2, to!.y + to!.height / 2, {
    steps: 12,
  });
  await expect(target).toHaveClass(/drop-child/);
  await page.mouse.up();
  await expect(page.getByText("保存済み", { exact: true })).toBeVisible();
  const id = new URL(page.url()).hash.slice(5);
  let doc = await (await page.request.get(`/api/maps/${id}`)).json();
  const node = (text: string) =>
    Object.values(doc.nodes).find((n: any) => n.text === text) as any;
  expect(doc.viewState.camera.zoom).toBeCloseTo(1 / (1.2 * 1.2));
  expect(node("配下").parentId).toBe(node("枝A").id);
  await page.getByRole("button", { name: "元に戻す", exact: true }).click();
  await expect(page.getByText("保存済み", { exact: true })).toBeVisible();
  doc = await (await page.request.get(`/api/maps/${id}`)).json();
  expect(node("配下").parentId).toBe(node("枝B").id);
  expect(doc.viewState.camera.zoom).toBeCloseTo(1 / (1.2 * 1.2));
  await page.locator(".topic").filter({ hasText: /^枝A/ }).click();
  await page.keyboard.press("Tab");
  await input.press("Escape");
  await expect(page.locator(".topic")).toHaveCount(4);
});
test("JSONプレビューから新規読込、メモ・テーマ・検索・SVG出力", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "新しいマップを作成" }).click();
  const input = page.getByRole("textbox", { name: "トピック本文" });
  await input.fill("バックアップ試験");
  await input.press("Enter");
  await page.keyboard.press("Tab");
  await input.fill("日本語の枝");
  await input.press("Enter");
  await page
    .getByRole("textbox", { name: "トピックのメモ" })
    .fill("詳細なメモ");
  await page.getByRole("heading", { name: "書式", exact: true }).click();
  await page
    .getByRole("combobox", { name: "テーマ", exact: true })
    .selectOption("light");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.getByRole("button", { name: "書き出し形式を選択" }).click();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "JSONバックアップを保存" }).click();
  const downloaded = await downloadPromise;
  const path = await downloaded.path();
  await page.getByRole("button", { name: "ダイアログを閉じる" }).click();
  await page.getByRole("button", { name: "読み込む", exact: true }).click();
  await page.getByLabel("マップを読み込むファイル").setInputFiles({
    name: "roundtrip.json",
    mimeType: "application/json",
    buffer: readFileSync(path!),
  });
  await expect(
    page.getByRole("dialog", { name: "読み込みプレビュー" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "新しいマップとして読み込む" })
    .click();
  await page.getByRole("button", { name: "マップ内検索" }).click();
  await page.getByRole("textbox", { name: "検索語" }).fill("見つからない文章");
  await expect(page.getByText("結果なし", { exact: true })).toBeVisible();
  await page.getByRole("textbox", { name: "検索語" }).fill("日本語");
  await page.getByRole("textbox", { name: "検索語" }).press("Enter");
  await expect(
    page.getByRole("textbox", { name: "トピックのメモ" }),
  ).toHaveValue("詳細なメモ");
  await page.getByRole("button", { name: "書き出し形式を選択" }).click();
  const svgPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "SVG画像を保存" }).click();
  expect((await svgPromise).suggestedFilename()).toMatch(/\.svg$/);
});

test("完成画面と全体PNGを書き出し、証拠を保存", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "新しいマップを作成" }).click();
  const input = page.getByRole("textbox", { name: "トピック本文" });
  await input.fill("Redis");
  await input.press("Enter");
  await page.keyboard.press("Tab");
  await input.fill("レプリケーション");
  await input.press("Enter");
  await page.keyboard.press("Tab");
  await input.fill("非同期レプリケーション");
  await input.press("Enter");
  await page.keyboard.press("Enter");
  await input.fill("フェイルオーバー");
  await input.press("Enter");
  await page.locator(".root-topic").click();
  await page.keyboard.press("Tab");
  await input.fill("シャーディング");
  await input.press("Enter");
  await page.keyboard.press("Tab");
  await input.fill("ハッシュスロット");
  await input.press("Enter");
  await page.keyboard.press("Enter");
  await input.fill("クラスタ構成");
  await input.press("Enter");
  await page.locator(".root-topic").click();
  await page.keyboard.press("Tab");
  await input.fill("障害対応");
  await input.press("Enter");
  await page.keyboard.press("Tab");
  await input.fill("バックアップと復旧");
  await input.press("Enter");
  await page
    .getByRole("textbox", { name: "トピックのメモ" })
    .fill("データを守るために、保存と復旧を先に考える。");
  await page.getByRole("heading", { name: "書式", exact: true }).click();
  await page
    .getByRole("combobox", { name: "テーマ", exact: true })
    .selectOption("dark");
  await page.getByRole("button", { name: "全体表示", exact: true }).click();
  await expect(page.getByText("保存済み", { exact: true })).toBeVisible();
  await page.screenshot({
    path: resolve(process.cwd(), "docs/screenshots/editor.png"),
  });
  const downloaded = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "PNG画像を保存", exact: true })
    .click();
  const png = await downloaded;
  await png.saveAs(
    resolve(process.cwd(), "docs/screenshots/exported-map.png"),
  );
  const bytes = readFileSync(
    resolve(process.cwd(), "docs/screenshots/exported-map.png"),
  );
  expect(bytes.subarray(1, 4).toString()).toBe("PNG");
  expect(bytes.readUInt32BE(16)).toBeGreaterThan(500);
  expect(bytes.readUInt32BE(20)).toBeGreaterThan(100);
});

test("メモ入力中も保存し、Undoの表示を文書に同期する", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "新しいマップを作成" }).click();
  await page.getByRole("textbox", { name: "トピック本文" }).fill("メモ回帰");
  await page.getByRole("textbox", { name: "トピック本文" }).press("Enter");
  const note = page.getByRole("textbox", { name: "トピックのメモ" });
  await note.fill("入力中でも保存するメモ");
  await expect(page.getByText("保存済み", { exact: true })).toBeVisible();
  await page.reload();
  await expect(note).toHaveValue("入力中でも保存するメモ");
  await note.fill("Undoで取り消すメモ");
  await page.getByRole("button", { name: "元に戻す", exact: true }).click();
  await expect(note).toHaveValue("入力中でも保存するメモ");
});
test("2000文字超の編集中は追加や選択でドラフトを失わず、右クリック操作が使える", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "新しいマップを作成" }).click();
  const input = page.getByRole("textbox", { name: "トピック本文" });
  await input.fill("入力保護");
  await input.press("Enter");
  await page.keyboard.press("Tab");
  await input.fill("あ".repeat(2001));
  await page
    .getByRole("button", { name: "子トピックを追加", exact: true })
    .first()
    .click();
  await expect(input).toHaveValue("あ".repeat(2001));
  await expect(page.locator(".topic")).toHaveCount(2);
  await expect(page.getByRole("alert")).toContainText("2000文字");
  await page.locator(".root-topic").click();
  await expect(input).toHaveValue("あ".repeat(2001));
  await input.fill("有効な枝");
  await input.press("Enter");
  await page
    .locator(".topic")
    .filter({ hasText: /^有効な枝/ })
    .click({ button: "right" });
  await expect(
    page.getByRole("menu", { name: "トピックの操作" }),
  ).toBeVisible();
  await page
    .getByRole("menuitem", { name: "子トピックを追加", exact: true })
    .click();
  await input.fill("メニューから追加");
  await input.press("Enter");
  await expect(page.locator(".topic")).toHaveCount(3);
});
test("リンク・書式のUndo表示が文書と一致する", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "新しいマップを作成" }).click();
  const input = page.getByRole("textbox", { name: "トピック本文" });
  await input.fill("リンク回帰");
  await input.press("Enter");
  await page
    .getByRole("textbox", { name: "トピックのリンク" })
    .fill("https://example.com");
  await page.getByRole("heading", { name: "書式", exact: true }).click();
  await page.getByRole("button", { name: "元に戻す", exact: true }).click();
  await expect(
    page.getByRole("textbox", { name: "トピックのリンク" }),
  ).toHaveValue("");
  await expect(page.locator(".node-link")).toHaveCount(0);
  await page
    .getByRole("combobox", { name: "文字サイズ", exact: true })
    .selectOption("28");
  await page.getByRole("button", { name: "元に戻す", exact: true }).click();
  await expect(
    page.getByRole("combobox", { name: "文字サイズ", exact: true }),
  ).toHaveValue("22");
});

test("キーボードだけで作成・階層編集・選択移動・JSON出力", async ({ page }) => {
  await page.goto("/");
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press("Tab");
    if (
      await page.evaluate(
        () =>
          document.activeElement?.getAttribute("aria-label") ===
          "新しいマップを作成",
      )
    )
      break;
  }
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("textbox", { name: "トピック本文" }),
  ).toBeFocused();
  await page.keyboard.press("Meta+a");
  await page.keyboard.insertText("キーボード作成");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Tab");
  await page.keyboard.insertText("子の一");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  await page.keyboard.insertText("子の二");
  await page.keyboard.press("Enter");
  await page.keyboard.press("ArrowUp");
  await expect(page.getByRole("textbox", { name: "トピック本文" })).toHaveValue(
    "子の一",
  );
  await page.keyboard.press("ArrowLeft");
  await expect(page.getByRole("textbox", { name: "トピック本文" })).toHaveValue(
    "キーボード作成",
  );
  const downloaded = page.waitForEvent("download");
  await page.keyboard.press("Meta+s");
  expect((await downloaded).suggestedFilename()).toMatch(/\.json$/);
});

test("空の新規確定・中心確定・新規取消を区別する", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "新しいマップを作成" }).click();
  const input = page.getByRole("textbox", { name: "トピック本文" });
  await input.fill("");
  await input.press("Enter");
  await expect(input).toHaveValue("中心トピック");
  await page.keyboard.press("Tab");
  await input.press("Enter");
  await expect(input).toHaveValue("トピック");
  await expect(page.locator(".topic")).toHaveCount(2);
  await page.keyboard.press("Tab");
  await expect(page.locator(".topic")).toHaveCount(3);
  await input.press("Escape");
  await expect(page.locator(".topic")).toHaveCount(2);
  await expect(input).toHaveValue("トピック");
  await expect(page.getByText("保存済み", { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.locator(".topic")).toHaveCount(2);
  await expect(
    page.locator(".node-text").filter({ hasText: /^トピック$/ }),
  ).toHaveCount(1);
});
