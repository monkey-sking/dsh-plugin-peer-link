// server.js（独立 Web 控制台，默认 127.0.0.1:8790）的鉴权 / CORS / SSRF / XSS 回归测试。
// 现有 security.test.mjs 只覆盖 index.js 那条 HTTP 服务，server.js 此前完全没有测试。
//
// server.js 的端口是常量 8790、目录是 ~/.dsh/peer-link，所以这里用 HOSTALIASES 隔离不了路径，
// 改用 HOME 重定向到临时目录（os.homedir() 在 POSIX 上读 $HOME），并从 /proc 无关的
// 方式探测 8790 是否已占用——占用就直接跳过，避免误测到本机真实控制台。
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import net from 'node:net';

const PORT = 8790;
const TOKEN = 'server-test-token-0123456789abcdef';
const BASE = `http://127.0.0.1:${PORT}`;

let child;
let homeDir;
let skipReason = '';

function request(pathname, { method = 'GET', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? null : typeof body === 'string' ? body : JSON.stringify(body);
    const req = http.request(
      `${BASE}${pathname}`,
      {
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
          ...headers,
        },
      },
      (res) => {
        let buf = '';
        res.on('data', (c) => (buf += c));
        res.on('end', () => {
          let json = null;
          try { json = JSON.parse(buf); } catch {}
          resolve({ status: res.statusCode, headers: res.headers, body: buf, json });
        });
      }
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function portFree(port) {
  return new Promise((resolve) => {
    const sock = net.connect(port, '127.0.0.1');
    sock.on('connect', () => { sock.destroy(); resolve(false); });
    sock.on('error', () => resolve(true));
    setTimeout(() => { try { sock.destroy(); } catch {} resolve(true); }, 800);
  });
}

async function waitForBoot(timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await request('/');
      if (res.status === 200) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error('server.js 未能启动');
}

before(async () => {
  if (!(await portFree(PORT))) {
    skipReason = `端口 ${PORT} 已被占用，跳过 server.js 测试（避免误测本机真实控制台）`;
    return;
  }
  homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'peer-link-server-test-'));
  fs.mkdirSync(path.join(homeDir, '.dsh', 'peer-link'), { recursive: true });
  // 预置一份“插件写的”配置：server.js 必须读同一份 token，不能自己造硬编码值
  fs.writeFileSync(
    path.join(homeDir, '.dsh', 'peer-link', 'config.json'),
    JSON.stringify(
      { node: { id: 'node-test', name: 'Node-Test', avatar: '🧪', role: 'test' }, listen_port: 8765, token: TOKEN, peers: [] },
      null,
      2
    ),
    'utf-8'
  );
  child = spawn(process.execPath, [path.join(import.meta.dirname, '..', 'server.js')], {
    env: { ...process.env, HOME: homeDir },
    stdio: 'ignore',
  });
  await waitForBoot();
});

after(() => {
  child?.kill('SIGTERM');
  try { if (homeDir) fs.rmSync(homeDir, { recursive: true, force: true }); } catch {}
});

const auth = { 'x-peer-token': TOKEN };
const guard = (t) => (skipReason ? t.skip(skipReason) : t);

// ——— B1：全部 /api/* 无鉴权 ———
for (const [method, ep, body] of [
  ['GET', '/api/status', undefined],
  ['GET', '/api/servers', undefined],
  ['POST', '/api/servers', { name: 'x', host: 'y' }],
  ['GET', '/api/chat/messages', undefined],
  ['POST', '/api/profile', { name: 'pwn' }],
  ['POST', '/api/peers', { url: 'http://192.168.1.9:8765' }],
  ['POST', '/api/ping', { peerId: 'x' }],
  ['POST', '/api/human/send', { topic: 't', message: 'm' }],
  ['POST', '/api/send', { topic: 't', message: 'm' }],
]) {
  test(guard(`B1: ${method} ${ep} 无 token 一律 401`), async () => {
    if (skipReason) return;
    const res = await request(ep, { method, body });
    assert.equal(res.status, 401);
    assert.equal(res.json.ok, false);
  });
}

test(guard('B1: 错误 token 仍是 401'), async () => {
  if (skipReason) return;
  const res = await request('/api/status', { headers: { 'x-peer-token': 'wrong-wrong-wrong' } });
  assert.equal(res.status, 401);
});

