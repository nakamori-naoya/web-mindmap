import { expect, test } from "@playwright/test";

test("編集中の改行と長文に入力欄が追従し、取消とUndoで戻る", async ({
  page,
}, testInfo) => {
  await page.goto("/");
  await page.getByRole("button", { name: "新しいマップを作成" }).click();
  const input = page.getByRole("textbox", {
    name: "トピック本文",
    exact: true,
  });
  await input.fill("短い本文");
  await input.press("Enter");
  await input.dblclick();
  const draft = [
    "日本語の一行目",
    "二行目の考え",
    "三行目を見返す",
    "四行目を追加",
    "五行目まで見える",
  ].join("\n");
  await input.fill(draft);
  await expect
    .poll(() =>
      input.evaluate((el) => ({
        client: el.clientHeight,
        scroll: el.scrollHeight,
        rows: (el as HTMLTextAreaElement).rows,
      })),
    )
    .toMatchObject({ rows: 5 });
  expect(
    await input.evaluate((el) => el.scrollHeight <= el.clientHeight + 1),
  ).toBeTruthy();
  await page.screenshot({ path: testInfo.outputPath("multiline-editing.png") });
  await input.press("Escape");
  await expect(input).toHaveValue("短い本文");
  await input.dblclick();
  await input.fill(
    "日本語の長文を入力しながら見渡せることを確認する。".repeat(12),
  );
  expect(
    await input.evaluate(
      (el) => el.clientHeight > 100 && el.scrollHeight <= el.clientHeight + 1,
    ),
  ).toBeTruthy();
  await input.press("Enter");
  await page.getByRole("button", { name: "元に戻す", exact: true }).click();
  await expect(input).toHaveValue("短い本文");
});

test("中心の末尾が選択状態でも一行のまま見える", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "新しいマップを作成" }).click();
  const input = page.getByRole("textbox", {
    name: "トピック本文",
    exact: true,
  });
  await input.fill("操作領域検査");
  await input.press("Enter");
  expect(
    await input.evaluate((el) => el.clientHeight >= el.scrollHeight),
  ).toBeTruthy();
});

test("Spaceを保持してパンしキーリピートしても編集を開始しない", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "新しいマップを作成" }).click();
  const input = page.getByRole("textbox", {
    name: "トピック本文",
    exact: true,
  });
  await input.fill("Spaceパン");
  await input.press("Enter");
  await input.focus();
  await page.keyboard.down("Space");
  const box = (await input.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    box.x + box.width / 2 + 80,
    box.y + box.height / 2 + 30,
    { steps: 8 },
  );
  await page.keyboard.down("Space");
  await page.mouse.up();
  await page.keyboard.up("Space");
  await expect(input).not.toHaveClass(/editing/);
});

test("2000文字の入力中も複数行の入力領域を画面内に収める", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "新しいマップを作成" }).click();
  const input = page.getByRole("textbox", {
    name: "トピック本文",
    exact: true,
  });
  await input.fill("あ".repeat(2000));
  const box = (await input.boundingBox())!;
  const canvas = (await page
    .getByRole("region", { name: "マインドマップキャンバス" })
    .boundingBox())!;
  expect(box.height).toBeGreaterThan(100);
  expect(box.y).toBeGreaterThanOrEqual(canvas.y);
  expect(box.y + box.height).toBeLessThanOrEqual(canvas.y + canvas.height);
  await input.press("Escape");
});

test("追加ボタンは縮小時も32pxを保ち、次の兄弟へ重ならない", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "新しいマップを作成" }).click();
  const input = page.getByRole("textbox", {
    name: "トピック本文",
    exact: true,
  });
  await input.fill("操作領域");
  await input.press("Enter");
  await page
    .getByRole("combobox", { name: "レイアウト", exact: true })
    .selectOption("logic");
  await page.getByRole("region", { name: "マインドマップキャンバス" }).focus();
  await page.keyboard.press("Tab");
  await input.fill("枝一");
  await input.press("Enter");
  await page.keyboard.press("Enter");
  await input.fill("枝二");
  await input.press("Enter");
  await page.getByText("枝一", { exact: true }).click();
  const add = page.locator(".topic.selected .add-sibling");
  const next = page.locator(".topic").filter({ hasText: /^枝二$/ });
  const buttonBox = (await add.boundingBox())!,
    nextBox = (await next.boundingBox())!;
  expect(buttonBox.width).toBeGreaterThanOrEqual(32);
  expect(buttonBox.height).toBeGreaterThanOrEqual(32);
  expect(buttonBox.y + buttonBox.height).toBeLessThan(nextBox.y);
  await page.getByRole("button", { name: "縮小", exact: true }).click();
  await page.getByRole("button", { name: "縮小", exact: true }).click();
  expect((await add.boundingBox())!.width).toBeGreaterThanOrEqual(31.9);
});

