import { test, expect } from "@playwright/test";

/** 等待应用完成启动引导（内置展览安装 + 运行时构建） */
async function waitBoot(page: import("@playwright/test").Page) {
  await page.goto("/");
  await expect(
    page.locator(".exhibition-intro h1").first(),
  ).toHaveText("万物之间", { timeout: 20000 });
}

test("完整交换流程：收藏 → 导入预览 → 确认切换 → 身份迁移 → 刷新后状态一致", async ({
  page,
}) => {
  await waitBoot(page);

  // 在旧展收藏两件作品：a1（内容将被新展共享）与 a2（同名不同内容）
  await expect(page.locator(".detail h2")).toHaveText("山的另一种记忆");
  await page.getByLabel("收藏作品").click();
  await page.locator(".art-row", { hasText: "无声的潮汐" }).click();
  // 行走途中详情面板会随邻近作品切换，等待停在目标作品
  await expect(page.locator(".detail h2")).toHaveText("无声的潮汐", {
    timeout: 20000,
  });
  await page.getByLabel("收藏作品").click();
  await expect(page.getByRole("button", { name: /我的收藏/ })).toContainText("2");

  // 进入交换面板，导入示例包 B
  await page.getByRole("button", { name: "展览交换" }).click();
  await page.getByRole("button", { name: "示例包 · 潮汐之间" }).click();

  // 预览报告：容量 / 资源完整性 / 路线引用 / 空间冲突 / 讲解 / 身份迁移
  const dialog = page.getByRole("dialog", { name: "导入预览" });
  await expect(dialog).toBeVisible({ timeout: 30000 });
  await expect(dialog.getByText("容量")).toBeVisible();
  await expect(dialog.getByText("资源完整性")).toBeVisible();
  await expect(dialog.getByText("路线引用")).toBeVisible();
  await expect(dialog.getByText("空间冲突")).toBeVisible();
  await expect(dialog.getByText("讲解资源")).toBeVisible();
  await expect(dialog.getByText("收藏与参观记录迁移")).toBeVisible();
  // 身份预览：1 件迁移（山的另一种记忆，内容相同），1 件归档（无声的潮汐，同名不同内容）
  await expect(
    dialog.getByText(/按内容身份匹配：\s*1\s*件收藏/),
  ).toBeVisible();
  await expect(
    dialog.getByText(/1 件收藏、\d+ 条记录无法匹配/),
  ).toBeVisible();

  // 确认前旧展仍是当前展览
  await expect(page.locator(".exhibition-intro h1")).toHaveText("万物之间");

  await dialog.getByRole("button", { name: "确认切换到这个展览" }).click();
  await expect(page.locator(".exhibition-intro h1")).toHaveText("潮汐之间", {
    timeout: 20000,
  });

  // 收藏面板：内容相同的迁移到当前展览；同名不同内容的进入归档区
  await page.getByRole("button", { name: /我的收藏/ }).click();
  await expect(page.locator(".saved-card", { hasText: "山的另一种记忆" })).toBeVisible();
  await expect(page.getByText("来自其他展览 · 已妥善保留")).toBeVisible();
  await expect(
    page.locator(".archived-section .saved-card", { hasText: "无声的潮汐" }),
  ).toBeVisible();

  // 重新打开页面：新展保持，收藏指向不变，无新旧混搭
  await page.reload();
  await expect(page.locator(".exhibition-intro h1")).toHaveText("潮汐之间", {
    timeout: 20000,
  });
  await page.getByRole("button", { name: /我的收藏/ }).click();
  await expect(page.locator(".saved-card", { hasText: "山的另一种记忆" })).toBeVisible();
  await expect(page.getByText("来自其他展览 · 已妥善保留")).toBeVisible();
});

test("损坏讲解的包：预览显示降级警告，仍可导入，导入后讲解不可用态可见", async ({
  page,
}) => {
  await waitBoot(page);
  await page.getByRole("button", { name: "展览交换" }).click();
  await page.getByRole("button", { name: "示例包 · 损坏讲解" }).click();
  const dialog = page.getByRole("dialog", { name: "导入预览" });
  await expect(dialog).toBeVisible({ timeout: 30000 });
  await expect(dialog.getByText("讲解资源")).toBeVisible();
  await expect(dialog.locator(".warn").first()).toBeVisible();
  // 只有警告，可以确认
  await dialog.getByRole("button", { name: "确认切换到这个展览" }).click();
  await expect(page.locator(".exhibition-intro h1")).toHaveText("潮汐之间", {
    timeout: 20000,
  });
  // b3 港口的清晨 讲解文本为空 → 详情页显示讲解暂不可用
  await page.getByRole("button", { name: "探索展馆" }).click();
  await page.locator(".art-row", { hasText: "港口的清晨" }).click();
  await expect(page.locator(".detail h2")).toHaveText("港口的清晨", {
    timeout: 20000,
  });
  await expect(page.getByRole("button", { name: /讲解暂不可用/ })).toBeVisible();
});

test("超出容量的包：预检失败并报告缺口，当前展览不受影响", async ({ page }) => {
  await waitBoot(page);
  await page.getByRole("button", { name: "展览交换" }).click();
  await page.getByRole("button", { name: "示例包 · 超出容量" }).click();
  const dialog = page.getByRole("dialog", { name: "导入预览" });
  await expect(dialog).toBeVisible({ timeout: 60000 });
  await expect(dialog.getByText("导入未通过")).toBeVisible();
  await expect(dialog).toContainText("容量不足");
  await dialog.getByRole("button", { name: /返回/ }).click();
  await expect(page.locator(".exhibition-intro h1")).toHaveText("万物之间");
});

test("预览阶段取消：暂存清理，当前展览完整可参观", async ({ page }) => {
  await waitBoot(page);
  await page.getByRole("button", { name: "展览交换" }).click();
  await page.getByRole("button", { name: "示例包 · 潮汐之间" }).click();
  const dialog = page.getByRole("dialog", { name: "导入预览" });
  await expect(dialog).toBeVisible({ timeout: 30000 });
  await dialog.getByRole("button", { name: "取消，继续参观当前展览" }).click();
  await expect(page.locator(".exhibition-intro h1")).toHaveText("万物之间");
  // 事件日志记录了取消
  await expect(page.locator(".event-log")).toContainText("取消");
});

test("导出当前展览得到策展包文件", async ({ page }) => {
  await waitBoot(page);
  await page.getByRole("button", { name: "展览交换" }).click();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: /导出「万物之间」策展包/ }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toContain(".yujingpack.json");
});

test("导出后可再次导入同一策展包（往返交换）", async ({ page }) => {
  await waitBoot(page);
  await page.getByRole("button", { name: "展览交换" }).click();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: /导出「万物之间」策展包/ }).click();
  const path = await (await downloadPromise).path();
  // 把刚导出的包重新导入：同一展览 id，应为正常刷新而非混搭
  await page.locator('input[type="file"]').setInputFiles(path!);
  const dialog = page.getByRole("dialog", { name: "导入预览" });
  await expect(dialog).toBeVisible({ timeout: 30000 });
  await dialog.getByRole("button", { name: "确认切换到这个展览" }).click();
  await expect(page.locator(".exhibition-intro h1")).toHaveText("万物之间", {
    timeout: 20000,
  });
  // 刷新后依然一致
  await page.reload();
  await expect(page.locator(".exhibition-intro h1")).toHaveText("万物之间", {
    timeout: 20000,
  });
});