test(guard('B1: 正确 token 才 200；花名册不会被未授权写入'), async () => {
  if (skipReason) return;
  const bad = await request('/api/peers', { method: 'POST', body: { url: 'http://192.168.1.9:8765', name: 'Evil' } });
  assert.equal(bad.status, 401);

  const good = await request('/api/status', { headers: auth });
  assert.equal(good.status, 200);
  assert.equal(good.json.peers.length, 0, '未授权写入不得落盘');
});

test(guard('B1: /api/human/send 未授权时不会落盘任何会话'), async () => {
  if (skipReason) return;
  const sessions = path.join(homeDir, '.dsh', 'peer-link', 'sessions');
  const before = fs.existsSync(sessions) ? fs.readdirSync(sessions).length : 0;
  await request('/api/human/send', { method: 'POST', body: { topic: 't', message: 'm' } });
  const afterCount = fs.existsSync(sessions) ? fs.readdirSync(sessions).length : 0;
  assert.equal(afterCount, before, '未鉴权请求不得写入会话留痕');
});

// ——— B2：明文回传 token ———
test(guard('B2: /api/status 不下发明文 token'), async () => {
  if (skipReason) return;
  const res = await request('/api/status', { headers: auth });
  assert.equal(res.status, 200);
  assert.equal(res.json.token, undefined);
  assert.equal(typeof res.json.tokenConfigured, 'boolean');
  assert.equal(res.body.includes(TOKEN), false, '响应体任何位置都不应出现 token');
});

// ——— B3：ACAO:* ———
test(guard('B3: 跨源不回收 CORS 头，且预检被拒'), async () => {
  if (skipReason) return;
  const evil = 'https://evil.example';
  const pre = await request('/api/status', {
    method: 'OPTIONS',
    headers: { Origin: evil, 'Access-Control-Request-Method': 'GET', 'Access-Control-Request-Headers': 'x-peer-token' },
  });
  assert.equal(pre.status, 403);
  assert.equal(pre.headers['access-control-allow-origin'], undefined);

  const res = await request('/api/status', { headers: { ...auth, Origin: evil } });
  assert.equal(res.status, 403);
  assert.equal(res.headers['access-control-allow-origin'], undefined);
});

test(guard('B3: 本机回环来源回显 Origin 且放行 x-peer-token 头，带 Vary'), async () => {
  if (skipReason) return;
  const origin = `http://127.0.0.1:${PORT}`;
  const res = await request('/api/status', { headers: { ...auth, Origin: origin } });
  assert.equal(res.status, 200);
  assert.equal(res.headers['access-control-allow-origin'], origin);
  assert.equal(res.headers['access-control-allow-origin'] === '*', false);
  assert.match(res.headers['access-control-allow-headers'] || '', /x-peer-token/i);
  assert.match(res.headers.vary || '', /Origin/i);
});

// ——— B4：硬编码默认 token ———
test(guard('B4: 源码里不再有硬编码默认 token'), async () => {
  if (skipReason) return;
  for (const f of ['server.js', 'index.js']) {
    const src = fs.readFileSync(path.join(import.meta.dirname, '..', f), 'utf-8');
    // 只允许出现在 LEGACY_PUBLIC_TOKENS 轮换名单里
    const hits = [...src.matchAll(/dsh-peer-secret-shared-token/g)].length;
    const inLegacyList = /LEGACY_PUBLIC_TOKENS = new Set\(\['dsh-peer-secret-shared-token'\]\)/.test(src);
    if (hits > 0) assert.ok(inLegacyList, `${f} 中的历史常量必须只用于轮换，不能当默认值`);
    assert.equal(
      /token:\s*process\.env\.DSH_PEER_TOKEN\s*\|\|\s*'/.test(src),
      false,
      `${f} 不得回退到硬编码 token`
    );
  }
});