test("スマホ幅のアイコンとノード操作領域は44px以上ある", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByRole("button", { name: "新しいマップを作成" }).click();
  const input = page.getByRole("textbox", {
    name: "トピック本文",
    exact: true,
  });
  await input.fill("スマホ操作");
  await input.press("Enter");
  await page.screenshot({ path: testInfo.outputPath("mobile-controls.png") });
  for (const locator of [
    page.getByRole("button", { name: "マップ内検索", exact: true }),
    page.getByRole("button", { name: "縮小", exact: true }),
    page.locator(".topic.selected .add-child"),
  ]) {
    const box = (await locator.boundingBox())!;
    expect(box.width).toBeGreaterThanOrEqual(43.9);
    expect(box.height).toBeGreaterThanOrEqual(43.9);
  }
});

test("アウトラインから追加しながら複数行をその場で編集できる", async ({
  page,
}, testInfo) => {
  await page.goto("/");
  await page.getByRole("button", { name: "新しいマップを作成" }).click();
  const canvasInput = page.getByRole("textbox", {
    name: "トピック本文",
    exact: true,
  });
  await canvasInput.fill("考えを整理する");
  await canvasInput.press("Enter");
  await page
    .getByRole("button", { name: "☷ アウトライン", exact: true })
    .click();
  await page
    .getByRole("treeitem", { name: "考えを整理する", exact: true })
    .click();
  await page.getByRole("button", { name: "＋ 子を追加", exact: true }).click();
  const outlineInput = page.getByRole("textbox", {
    name: "アウトラインのトピック本文",
    exact: true,
  });
  await expect(outlineInput).toBeFocused();
  await outlineInput.fill("その場で枝を追加\n複数行の考えも入力できる");
  expect(
    await outlineInput.evaluate((el) => el.clientHeight > 44),
  ).toBeTruthy();
  await page.screenshot({ path: testInfo.outputPath("outline-editing.png") });
  await outlineInput.press("Enter");
  await expect(
    page.getByRole("treeitem", {
      name: "その場で枝を追加 複数行の考えも入力できる",
      exact: true,
    }),
  ).toBeVisible();
});

test("枝色パレットは正方形の操作領域を保ってパネル幅へ折り返す", async ({
  page,
}, testInfo) => {
  await page.goto("/");
  await page.getByRole("button", { name: "新しいマップを作成" }).click();
  const input = page.getByRole("textbox", {
    name: "トピック本文",
    exact: true,
  });
  await input.fill("枝色の操作領域");
  await input.press("Enter");
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 844 });
    if (!(await page.locator(".inspector").isVisible())) {
      await page
        .getByRole("button", { name: "書式パネルを切り替え", exact: true })
        .click();
    }
    const panel = page.locator(".inspector");
    expect(
      await panel.evaluate((el) => el.scrollWidth <= el.clientWidth),
    ).toBeTruthy();
    const panelBox = (await panel.boundingBox())!;
    for (const control of await page
      .locator(".color-swatches button, .color-swatches input")
      .all()) {
      const box = (await control.boundingBox())!;
      expect(box.width).toBeGreaterThanOrEqual(width === 390 ? 44 : 32);
      expect(box.height).toBeGreaterThanOrEqual(width === 390 ? 44 : 32);
      expect(Math.abs(box.width - box.height)).toBeLessThan(1);
      expect(box.x).toBeGreaterThanOrEqual(panelBox.x);
      expect(box.x + box.width).toBeLessThanOrEqual(
        Math.min(width, panelBox.x + panelBox.width),
      );
    }
    await page.screenshot({
      path: testInfo.outputPath(`color-palette-${width}.png`),
    });
  }
});
