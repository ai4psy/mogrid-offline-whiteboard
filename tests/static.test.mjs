// 对 index.html 做静态检查：离线、无外部请求、无追踪、无危险 API、结构完整。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { statSync } from 'node:fs';
import { html, HTML_PATH, extractScript } from './helpers.mjs';

const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)];
const allJs = scripts.map((m) => m[2]).join('\n');

test('单文件：所有脚本内联，没有外部 src / href 资源', () => {
  assert.ok(scripts.length >= 2);
  for (const m of scripts) assert.doesNotMatch(m[1], /\bsrc\s*=/, '不允许 <script src>');
  assert.doesNotMatch(html, /<link\b[^>]*rel=["']?stylesheet/i);
  assert.doesNotMatch(html, /<(?:img|iframe|audio|video|source|embed|object)\b[^>]*\bsrc\s*=\s*["']?(?:https?:)?\/\//i);
  assert.doesNotMatch(html, /@import|url\(\s*["']?(?:https?:)?\/\//i);
  assert.doesNotMatch(html, /\bsrc\s*=\s*["']https?:/i);
});

test('不发起网络请求、不含追踪代码', () => {
  const banned = [
    /\bfetch\s*\(/, /XMLHttpRequest/, /\bWebSocket\b/, /\bEventSource\b/, /sendBeacon/, /\bimport\s*\(/,
    /navigator\.serviceWorker/, /google-analytics|googletagmanager|gtag\(|hm\.baidu|umami|plausible|matomo|sentry|mixpanel|segment\.io/i
  ];
  for (const re of banned) assert.doesNotMatch(allJs, re, '发现被禁止的用法：' + re);
  // 唯一允许出现的 http(s) 字样是 SVG 命名空间
  const urls = (html.match(/https?:\/\/[^\s"'<>)]+/g) || []).filter((u) => u !== 'http://www.w3.org/2000/svg');
  assert.deepEqual(urls, [], '页面中出现了外部 URL：' + urls.join(', '));
});

test('内容安全策略禁止联网', () => {
  const csp = html.match(/<meta http-equiv="Content-Security-Policy" content="([^"]+)"/);
  assert.ok(csp, '缺少 CSP');
  assert.match(csp[1], /default-src 'none'/);
  assert.match(csp[1], /connect-src 'none'/);
  assert.doesNotMatch(csp[1], /https?:/);
});

test('不使用会执行字符串的危险 API', () => {
  for (const re of [/\beval\s*\(/, /new\s+Function\s*\(/, /\.innerHTML\s*=/, /\.outerHTML\s*=/, /insertAdjacentHTML/, /document\.write/, /setTimeout\s*\(\s*['"]/]) {
    assert.doesNotMatch(allJs, re, '发现危险用法：' + re);
  }
});

test('核心逻辑与界面分离，界面通过 textContent 写入用户文本', () => {
  const core = extractScript('mogrid-core');
  assert.doesNotMatch(core, /\bdocument\b|\bwindow\b|localStorage/, '核心逻辑不应依赖 DOM');
  const app = extractScript('mogrid-app');
  assert.match(app, /textContent = it\.text/);
  assert.match(app, /localStorage\.setItem\(STORE_KEY/);
});

test('品牌与文案：使用自有产品名，不出现禁用词，声明独立实现', () => {
  assert.match(html, /墨格 MoGrid/);
  assert.doesNotMatch(html, /AI研客/);
  assert.match(html, /独立实现/);
  assert.match(html, /不是它的完整复刻/);
  assert.match(html, /仅存本机/);
  assert.match(html, /lang="zh-CN"/);
  assert.match(html, /name="viewport"/);
});

test('必要功能入口齐全', () => {
  const ids = ['btn-undo', 'btn-redo', 'btn-import', 'btn-export-json', 'btn-export-png', 'btn-clear', 'btn-sample',
    'tool-add', 'tool-connect', 'tool-delete', 'node-title', 'node-desc', 'confirm-modal', 'file-input'];
  for (const id of ids) assert.match(html, new RegExp('id="' + id + '"'), '缺少 #' + id);
  const app = extractScript('mogrid-app');
  assert.match(app, /mod && key === 'z'/);
  assert.match(app, /e\.shiftKey\) redo\(\)/);
  assert.match(app, /confirmDialog\('确定清空整个画布？'/);
});

test('文件体积合理（单文件 < 200KB）', () => {
  const size = statSync(HTML_PATH).size;
  assert.ok(size < 200 * 1024, 'index.html 太大：' + size);
});