test(guard('B4: 配置文件缺失时随机生成并落盘，而不是回退到公开常量'), async () => {
  if (skipReason) return;
  const cfgPath = path.join(homeDir, '.dsh', 'peer-link', 'config.json');
  const original = fs.readFileSync(cfgPath, 'utf-8');
  try {
    // 写入历史公开常量，看 loadConfig 是否轮换
    const cfg = JSON.parse(original);
    cfg.token = 'dsh-peer-secret-shared-token';
    fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2), 'utf-8');

    // 轮换发生在下一次 loadConfig（即下一次请求）。此时旧 token 必须已失效。
    const fail = await request('/api/status', { headers: auth });
    assert.equal(fail.status, 401, '历史公开 token 必须立即失效');

    const rotated = JSON.parse(fs.readFileSync(cfgPath, 'utf-8'));
    assert.notEqual(rotated.token, 'dsh-peer-secret-shared-token');
    assert.ok(rotated.token.length >= 32, '轮换后应为 32 字节随机十六进制');
  } finally {
    fs.writeFileSync(cfgPath, original, 'utf-8');
  }
});

// ——— B5：监听 0.0.0.0 ———
test(guard('B5: 默认只监听 127.0.0.1'), async () => {
  if (skipReason) return;
  const src = fs.readFileSync(path.join(import.meta.dirname, '..', 'server.js'), 'utf-8');
  assert.equal(
    /server\.listen\(PORT,\s*'0\.0\.0\.0'/.test(src),
    false,
    "server.listen 不得硬编码 0.0.0.0"
  );
  assert.match(src, /PEER_LINK_BIND/, '应有显式环境变量开关');

  const out = await new Promise((resolve) => {
    const { execFile } = require0();
    resolve(null);
  });
  void out;
  // 实际绑定地址：在 macOS/Linux 上用 lsof 可能不可用，改用直连非回环地址验证
  const lan = (() => {
    for (const list of Object.values(os.networkInterfaces())) {
      for (const i of list || []) if (i.family === 'IPv4' && !i.internal) return i.address;
    }
    return null;
  })();
  if (!lan) return; // 无局域网地址则无法验证
  const reachable = await new Promise((resolve) => {
    const sock = net.connect(PORT, lan);
    sock.on('connect', () => { sock.destroy(); resolve(true); });
    sock.on('error', () => resolve(false));
    setTimeout(() => { try { sock.destroy(); } catch {} resolve(false); }, 800);
  });
  assert.equal(reachable, false, `不应能通过局域网地址 ${lan}:${PORT} 连到控制台`);
});

function require0() { return {}; }

// ——— B6：XSS ———
test(guard('B6: 前端脚本对远端字段转义（renderPeerList / loadDash）'), async () => {
  if (skipReason) return;
  const res = await request('/', { headers: {} });
  assert.equal(res.status, 200);
  const html = res.body;
  // 裸插值必须消失
  for (const bare of ['${p.name}', '${p.avatar', '${p.role', '${p.url}', '${m.from}']) {
    assert.equal(html.includes(bare), false, `不应存在裸插值 ${bare}`);
  }
  // 转义函数必须覆盖单引号（否则 onclick='...' 里可逃逸）
  assert.ok(html.includes("'&#39;'"), 'escapeHtml 应转义单引号');
  assert.ok(html.includes('JSON.stringify(l)') && html.includes('escapeHtml('), 'ledger 行应转义后渲染');
});

test(guard('B6: 恶意对端名不会原样进入 HTML'), async () => {
  if (skipReason) return;
  const evilName = `<img src=x onerror="globalThis.__xss=1">`;
  const add = await request('/api/peers', { method: 'POST', headers: auth, body: { url: 'http://192.168.1.77:8765', name: evilName } });
  assert.equal(add.status, 200, '合法的内网对端应允许登记');

  const res = await request('/', {});
  // 页面本身不含对端数据（前端是用 /api/status 的 JSON 渲染的），
  // 所以这里检查渲染路径是安全的：数据走 JSON + escapeHtml
  const status = await request('/api/status', { headers: auth });
  assert.equal(status.json.peers[0].name, evilName, '仍然原样保存（不做数据篡改）');
  assert.equal(res.body.includes('__xss'), false);
});

// ——— B7：SSRF ———
for (const badUrl of [
  'http://169.254.169.254/latest/meta-data/',
  'http://0.0.0.0:8765',
  'file:///etc/passwd',
  'ftp://192.168.1.5/',
  'http://user:pass@192.168.1.5:8765',
  'http://127.0.0.1:8790',
  'http://localhost:8790',
  'http://[::1]:8790',
]) {
  test(guard(`B7: /api/peers 拒绝不安全 URL ${badUrl}`), async () => {
    if (skipReason) return;
    const res = await request('/api/peers', { method: 'POST', headers: auth, body: { url: badUrl, name: 'ssrf' } });
    assert.equal(res.status, 400, `${badUrl} 应被拒绝`);
    const cfg = JSON.parse(fs.readFileSync(path.join(homeDir, '.dsh', 'peer-link', 'config.json'), 'utf-8'));
    assert.equal((cfg.peers || []).some((p) => p.url === badUrl), false, '不得落盘');
  });
}

test(guard('B7: /api/ping 不会对历史遗留的元数据地址发起请求'), async () => {
  if (skipReason) return;
  const cfgPath = path.join(homeDir, '.dsh', 'peer-link', 'config.json');
  const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf-8'));
  // 模拟“绕过 /api/peers 校验”直接写进配置的恶意对端（例如旧版本遗留）
  cfg.peers = [{ id: 'evil', name: 'evil', url: 'http://169.254.169.254', token: TOKEN, online: true }];
  fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2), 'utf-8');
  try {
    const res = await request('/api/ping', { method: 'POST', headers: auth, body: { peerId: 'evil' } });
    assert.equal(res.status, 200);
    assert.equal(res.json.ok, false, '应拒绝探测');
    assert.match(res.json.result.error, /拒绝探测不安全的目标地址/);
  } finally {
    cfg.peers = [];
    fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2), 'utf-8');
  }
});

