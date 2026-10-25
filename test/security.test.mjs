import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import dgram from 'node:dgram';
import net from 'node:net';

const TOKEN = 'test-shared-token';
const HTTP_PORT = 18801;
const RADAR_PORT = 18800;
const BASE = `http://127.0.0.1:${HTTP_PORT}`;

let child;
let homeDir;

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
    try {
      if (payload) req.write(payload);
      req.end();
    } catch (err) {
      reject(err);
    }
  });
}

async function waitForBoot(timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await request('/health');
      if (res.status === 200) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error('插件未能启动');
}

before(async () => {
  homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'peer-link-test-'));
  child = spawn(process.execPath, [path.join(import.meta.dirname, 'harness.mjs')], {
    env: {
      ...process.env,
      DSH_HOME: homeDir,
      DSH_PEER_PORT: String(HTTP_PORT),
      DSH_PEER_RADAR_PORT: String(RADAR_PORT),
      DSH_PEER_TOKEN: TOKEN,
    },
    stdio: 'ignore',
  });
  await waitForBoot();
});

after(() => {
  child?.kill('SIGTERM');
  try { fs.rmSync(homeDir, { recursive: true, force: true }); } catch {}
});

const auth = { 'x-peer-token': TOKEN };

test('/talk 拒绝缺少 token 的请求（旧版可绕过）', async () => {
  const res = await request('/talk', {
    method: 'POST',
    body: { topic: 't', message: 'm', sender: { name: 'Evil', type: 'agent' } },
  });
  assert.equal(res.status, 401);
  assert.equal(res.json.ok, false);
});

test('/talk 拒绝错误 token', async () => {
  const res = await request('/talk', {
    method: 'POST',
    body: { topic: 't', message: 'm', token: 'wrong', sender: { name: 'Evil' } },
  });
  assert.equal(res.status, 401);
});

test('/talk 接受正确 token', async () => {
  const res = await request('/talk', {
    method: 'POST',
    body: { topic: 't', message: 'm', token: TOKEN, sender: { name: 'Peer-A', type: 'agent' } },
  });
  assert.equal(res.status, 200);
  assert.equal(res.json.ok, true);
});

test('/api/status 不下发明文 token', async () => {
  const res = await request('/api/status', { headers: auth });
  assert.equal(res.status, 200);
  assert.equal(res.json.token, undefined, '不得返回明文 token');
  assert.equal(typeof res.json.tokenConfigured, 'boolean');
});

test('/api/status 拒绝无凭据访问', async () => {
  const res = await request('/api/status');
  assert.equal(res.status, 401);
});

test('/api/status 拒绝跨源读取且不回显 CORS 头', async () => {
  const res = await request('/api/status', {
    headers: { ...auth, Origin: 'https://evil.example' },
  });
  assert.equal(res.status, 403);
  assert.equal(res.headers['access-control-allow-origin'], undefined);
});

test('/api/status 允许本机回环来源并回显 CORS', async () => {
  const origin = 'http://127.0.0.1:52800';
  const res = await request('/api/status', { headers: { Origin: origin } });
  assert.equal(res.status, 200);
  assert.equal(res.headers['access-control-allow-origin'], origin);
});

test('控制面写接口拒绝无凭据的局域网写入', async () => {
  const res = await request('/api/peers', {
    method: 'POST',
    body: { url: 'http://10.0.0.1:9999', name: 'Attacker' },
  });
  assert.equal(res.status, 401);
  const cfg = JSON.parse(fs.readFileSync(path.join(homeDir, 'peer-link', 'config.json'), 'utf-8'));
  assert.equal(cfg.peers.length, 0, '花名册不应被未授权写入');
});

test('请求体超限返回 413 且服务存活', async () => {
  // 用裸 TCP 发送超大请求体：服务端在超限后会主动断开，客户端侧
  // 可能先收到 413，也可能先收到 RST/EPIPE，两种都算通过。
  const big = 'x'.repeat(2 * 1024 * 1024);
  const outcome = await new Promise((resolve) => {
    const sock = net.connect(HTTP_PORT, '127.0.0.1', () => {
      sock.write(
        'POST /talk HTTP/1.1\r\n' +
          `Host: 127.0.0.1:${HTTP_PORT}\r\n` +
          'Content-Type: application/json\r\n' +
          `Content-Length: ${Buffer.byteLength(big)}\r\n\r\n`
      );
      sock.write(big);
    });
    let data = '';
    let settled = false;
    const done = (v) => { if (!settled) { settled = true; resolve(v); } };
    sock.on('data', (c) => (data += c));
    sock.on('close', () => done({ kind: data.includes('413') ? 'status413' : 'closed' }));
    sock.on('error', () => done({ kind: 'reset' }));
    setTimeout(() => { try { sock.destroy(); } catch {} done({ kind: data.includes('413') ? 'status413' : 'timeout' }); }, 4000);
  });

  assert.ok(
    outcome.kind === 'status413' || outcome.kind === 'closed' || outcome.kind === 'reset',
    `超限请求应被拒绝，实际: ${JSON.stringify(outcome)}`
  );

  const health = await request('/health');
  assert.equal(health.status, 200, '超限请求不应拖垮服务');
});

