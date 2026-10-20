// 核心数据逻辑测试：node --test tests/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadCore, fakeMeasure } from './helpers.mjs';

const C = loadCore();
// vm 沙箱中创建的对象原型来自另一个 realm，比较前转成普通 JSON 数据
const plain = (x) => JSON.parse(JSON.stringify(x));

test('默认示例场景：手机 → 飞书 → Agent → 云电脑，且不含敏感信息', () => {
  const s = C.defaultScene();
  assert.deepEqual(plain(s.nodes.map((n) => n.title)), ['手机', '飞书', 'Agent', '云电脑']);
  const chain = ['n_phone', 'n_feishu', 'n_agent', 'n_cloudpc'];
  for (let i = 0; i < chain.length - 1; i++) {
    assert.ok(s.edges.some((e) => e.from === chain[i] && e.to === chain[i + 1]), `缺少 ${chain[i]} → ${chain[i + 1]}`);
  }
  const text = JSON.stringify(s);
  assert.doesNotMatch(text, /https?:\/\/|token|password|secret|@[a-z0-9-]+\.|\b(?:10|192\.168|172\.(?:1[6-9]|2\d|3[01]))\.\d+/i);
  // 默认场景本身必须能通过导入校验
  const r = C.validateScene(C.serialize(s));
  assert.equal(r.ok, true);
  assert.equal(r.warnings.length, 0);
});

test('新增 / 删除节点：删除节点会连带删除相关连线', () => {
  const s = C.emptyScene();
  const a = C.addNode(s, { x: 10.4, y: 20.6, title: '  网关  ' }).node;
  const b = C.addNode(s, { x: 300, y: 0 }).node;
  const c = C.addNode(s, { x: 600, y: 0, color: 'not-a-color', w: 99999 }).node;
  assert.equal(a.x, 10); assert.equal(a.y, 21); assert.equal(a.title, '网关');
  assert.equal(b.title, '新节点');
  assert.equal(c.color, 'blue');
  assert.equal(c.w, C.LIMITS.maxW);
  assert.notEqual(a.id, b.id);
  assert.ok(C.addEdge(s, a.id, b.id).ok);
  assert.ok(C.addEdge(s, b.id, c.id).ok);
  const r = C.removeNodes(s, [b.id]);
  assert.deepEqual(plain(r), { nodes: 1, edges: 2 });
  assert.equal(s.nodes.length, 2);
  assert.equal(s.edges.length, 0);
});

test('连线：拒绝自连、重复、悬空；允许反方向；可反转', () => {
  const s = C.emptyScene();
  const a = C.addNode(s, {}).node, b = C.addNode(s, { x: 400 }).node;
  assert.equal(C.addEdge(s, a.id, a.id).ok, false);
  assert.equal(C.addEdge(s, a.id, 'missing').ok, false);
  const e = C.addEdge(s, a.id, b.id, '调用');
  assert.equal(e.ok, true);
  assert.equal(e.edge.label, '调用');
  assert.equal(C.addEdge(s, a.id, b.id).ok, false, '同方向重复连线应被拒绝');
  assert.equal(C.reverseEdge(s, e.edge.id).ok, true);
  assert.equal(s.edges[0].from, b.id);
  assert.equal(C.addEdge(s, a.id, b.id).ok, true, '反方向连线允许存在');
  assert.equal(C.reverseEdge(s, e.edge.id).ok, false, '反转后会与已有连线重复时应拒绝');
  assert.equal(C.removeEdge(s, e.edge.id), true);
  assert.equal(C.removeEdge(s, e.edge.id), false);
});

test('撤销 / 重做：至少 10 步，且新操作会清空重做栈', () => {
  const h = C.createHistory(100);
  let scene = C.emptyScene();
  const snaps = [];
  for (let i = 0; i < 15; i++) {
    const before = JSON.stringify(scene);
    C.addNode(scene, { x: i * 10, title: '节点' + i });
    h.push(before);
    snaps.push(JSON.stringify(scene));
  }
  assert.equal(scene.nodes.length, 15);
  for (let i = 0; i < 12; i++) scene = JSON.parse(h.undo(JSON.stringify(scene)));
  assert.equal(scene.nodes.length, 3, '撤销 12 步后应剩 3 个节点');
  for (let i = 0; i < 11; i++) scene = JSON.parse(h.redo(JSON.stringify(scene)));
  assert.equal(scene.nodes.length, 14, '重做 11 步后应有 14 个节点');
  assert.equal(JSON.stringify(scene), snaps[13]);
  // 新操作后重做栈被清空
  const before = JSON.stringify(scene);
  C.addNode(scene, {});
  h.push(before);
  assert.equal(h.canRedo(), false);
  assert.equal(h.redo(JSON.stringify(scene)), null);
});

