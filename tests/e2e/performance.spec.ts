import { resolve } from "node:path";
import { test, expect } from "@playwright/test";
import { writeFileSync } from "node:fs";
import { createDocument } from "../../src/domain";
function fixture(count: number) {
  const doc = createDocument(`性能試験 ${count}ノード`);
  const ids = [
    doc.rootId,
    ...Array.from({ length: count - 1 }, () => crypto.randomUUID()),
  ];
  for (let index = 1; index < count; index++) {
    const parentId =
      index <= Math.ceil((count - 1) / 10)
        ? doc.rootId
        : ids[index - Math.ceil((count - 1) / 10)];
    doc.nodes[ids[index]] = {
      id: ids[index],
      parentId,
      childIds: [],
      text: `${index} 日本語を含む平均約四十文字のトピック本文で表示と配置の速さを測定する`,
      note: "",
      ...(parentId === doc.rootId
        ? { side: index % 2 ? ("right" as const) : ("left" as const) }
        : {}),
    };
    doc.nodes[parentId].childIds.push(ids[index]);
  }
  doc.viewState.camera = { x: 570, y: 430, zoom: 1 };
  return doc;
}
const percentile = (values: number[]) =>
  [...values].sort((a, b) => a - b)[Math.ceil(values.length * 0.95) - 1];
test("1000ノード実ブラウザ計測と5000ノード保存・表示", async ({
  page,
  browser,
}) => {
  test.setTimeout(90000);
  const origin = test.info().project.use.baseURL as string;
  const doc = fixture(1000);
  const response = await page.request.post("/api/maps", {
    data: doc,
    headers: { Origin: origin },
  });
  expect(response.ok()).toBeTruthy();
  const start = performance.now();
  await page.goto(`/#map=${doc.documentId}`);
  await expect(page.locator(".root-topic")).toBeVisible();
  const displayMs = performance.now() - start;
  const editMs: number[] = [];
  for (let iteration = 0; iteration < 20; iteration++) {
    if (iteration > 0) {
      const side = await page.locator(".topic.selected").getAttribute("data-side");
      await page.getByRole("region", { name: "マインドマップキャンバス" }).press(side === "left" ? "ArrowRight" : "ArrowLeft");
      await page.getByRole("button", { name: "選択へ移動", exact: true }).click();
    }
    await page.locator(".root-topic").click();
    editMs.push(
      await page.evaluate(async () => {
        const start = performance.now();
        (
          document.querySelector(
            '.toolbar button[aria-label="子トピックを追加"]',
          ) as HTMLButtonElement
        ).click();
        await new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        );
        return performance.now() - start;
      }),
    );
    await page
      .getByRole("textbox", { name: "トピック本文" })
      .fill(`追加試験${iteration}`);
    await page.getByRole("textbox", { name: "トピック本文" }).press("Enter");
  }
  const frameWindow = async (drag: boolean) => {
    await page.evaluate(() => {
      const target = window as typeof window & {
        frameSamples: number[];
        frameSampling: boolean;
      };
      target.frameSamples = [];
      target.frameSampling = true;
      let last = performance.now();
      const tick = (time: number) => {
        if (!target.frameSampling) return;
        target.frameSamples.push(time - last);
        last = time;
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    const canvas = page.getByRole("region", { name: "マインドマップキャンバス" });
    let target = canvas;
    if (drag) {
      const nodeId = await page.locator(".topic:not(.root-topic)").evaluateAll(nodes => {
        const canvas = document.querySelector('[aria-label="マインドマップキャンバス"]')!.getBoundingClientRect();
        return nodes.find(node => {
          const box = node.getBoundingClientRect();
          return box.left >= canvas.left + 8 && box.right <= canvas.right - 8 && box.top >= canvas.top + 8 && box.bottom <= canvas.bottom - 8;
        })?.getAttribute("data-node-id");
      });
      expect(nodeId, "ドラッグ対象がキャンバス内に表示されている").toBeTruthy();
      target = page.locator(`[data-node-id="${nodeId}"]`);
    }
    const box = await target.boundingBox();
    const x = box!.x + (drag ? box!.width / 2 : 10),
      y = box!.y + (drag ? box!.height / 2 : 10);
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + 140, y + 70, { steps: 60 });
    await page.mouse.up();
    return page.evaluate(() => {
      const target = window as typeof window & {
        frameSamples: number[];
        frameSampling: boolean;
      };
      target.frameSampling = false;
      return target.frameSamples.slice(1);
    });
  };
  const frames = await frameWindow(false);
  const dragFrames = await frameWindow(true);
  await expect(page.getByText("保存済み", { exact: true })).toBeVisible();
  const stress = fixture(5000);
  expect(
    (
      await page.request.post("/api/maps", {
        data: stress,
        headers: { Origin: origin },
      })
    ).ok(),
  ).toBeTruthy();
  await page.goto(`/#map=${stress.documentId}`);
  await expect(page.locator(".root-topic")).toBeVisible();
  await expect(page.getByText("5000 トピック", { exact: true })).toBeVisible();
  const record = {
    date: new Date().toISOString(),
    browser: browser.version(),
    mode: "headless Chrome、1440×1000、ローカルVite開発サーバー、Node26",
    nodes: 1000,
    depth: 10,
    displayMs,
    addLayoutTwoFramesP95Ms: percentile(editMs),
    panFrameP95Ms: percentile(frames),
    dragFrameP95Ms: percentile(dragFrames),
    editSamples: editMs.length,
    editNavigation: "各追加後、内向き矢印で親を選び「選択へ移動」で中心へ戻る。追加計測の時間にはこの移動を含めない。",
    frameSamples: frames.length,
    dragFrameSamples: dragFrames.length,
    stress5000: "保存API成功、5000トピック表示成功",
    limitations:
      "表示時間はPlaywright待機を含む。追加は二回のrequestAnimationFrameまで。パン/ドラッグはPlaywright mouse入力とrequestAnimationFrame間隔。物理IME・Windows/Edge・Chrome前版は未測定。",
  };
  writeFileSync(
    resolve(process.cwd(), "docs/browser-performance.json"),
    JSON.stringify(record, null, 2),
  );
  console.log(JSON.stringify(record));
});
