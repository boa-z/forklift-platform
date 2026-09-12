// 开发用 UI 构建：用本地 PocketJS 检出把 forklift UI 编译成 guest bundle。
//
// 产品代码不写入 PocketJS 仓库；这里通过 POCKETJS_ROOT 引用检出目录，
// 内联目标 profile（与 PocketJS 仓库里的 d211-linux-dev 保持一致）。
//
//   POCKETJS_ROOT=../pocketjs bun tools/ui-build-dev.ts
//
// 产物：dist/ui/forklift-main.js + forklift-main.pak

import { existsSync, mkdirSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const pocketjs = (process.env.POCKETJS_ROOT ?? "").trim();
if (pocketjs === "") {
  console.error("ui-build-dev: 请设置 POCKETJS_ROOT 指向 PocketJS 检出目录");
  console.error("  POCKETJS_ROOT=../pocketjs bun tools/ui-build-dev.ts（在 forklift-platform 根目录执行）");
  process.exit(1);
}

/** 打印错误并退出。 */
function fail(message: string): never {
  console.error(`ui-build-dev: ${message}`);
  process.exit(1);
}

// --- 预检 PocketJS 检出：必须是完整且已安装依赖的 checkout ------------------
const pocketPackagePath = join(pocketjs, "package.json");
if (!existsSync(pocketPackagePath)) {
  fail(`POCKETJS_ROOT 不是 PocketJS 检出（缺少 ${pocketPackagePath}）`);
}
const pocketPackage = JSON.parse(readFileSync(pocketPackagePath, "utf8")) as { name?: string };
if (pocketPackage.name !== "@pocketjs/framework") {
  fail(`POCKETJS_ROOT 指向的不是 PocketJS 仓库（package.json name=${pocketPackage.name ?? "?"}）`);
}
for (const required of [
  "tools/build.ts",
  "framework/compiler/jsx-plugin.ts",
  "framework/compiler/subpaths.ts",
  "node_modules/solid-js/dist/solid.js",
]) {
  if (!existsSync(join(pocketjs, required))) {
    fail(
      `PocketJS 检出缺少 ${required}；请在 ${pocketjs} 执行 bun install 后重试`,
    );
  }
}

// --- 让 @pocketjs/framework/* 在应用侧始终可解析 ----------------------------
// PocketJS 编译器插件会做别名；这里同时建立包链接作为兜底，避免不同 Bun
// 版本的插件行为差异导致 “Could not resolve: @pocketjs/framework/...”。
const scopeDir = join(root, "node_modules/@pocketjs");
mkdirSync(scopeDir, { recursive: true });
const frameworkLink = join(scopeDir, "framework");
if (existsSync(frameworkLink)) {
  const existing = realpathSync(frameworkLink);
  if (existing !== realpathSync(pocketjs)) {
    fail(
      `${frameworkLink} 指向 ${existing}，与 POCKETJS_ROOT=${pocketjs} 不一致；` +
        "请移除该链接后重试（本工具会自动重建）",
    );
  }
} else {
  symlinkSync(realpathSync(pocketjs), frameworkLink, "dir");
  console.log(`ui-build-dev: 建立链接 node_modules/@pocketjs/framework -> ${pocketjs}`);
}

const outdir = process.env.FORKLIFT_UI_OUTDIR ?? join(root, "dist/ui");
const planPath = join(root, ".pocket/d211-linux-dev/plan.json");
const manifestPath = join(root, "ui/pocket.json");
if (!existsSync(manifestPath)) {
  fail(`缺少应用清单 ${manifestPath}`);
}
if (!existsSync(join(root, "ui/main.tsx"))) {
  fail(`缺少应用入口 ${join(root, "ui/main.tsx")}`);
}

// 素材烘焙产物不入库；缺失时自动重跑烘焙（需要 POCKETJS_ROOT 的 PNG 解码器）。
const generatedAssets = join(root, "ui/src/screens/main/assets.gen.ts");
if (!existsSync(generatedAssets)) {
  console.log("ui-build-dev: 烘焙 UI 素材");
  const bake = Bun.spawnSync({
    cmd: ["bun", join(root, "tools/bake-ui-assets.ts")],
    cwd: root,
    env: process.env,
    stdout: "inherit",
    stderr: "inherit",
  });
  if (bake.exitCode !== 0) {
    fail(`素材烘焙失败（${bake.exitCode}）`);
  }
}

// 记录 PocketJS 提交，便于构建回执追溯。
const pocketCommit = Bun.spawnSync({
  cmd: ["git", "-C", pocketjs, "rev-parse", "--short", "HEAD"],
  stdout: "pipe",
  stderr: "ignore",
});
console.log(
  `ui-build-dev: PocketJS ${pocketCommit.stdout.toString().trim() || "?"} @ ${pocketjs}`,
);

// 动态导入 PocketJS 的类型/解析器（仅构建期使用）。
const platforms = await import(join(pocketjs, "contracts/spec/platforms.ts"));
const resolve = await import(join(pocketjs, "framework/src/manifest/resolve.ts"));
const hostInputs = await import(join(pocketjs, "framework/src/manifest/host-build-inputs.ts"));

const TARGET_ID = "d211-linux-dev";
const contracts = platforms.definePlatformContractRegistry(
  platforms.POCKET_CAPABILITIES,
  platforms.defineTargetRegistry({
    [TARGET_ID]: {
      hostAbi: 11,
      platform: "linux",
      form: "takeover",
      display: {
        physicalViewport: [800, 480],
        logicalViewports: [[800, 480]],
        presentations: ["native"],
        rasterDensity: 1,
      },
      capabilities: ["input.touch", "text.glyphs.baked"],
    },
  }),
);

const manifest = JSON.parse(await Bun.file(manifestPath).text());
const resolution = resolve.validateAndResolveBuildPlan(manifest, { target: TARGET_ID }, contracts);
if (!resolution.ok) {
  console.error("ui-build-dev: manifest 解析失败");
  for (const diagnostic of resolution.diagnostics) {
    console.error(`  ${diagnostic.path || "/"}: ${diagnostic.message}`);
  }
  process.exit(1);
}

const inputs = hostInputs.extractHostBuildInputs(resolution.plan, { expectedTarget: TARGET_ID });
mkdirSync(join(root, ".pocket/d211-linux-dev"), { recursive: true });
writeFileSync(planPath, `${JSON.stringify(resolution.plan, null, 2)}\n`);
mkdirSync(outdir, { recursive: true });

console.log(
  `ui-build-dev: target=${inputs.target} viewport=${inputs.viewport.logical.join("x")} density=${inputs.viewport.rasterDensity}`,
);

const build = Bun.spawnSync({
  cmd: [
    "bun",
    join(pocketjs, "tools/build.ts"),
    `--plan=${planPath}`,
    `--project-root=${root}`,
    `--outdir=${outdir}`,
  ],
  cwd: pocketjs,
  stdout: "inherit",
  stderr: "inherit",
});
if (build.exitCode !== 0) {
  console.error(`ui-build-dev: tools/build.ts 失败（${build.exitCode}）`);
  process.exit(build.exitCode ?? 1);
}

const bundle = join(outdir, `${inputs.appOutput}.js`);
const pack = join(outdir, `${inputs.appOutput}.pak`);
if (!(await Bun.file(bundle).exists()) || !(await Bun.file(pack).exists())) {
  console.error(`ui-build-dev: 缺少产物 ${bundle} 或 ${pack}`);
  process.exit(1);
}
console.log(`ui-build-dev: 产物 ${bundle}`);
console.log(`ui-build-dev: 产物 ${pack}`);