test('撤销栈有上限，超出后丢弃最早的记录', () => {
  const h = C.createHistory(10);
  for (let i = 0; i < 25; i++) h.push('s' + i);
  assert.equal(h.size().past, 10);
  let cur = 'now', n = 0;
  while (h.canUndo()) { cur = h.undo(cur); n++; }
  assert.equal(n, 10);
  assert.equal(cur, 's15');
  assert.equal(h.undo(cur), null);
});

test('序列化后再校验可以完整往返', () => {
  const s = C.defaultScene();
  C.addNode(s, { x: -50, y: 300, title: 'RAG 检索', desc: '向量库\n第二行', color: 'amber', w: 260 });
  const r = C.validateScene(C.serialize(s, { exportedAt: '2026-01-01T00:00:00.000Z' }));
  assert.equal(r.ok, true);
  assert.deepEqual(plain(r.scene), plain(s));
});

test('导入校验：拒绝非法 JSON 与错误结构', () => {
  const bad = [
    ['', /为空/],
    ['{not json', /不是合法的 JSON/],
    ['[]', /顶层/],
    ['null', /顶层/],
    [JSON.stringify({ nodes: [] }), /format/],
    [JSON.stringify({ format: 'other', version: 1, nodes: [] }), /format/],
    [JSON.stringify({ format: 'mogrid-scene', version: 99, nodes: [] }), /更新的版本/],
    [JSON.stringify({ format: 'mogrid-scene', version: 1.5, nodes: [] }), /version/],
    [JSON.stringify({ format: 'mogrid-scene', version: 1, nodes: {} }), /nodes 必须是数组/],
    [JSON.stringify({ format: 'mogrid-scene', version: 1, nodes: [], edges: 'x' }), /edges 必须是数组/],
    [JSON.stringify({ format: 'mogrid-scene', version: 1, nodes: [{ id: 'a b', x: 0, y: 0 }] }), /id 无效/],
    [JSON.stringify({ format: 'mogrid-scene', version: 1, nodes: [{ id: 'a', x: '1', y: 0 }] }), /坐标/],
    [JSON.stringify({ format: 'mogrid-scene', version: 1, nodes: [{ id: 'a', x: 0, y: 0 }, { id: 'a', x: 1, y: 1 }] }), /重复/],
    [JSON.stringify({ format: 'mogrid-scene', version: 1, nodes: [{ id: 'a', x: 0, y: 0 }], edges: [{ id: 'e', from: 'a', to: 'zz' }] }), /不存在的节点/],
    ['x'.repeat(2 * 1024 * 1024 + 1), /过大/]
  ];
  for (const [input, re] of bad) {
    const r = C.validateScene(input);
    assert.equal(r.ok, false, '应拒绝：' + input.slice(0, 60));
    assert.match(r.errors.join('\n'), re);
  }
  const many = { format: 'mogrid-scene', version: 1, nodes: Array.from({ length: 301 }, (_, i) => ({ id: 'n' + i, x: i, y: 0 })) };
  assert.match(C.validateScene(many).errors[0], /节点过多/);
});

