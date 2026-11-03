# Asurada 工程落地图帧

由真实 React 壳（`pnpm dev:web` + `?capture=` 场景驱动）经 Playwright 截取，非设计 HTML mockup。

| 文件 | 场景 |
|---|---|
| `intro-1.png` | 引导第 1 步 |
| `intro-2.png` | 引导第 2 步 |
| `intro-3.png` | 引导第 3 步 |
| `precheck.png` | 预检进行中 |
| `precheck-fail.png` | 预检失败 |
| `list.png` | 有项目列表（风险条 / 主按钮 / logo） |
| `empty.png` | 空列表 |
| `running.png` | 单行提交中 |
| `result.png` | 成功 Toast + 行内已推送 / 失败态 |

重新生成：

```bash
pnpm dev:web
node scripts/capture-artifacts.mjs
```

场景定义见 `src/captureMode.ts`（仅 `import.meta.env.DEV`）。
