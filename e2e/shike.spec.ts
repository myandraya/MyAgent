import { expect, test } from "@playwright/test";

test("一句话入口调用 AI 选景并提供真实 SVG", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /说一句那座城/ }).click();
  await page.getByTestId("scene-memory").fill("我想念悉尼海港边的歌剧院");
  await page.getByRole("button", { name: "重新构图" }).click();
  await expect(page.getByText(/离线参数化|AI 图像生成/)).toBeVisible();
  const pending=page.waitForEvent("download");
  await page.getByRole("button", { name: "下载剪影 SVG" }).click();
  const filename = (await pending).suggestedFilename();
  expect(filename).toMatch(/shike-.+-silhouette\.svg/);
});

test("照片入口在浏览器本地生成半调且不发图片请求", async ({ page }) => {
  const requests:string[]=[];
  page.on("request",request=>requests.push(request.url()));
  await page.goto("/");
  await page.getByRole("button", { name: /刻下一张照片/ }).click();
  const pngBase64=await page.evaluate(()=>{const canvas=document.createElement("canvas");canvas.width=32;canvas.height=24;const context=canvas.getContext("2d")!;context.fillStyle="#111";context.fillRect(0,0,16,24);context.fillStyle="#ddd";context.fillRect(16,0,16,24);return canvas.toDataURL("image/png").split(",")[1];});
  const blackPng=Buffer.from(pngBase64,"base64");
  await page.getByTestId("photo-input").setInputFiles({name:"memory.png",mimeType:"image/png",buffer:blackPng});
  await expect(page.getByText(/个真实矢量半调点/)).toBeVisible({timeout:10_000});
  await expect(page.getByText(/4 项照片 DFM 检查通过/)).toBeVisible();
  expect(requests.filter(url=>url.includes("memory.png")||url.includes("api")&&url.includes("photo"))).toHaveLength(0);
});

test("移动端首页与一句话主入口无水平溢出", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name!=="mobile-chrome","仅移动项目执行");
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /我把第二故乡/ })).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  await page.getByRole("button", { name: /说一句那座城/ }).click();
  await expect(page.getByTestId("scene-memory")).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
});


test("首页普通点击和滚动都不跳转",async({page},testInfo)=>{
  test.skip(testInfo.project.name!=="desktop-chrome","仅桌面项目执行");
  await page.goto("/");
  const heading=page.getByRole("heading",{name:/我把第二故乡/});
  await heading.click();
  await expect(heading).toBeVisible();
  await expect(page.getByText("MEMORY 1 / 5")).toBeHidden();
  const canvas=page.getByLabel("可交互缓慢旋转星穹");
  await expect(canvas).toBeVisible();
  await canvas.hover({position:{x:40,y:40}});
  await page.mouse.wheel(0,120);
  await expect(page.getByText("MEMORY 1 / 5")).toBeHidden();
});