test('导入校验：脚本/HTML 只作为纯文本保留，危险字段被丢弃', () => {
  const evil = {
    format: 'mogrid-scene', version: 1,
    __proto__x: 1,
    nodes: [
      { id: 'a', x: 0, y: 0, title: '<img src=x onerror=alert(1)>', desc: '<script>alert("x")</script>', onclick: 'alert(1)', html: '<b>', color: 'javascript:alert(1)' },
      { id: 'b', x: 1e9, y: -1e9, title: '‮evil​\u0007', desc: 42 }
    ],
    edges: [
      { id: 'e1', from: 'a', to: 'b', label: '<svg onload=alert(1)>', style: 'x' },
      { id: 'e2', from: 'a', to: 'a' },
      { id: 'e3', from: 'a', to: 'b' }
    ]
  };
  const text = JSON.stringify(evil).replace('"__proto__x"', '"__proto__"');
  const r = C.validateScene(text);
  assert.equal(r.ok, true, r.errors.join(';'));
  const [a, b] = r.scene.nodes;
  assert.deepEqual(Object.keys(a).sort(), ['color', 'desc', 'id', 'title', 'w', 'x', 'y']);
  assert.equal(a.title, '<img src=x onerror=alert(1)>', '内容原样保留为字符串（界面用 textContent 渲染）');
  assert.equal(a.color, 'blue');
  assert.equal(b.title, 'evil', '控制字符、零宽字符、双向覆盖字符被移除');
  assert.equal(b.desc, '');
  assert.equal(b.x, C.LIMITS.coord);
  assert.equal(b.y, -C.LIMITS.coord);
  assert.equal(r.scene.edges.length, 1, '自连与重复连线被忽略');
  assert.deepEqual(Object.keys(r.scene.edges[0]).sort(), ['from', 'id', 'label', 'to']);
  assert.ok(r.warnings.length >= 3);
  assert.equal(({}).polluted, undefined);
  assert.equal(Object.prototype.hasOwnProperty.call(r.scene, '__proto__'), false);
});

test('导入校验：超长文本按字符截断（不会切坏 emoji / 中文）', () => {
  const title = '架'.repeat(59) + '😀😀';
  const r = C.validateScene({ format: 'mogrid-scene', version: 1, nodes: [{ id: 'a', x: 0, y: 0, title, desc: '长'.repeat(500) }] });
  assert.equal(r.ok, true);
  const n = r.scene.nodes[0];
  assert.equal(Array.from(n.title).length, 60);
  assert.ok(n.title.endsWith('😀'));
  assert.equal(Array.from(n.desc).length, 400);
  assert.ok(r.warnings.some((w) => /标题过长/.test(w)));
});

test('中文逐字换行、英文按单词换行、避头标点', () => {
  const m = (s) => fakeMeasure(s, '10px x');
  // 每个汉字 10px，宽 50 => 每行 5 个字
  const r1 = C.wrapText('一二三四五六七八九十', 50, m);
  assert.deepEqual(plain(r1.lines), ['一二三四五', '六七八九十']);
  // 逗号不应出现在行首
  const r2 = C.wrapText('一二三四五，六七', 50, m);
  assert.ok(!r2.lines.some((l) => l.startsWith('，')), JSON.stringify(r2.lines));
  // 英文单词不被拆开（单字符 5.5px，宽 60 约 10 个字符）
  const r3 = C.wrapText('hello world agent', 60, m);
  assert.deepEqual(plain(r3.lines), ['hello', 'world', 'agent']);
  // 超长 URL 式单词强制断开，每行都不超宽
  const r4 = C.wrapText('https://example.invalid/aaaaaaaaaaaaaaaaaaaa', 60, m);
  assert.ok(r4.lines.length > 1);
  assert.ok(r4.lines.every((l) => m(l) <= 60));
  // 中英混排
  const r5 = C.wrapText('调用 OpenAPI 接口', 50, m);
  assert.ok(r5.lines.every((l) => m(l) <= 50 + 10), JSON.stringify(r5.lines));
  // 保留手动换行
  assert.deepEqual(plain(C.wrapText('甲\n乙', 100, m).lines), ['甲', '乙']);
});

test('超出最大行数时加省略号', () => {
  const m = (s) => fakeMeasure(s, '10px x');
  const r = C.wrapText('一二三四五六七八九十一二三四五', 50, m, 2);
  assert.equal(r.truncated, true);
  assert.equal(r.lines.length, 2);
  assert.ok(r.lines[1].endsWith('…'));
  assert.ok(m(r.lines[1]) <= 50);
});