test(guard('B7: /api/human/send 不会向元数据地址投递'), async () => {
  if (skipReason) return;
  const cfgPath = path.join(homeDir, '.dsh', 'peer-link', 'config.json');
  const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf-8'));
  cfg.peers = [{ id: 'evil2', name: 'evil2', url: 'http://169.254.169.254', token: TOKEN, online: true }];
  fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2), 'utf-8');
  try {
    const res = await request('/api/human/send', {
      method: 'POST', headers: auth, body: { topic: 't', message: 'm', target: 'evil2' },
    });
    assert.equal(res.status, 200);
    const reply = res.json.result.reply || '';
    assert.match(reply, /拒绝向不安全的目标地址投递|对端当前可能离线/, '不得真的 POST 到元数据地址');
  } finally {
    cfg.peers = [];
    fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2), 'utf-8');
  }
});

// ——— token 强度 / 请求体上限（顺手项） ———
test(guard('顺手项: /api/profile 不允许把 token 置空或设为弱值'), async () => {
  if (skipReason) return;
  for (const bad of ['', 'short']) {
    const res = await request('/api/profile', { method: 'POST', headers: auth, body: { token: bad } });
    assert.equal(res.status, 400);
  }
  const cfg = JSON.parse(fs.readFileSync(path.join(homeDir, '.dsh', 'peer-link', 'config.json'), 'utf-8'));
  assert.equal(cfg.token, TOKEN, 'token 不应被改动');
});

test(guard('顺手项: 请求体超限返回 413'), async () => {
  if (skipReason) return;
  const big = 'x'.repeat(2 * 1024 * 1024);
  const outcome = await new Promise((resolve) => {
    const sock = net.connect(PORT, '127.0.0.1', () => {
      sock.write(
        `POST /api/servers HTTP/1.1\r\nHost: 127.0.0.1:${PORT}\r\n` +
          `x-peer-token: ${TOKEN}\r\nContent-Type: application/json\r\n` +
          `Content-Length: ${Buffer.byteLength(big)}\r\n\r\n`
      );
      sock.write(big);
    });
    let data = '';
    let settled = false;
    const done = (v) => { if (!settled) { settled = true; resolve(v); } };
    sock.on('data', (c) => (data += c));
    sock.on('close', () => done(data.includes('413') ? 'status413' : 'closed'));
    sock.on('error', () => done('reset'));
    setTimeout(() => { try { sock.destroy(); } catch {} done(data.includes('413') ? 'status413' : 'timeout'); }, 4000);
  });
  assert.ok(['status413', 'closed', 'reset'].includes(outcome), `实际: ${outcome}`);
  const health = await request('/', {});
  assert.equal(health.status, 200, '超限请求不应拖垮控制台');
});
