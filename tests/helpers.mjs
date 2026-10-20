// 测试辅助：从 index.html 中提取 <script id="mogrid-core"> 并在 Node 的 vm 沙箱里运行。
// 沙箱里没有 window / document / fetch，核心逻辑若依赖它们会直接报错——这本身也是一种检查。
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
export const HTML_PATH = join(here, '..', 'index.html');
export const html = readFileSync(HTML_PATH, 'utf8');

export function extractScript(id) {
  const re = new RegExp('<script id="' + id + '">([\\s\\S]*?)</script>');
  const m = html.match(re);
  if (!m) throw new Error('index.html 中找不到 <script id="' + id + '">');
  return m[1];
}

export function loadCore() {
  const sandbox = { console };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(extractScript('mogrid-core'), sandbox, { filename: 'mogrid-core.js' });
  return sandbox.MoGridCore;
}

// 近似的文字测量：中日韩全角字符按 1em，其余按 0.55em。足以测试换行逻辑。
export function fakeMeasure(text, font) {
  const size = parseFloat(String(font).match(/(\d+(?:\.\d+)?)px/)?.[1] ?? '14');
  let w = 0;
  for (const ch of text) w += /[⺀-鿿＀-￯　-〿]/.test(ch) ? size : size * 0.55;
  return w;
}