test('入站学习不会把对端写成“指向自己”', async () => {
  await request('/talk', {
    method: 'POST',
    body: { topic: 't', message: 'm', token: TOKEN, sender: { name: 'NoUrl', type: 'agent' } },
  });
  await request('/talk', {
    method: 'POST',
    body: {
      topic: 't', message: 'm', token: TOKEN,
      sender: { name: 'RealPeer', url: 'http://192.168.1.50:8765', type: 'agent' },
    },
  });
  await new Promise((r) => setTimeout(r, 1200)); // 等待合并写盘

  const cfg = JSON.parse(fs.readFileSync(path.join(homeDir, 'peer-link', 'config.json'), 'utf-8'));
  for (const p of cfg.peers) {
    const u = new URL(p.url);
    const isSelf =
      ['127.0.0.1', 'localhost'].includes(u.hostname) && Number(u.port) === HTTP_PORT;
    assert.equal(isSelf, false, `不应出现自指对端: ${p.url}`);
  }
  assert.ok(cfg.peers.some((p) => p.name === 'RealPeer'), '应学习到声明了 URL 的对端');
});

test('在线状态按 last_seen 实时复算，不采信固化值', async () => {
  const cfgPath = path.join(homeDir, 'peer-link', 'config.json');
  const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf-8'));
  assert.ok(cfg.peers.length > 0);
  cfg.peers[0].online = true;
  cfg.peers[0].last_seen = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));

  const res = await request('/api/status', { headers: auth });
  assert.equal(res.json.peers[0].online, false, '过期心跳必须显示离线');
});

test('雷达可收发探测包并自动收录节点', async () => {
  const sock = dgram.createSocket('udp4');
  const reply = new Promise((resolve) => {
    sock.on('message', (msg) => {
      try { resolve(JSON.parse(msg.toString())); } catch {}
    });
    setTimeout(() => resolve(null), 3000);
  });

  await new Promise((resolve) => sock.bind(0, resolve));
  sock.setBroadcast(true);
  const probe = Buffer.from(JSON.stringify({
    protocol: 'dsh-plugin-peer-link',
    version: '1.0',
    action: 'probe',
    nodeId: 'node-probe-test',
    name: 'ProbeTest',
    avatar: '🧪',
    role: 'test',
    httpPort: 19999,
    token: TOKEN,
  }));
  sock.send(probe, 0, probe.length, RADAR_PORT, '127.0.0.1');

  const answer = await reply;
  sock.close();
  assert.ok(answer, '雷达应回应 announce');
  assert.equal(answer.action, 'announce');

  await new Promise((r) => setTimeout(r, 1200));
  const res = await request('/api/status', { headers: auth });
  const found = res.json.peers.find((p) => p.name === 'ProbeTest');
  assert.ok(found, '探测到的节点应进入花名册');
  assert.equal(found.autoDiscovered, true);
});

test('雷达丢弃 token 不一致的探测包', async () => {
  const sock = dgram.createSocket('udp4');
  await new Promise((resolve) => sock.bind(0, resolve));
  sock.setBroadcast(true);
  const probe = Buffer.from(JSON.stringify({
    protocol: 'dsh-plugin-peer-link',
    version: '1.0',
    action: 'announce',
    nodeId: 'node-wrong-token',
    name: 'WrongToken',
    httpPort: 19998,
    token: 'not-the-token',
  }));
  sock.send(probe, 0, probe.length, RADAR_PORT, '127.0.0.1');
  await new Promise((r) => setTimeout(r, 1500));
  sock.close();

  const res = await request('/api/status', { headers: auth });
  assert.equal(
    res.json.peers.some((p) => p.name === 'WrongToken'),
    false,
    'token 不匹配的节点不得进入花名册'
  );
});

test('仪表盘对所有远端字段做 HTML 转义', async () => {
  const res = await request('/', { headers: auth });
  assert.equal(res.status, 200);
  // 远端可控的三个字段必须走 esc()
  for (const field of ['esc(p.name)', 'esc(p.role', 'esc(p.avatar', 'esc(item.peer', 'esc(item.topic']) {
    assert.ok(res.body.includes(field), `仪表盘应转义 ${field}`);
  }
  // textContent 赋值天然免疫注入（第 799 行），不属于需要转义的 innerHTML 路径；
  // 这里确保 innerHTML 模板里没有裸插值。
  const innerHtmlBlocks = res.body.split('innerHTML').slice(1).join('innerHTML');
  for (const bare of ['${p.name}', '${p.role', '${p.url}']) {
    assert.ok(
      !innerHtmlBlocks.includes(bare),
      `innerHTML 路径不应存在裸插值 ${bare}`
    );
  }
});