test('节点排版：长文本节点更高，但受最大行数约束', () => {
  const short = C.layoutNode({ id: 'a', w: 200, title: '飞书', desc: '', color: 'blue' }, fakeMeasure);
  const long = C.layoutNode({ id: 'b', w: 200, title: '一个非常非常非常长的中文标题需要换行显示才行', desc: '说明'.repeat(200), color: 'blue' }, fakeMeasure);
  assert.equal(short.h, C.STYLE.minH);
  assert.ok(long.h > short.h);
  assert.equal(long.truncated, true);
  const titles = long.items.filter((i) => i.kind === 'title');
  const descs = long.items.filter((i) => i.kind === 'desc');
  assert.ok(titles.length <= C.STYLE.titleMaxLines);
  assert.ok(descs.length <= C.STYLE.descMaxLines);
  // 所有文字都在节点矩形内部
  for (const it of long.items) { assert.ok(it.y > 0 && it.y < long.h, '文字超出节点高度'); }
});

test('连线几何：端点落在两个矩形的边框上，跟随节点移动', () => {
  const ra = { x: 0, y: 0, w: 200, h: 80 }, rb = { x: 400, y: 0, w: 200, h: 80 };
  const g = C.edgeGeometry(ra, rb, 0);
  assert.ok(Math.abs(g.x1 - (200 + C.STYLE.edgeGap)) < 1e-6);
  assert.ok(Math.abs(g.x2 - (400 - C.STYLE.edgeGap)) < 1e-6);
  assert.equal(g.y1, 40); assert.equal(g.y2, 40);
  // 把 B 移到正下方：端点应改到上下边
  const g2 = C.edgeGeometry(ra, { x: 0, y: 300, w: 200, h: 80 }, 0);
  assert.ok(Math.abs(g2.y1 - (80 + C.STYLE.edgeGap)) < 1e-6);
  assert.ok(Math.abs(g2.y2 - (300 - C.STYLE.edgeGap)) < 1e-6);
  assert.equal(g2.x1, 100);
  // 箭头尖端就是终点
  assert.deepEqual(plain(g2.head[0]), [g2.x2, g2.y2]);
  // 重叠的节点不画线
  assert.equal(C.edgeGeometry(ra, { x: 50, y: 10, w: 200, h: 80 }, 0), null);
  // 双向连线向两侧错开
  const s = C.defaultScene();
  const fwd = s.edges.find((e) => e.from === 'n_feishu' && e.to === 'n_agent');
  const back = s.edges.find((e) => e.from === 'n_agent' && e.to === 'n_feishu');
  const gf = C.edgeGeometry(ra, rb, C.edgeOffset(s, fwd));
  const gb = C.edgeGeometry(rb, ra, C.edgeOffset(s, back));
  assert.notEqual(Math.sign(gf.y1 - 40), Math.sign(gb.y1 - 40));
  assert.ok(Math.abs(gf.my - gb.my) >= C.STYLE.labelH, '两条反向连线的文字不应重叠');
});

test('视图适配与边界计算', () => {
  const s = C.defaultScene();
  const layouts = new Map(s.nodes.map((n) => [n.id, C.layoutNode(n, fakeMeasure)]));
  const b = C.sceneBounds(s, layouts);
  assert.equal(b.x, 0); assert.equal(b.w, 1100);
  const v = C.fitView(b, 1200, 800, 50, 0.2, 1.5);
  assert.ok(v.zoom > 0 && v.zoom <= 1.5);
  // 适配后内容中心对齐视口中心
  assert.ok(Math.abs(v.x + (b.x + b.w / 2) * v.zoom - 600) < 1e-6);
  assert.equal(C.sceneBounds(C.emptyScene(), new Map()), null);
  const mobile = C.fitView(b, 300, 600, 24, 0.25, 1.25);
  assert.equal(mobile.zoom, 0.25, '窄屏下缩放不低于下限');
});

test('文本清洗', () => {
  assert.equal(C.cleanText('  a\r\nb\tc ', 10, true), 'a\nb c');
  assert.equal(C.cleanText('a\n\n\n\nb', 10, true), 'a\n\nb');
  assert.equal(C.cleanText('a\nb', 10, false), 'a b');
  assert.equal(C.cleanText(123, 10), '');
  assert.equal(C.cleanText(null, 10), '');
});
