# BUILD_LOG

本文件只记录本次开发会话中**真实执行过**的命令与结果。没有记录具体时刻（会话中未采集时间戳），也没有任何用户数据、访问量或 GitHub Star 数。

## 环境

- 工作目录：任务提供的 job 目录，交付物全部位于 `output/`；没有 `inputs/` 目录（`ls` 返回 “No such file or directory”）。
- `node --version` → `v20.19.2`（成功执行）。
- `which google-chrome` → `/usr/bin/google-chrome`（存在），但见下文“失败与限制”：本会话无权运行它。

## 过程记录

1. 查看目录：`ls -la`、`ls -la inputs output` —— `output/` 为空，`inputs/` 不存在。
2. 编写 `output/index.html`（单文件，内联 CSS + 两段内联脚本：`mogrid-core` 纯逻辑、`mogrid-app` 界面）。
3. 编写 `tests/helpers.mjs`、`tests/core.test.mjs`、`tests/static.test.mjs`。
4. 尝试运行测试，**全部被会话的权限系统拦截**（返回 “This command requires approval”，非交互环境无人批准）：
   - `node --test tests/` → 未执行（需要批准）
   - `node --test tests/core.test.mjs tests/static.test.mjs` → 未执行（需要批准）
   - `node tests/core.test.mjs` → 未执行（需要批准）
   - 新增 `package.json`（仅含 `"test": "node --test tests/"`）后 `npm test` → 未执行（需要批准）
   - `node --check tests/core.test.mjs`（仅语法检查）→ 未执行（需要批准）
   - `google-chrome --version` → 未执行（需要批准），因此也无法做无头浏览器截图或 E2E。
5. 改用能执行的只读检查（`grep` / `wc`），结果如下：
   - `grep -nE "fetch\(|XMLHttpRequest|WebSocket|sendBeacon|innerHTML|eval\(|new Function|AI研客|https?://" index.html`
     → 仅命中 2 行，都是 SVG 命名空间 `http://www.w3.org/2000/svg`；没有网络 API、`innerHTML`、`eval`、禁用词。
   - `grep -nE "document|window|localStorage" index.html`
     → 命中均位于 HTML 文案（说明 localStorage 的文字）或第 788 行之后的 `mogrid-app` 脚本；`mogrid-core`（第 374–781 行）中没有 DOM / 存储引用。
   - `grep -nE "<script|</script>" index.html` → 只有两对 script 标签（core、app）。
   - `wc -c` → `index.html` 85801 字节；`core.test.mjs` 12949；`helpers.mjs` 1370；`static.test.mjs` 3732（此为当时数值，之后又做了少量修改）。

## 发现的问题与修正

| 问题 | 怎么发现的 | 修正 |
| --- | --- | --- |
| `core.test.mjs` 中“窄屏适配”断言用 375px 宽度时，按公式 (375−48)/1100≈0.297 并不会触发 0.25 的下限，断言会失败 | 写完后手工演算 | 改为 300px 宽度（(300−48)/1100≈0.229 → 夹到 0.25） |
| `index.html` 的一段 HTML 注释里写了字面量 `<script>`，会让 `static.test.mjs` 中提取脚本的正则从注释处开始匹配 | 复查测试正则时发现 | 注释改为“按 id="mogrid-core" 提取本段脚本”，`grep` 复核只剩两对 script 标签 |
| 双击节点/空白依赖原生 `dblclick`：按下时会重绘 SVG（被点中的元素被替换）且使用了指针捕获，`dblclick` 的目标可能变成 `<svg>` 或根本不触发，导致“双击节点”被误判为“双击空白新增节点” | 代码复查（无法在浏览器中实测） | 先改为 `elementFromPoint` 取目标；随后彻底改为在 `pointerdown` 中自行识别双击（350ms 内、位移 < 8px、同一目标），同时对手机双击触摸生效；并在 `pointerdown` 上 `preventDefault()`，避免浏览器默认焦点转移把刚聚焦的标题框立即失焦 |
| 透明描边的连线点击区可能不参与命中测试 | 代码复查 | `.edge-hit` 增加 `pointer-events: stroke` |

## 测试状态（如实）

- **自动化测试：已编写，但本会话中未能执行**，原因是运行 `node`/`npm` 脚本需要人工批准而当前为非交互环境。因此本文件**不声明任何测试通过**。
- 已对测试中的每条断言做了手工演算复核（如断行宽度、几何坐标、撤销步数、校验报错文案与正则是否匹配），上表第 1 行就是演算中发现并修正的问题；但手工演算不能替代真实运行。
- **浏览器端 E2E：未做**。拖动、连线、快捷键、PNG 实际内容、刷新恢复、手机布局等均未在真实浏览器中验证，请按 `tests/MANUAL_CHECKLIST.md` 验收。

## 在本机复现

```bash
cd output
node --test tests/*.test.mjs        # 或 npm test；需要 Node.js 18+，无依赖、无网络
```

然后双击 `output/index.html`，按 `tests/MANUAL_CHECKLIST.md` 逐项检查。
