# 本机验收记录

本记录补充远端 Claude Code 的 `BUILD_LOG.md`。远端生成时因非交互权限限制，测试没有执行；以下项目均在本机实际运行。

## 环境与命令

- 2026-10-21，macOS，本机 Node.js v24.11.1，Google Chrome。
- 在项目目录运行 `npm test`，实际命令为 `node --test tests/*.test.mjs`：**23 项通过，0 项失败**。
- 使用 Playwright 驱动系统 Chrome，打开本地 `file://` 页面，执行 `node ../verify-browser.cjs`。该脚本位于本次内容包上层目录，没有打包进单文件产品。

## 发现与修正

1. 首次直接运行 `node --test tests/`，Node 24 将目录路径当成不存在的测试模块，未运行测试。已把 `package.json`、README、清单中的测试命令统一改为 `node --test tests/*.test.mjs`。
2. 首次运行指定测试文件，23 项中 22 项通过，1 项失败。失败是 Node `vm` 跨 realm 数组的 `deepStrictEqual` 比较原型差异；测试期望改为比较普通 JSON 数据后，23 项全部通过。此处修正的是测试断言，没有改变产品逻辑。

## 浏览器验收

实际脚本输出：

```json
{"result":"pass","nodes":4,"edges":4,"drag":true,"edgeFollow":true,"undoRedo":true,"localSave":true,"reload":true,"jsonExportImport":true,"pngBytes":108645,"badImportRejected":true,"mobileNoOverflow":true,"errors":[],"requests":[]}
```

其中验证了：示例四节点四连线；拖动后连线跟随；撤销/重做；自动保存及刷新恢复；JSON 导出后导入；PNG 文件可下载且文件大小 108645 字节；错误 JSON 被拒绝；390px 手机视口没有页面横向溢出；浏览器控制台没有错误；没有网络请求。

## 使用边界

- 真实浏览器自动化使用的是 Chrome；其他桌面浏览器尚未逐一验证。
- 手机视口可以打开页面，但首次“适应画布”后，横向四节点示例缩到约 31%，文字偏小。手机端更适合查看或小幅修改；公众号所用竖版导出图是手工重新排列节点得到，并非自动布局功能。
- `localStorage` 按浏览器和文件地址隔离，换设备或清理浏览器数据后不会自动同步；重要内容要导出 JSON。
