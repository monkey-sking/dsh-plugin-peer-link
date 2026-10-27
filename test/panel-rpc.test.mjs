// 面板 ↔ 宿主的同源 RPC 桥回归测试。
//
// 背景：控制面加了 x-peer-token 之后，client.js 原来那套「跨源直连 127.0.0.1:8765」
// 会全部 401，面板彻底不可用。修法是把面板的请求改走宿主 Connection 上的同源路由，
// 由宿主在服务端用真实 token 回调控制面。
//
// 这里分两层测：
//   1. 纯函数层：白名单 / 方法 / 查询串穿越（不需要起服务）
//   2. 端到端层：真起一个「带 Connection 的宿主」，用 HTTP 打 RPC 路由，
//      验证面板能真的读到数据、且挡得住越权路径
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';

import { normalizeCall, PanelRpcError, PANEL_RPC_ROUTE } from '../lib/panel-rpc.js';

const TOKEN = 'panel-rpc-test-token';
const HTTP_PORT = 18811;
const RPC_PORT = 18812;
const RADAR_PORT = 18810;
const RPC_BASE = `http://127.0.0.1:${RPC_PORT}/${PANEL_RPC_ROUTE}`;
const CONTROL_BASE = `http://127.0.0.1:${HTTP_PORT}`;

// ── 1. 纯函数层 ────────────────────────────────────────────────────────

test('normalizeCall: 放行面板真正会用到的接口', () => {
  assert.deepEqual(normalizeCall({ endpoint: '/api/status', method: 'GET' }), {
    path: '/api/status',
    method: 'GET',
    body: null,
  });
  assert.deepEqual(normalizeCall({ endpoint: '/api/send', method: 'POST', data: { peerId: 'a' } }), {
    path: '/api/send',
    method: 'POST',
    body: { peerId: 'a' },
  });
  assert.equal(normalizeCall({ endpoint: '/api/peers', method: 'DELETE', data: { id: 'p1' } }).method, 'DELETE');
});

test('normalizeCall: 白名单之外一律 403', () => {
  for (const endpoint of ['/api/session-token', '/talk', '/', '/api/../api/status', 'http://evil/x']) {
    assert.throws(
      () => normalizeCall({ endpoint, method: 'GET' }),
      (err) => err instanceof PanelRpcError && err.status === 403,
      `${endpoint} 应该被拒`
    );
  }
});

test('normalizeCall: 方法不对返回 405', () => {
  assert.throws(
    () => normalizeCall({ endpoint: '/api/ping', method: 'GET' }),
    (err) => err.status === 405
  );
  assert.throws(
    () => normalizeCall({ endpoint: '/api/status', method: 'POST', data: {} }),
    (err) => err.status === 405
  );
});

test('normalizeCall: /api/session 的 file 只接受 basename（挡目录穿越）', () => {
  assert.deepEqual(normalizeCall({ endpoint: '/api/session?file=a.md', method: 'GET' }), {
    path: '/api/session?file=a.md',
    method: 'GET',
    body: null,
  });
  for (const evil of ['../../etc/passwd', '..%2F..%2Fetc%2Fpasswd', '/etc/passwd']) {
    assert.throws(
      () => normalizeCall({ endpoint: `/api/session?file=${evil}`, method: 'GET' }),
      (err) => err.status === 400,
      `${evil} 应该被拒`
    );
  }
});

test('normalizeCall: 不需要查询参数的接口不接受查询串', () => {
  assert.throws(
    () => normalizeCall({ endpoint: '/api/status?x=1', method: 'GET' }),
    (err) => err.status === 400
  );
});

test('normalizeCall: 请求体不是对象返回 400', () => {
  for (const payload of [null, undefined, 42, 'x', []]) {
    assert.throws(
      () => normalizeCall(payload),
      (err) => err instanceof PanelRpcError && err.status === 400
    );
  }
});

// ── 2. 端到端层 ────────────────────────────────────────────────────────

let child;
let homeDir;

function request(url, { method = 'GET', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? null : typeof body === 'string' ? body : JSON.stringify(body);
    const req = http.request(
      url,
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
          try {
            json = JSON.parse(buf);
          } catch {}
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

function rpc(payload) {
  return request(RPC_BASE, { method: 'POST', body: payload });
}

async function waitFor(url, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      await request(url);
      return;
    } catch {}
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error(`未能启动: ${url}`);
}

before(async () => {
  homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'peer-link-rpc-test-'));
  child = spawn(process.execPath, [path.join(import.meta.dirname, 'harness-rpc.mjs')], {
    env: {
      ...process.env,
      DSH_HOME: homeDir,
      DSH_PEER_PORT: String(HTTP_PORT),
      DSH_PEER_RADAR_PORT: String(RADAR_PORT),
      DSH_PEER_RPC_PORT: String(RPC_PORT),
      DSH_PEER_TOKEN: TOKEN,
    },
    stdio: 'ignore',
  });
  await waitFor(`${CONTROL_BASE}/health`);
  await waitFor(RPC_BASE);
});

after(() => {
  child?.kill('SIGTERM');
  try {
    fs.rmSync(homeDir, { recursive: true, force: true });
  } catch {}
});

test('E2E: 面板通过宿主路由能读到状态（等价于原来跨源的 /api/status）', async () => {
  const res = await rpc({ endpoint: '/api/status', method: 'GET' });
  assert.equal(res.status, 200);
  assert.equal(res.json.ok, true);
  assert.equal(typeof res.json.data.node.name, 'string');
  // 关键：凭据绝不出现在回给浏览器的载荷里
  assert.equal(res.json.data.token, undefined);
  assert.equal(typeof res.json.data.tokenConfigured, 'boolean');
});

test('E2E: 面板拿不到控制面派生凭据（越权路径根本没开）', async () => {
  const res = await rpc({ endpoint: '/api/session-token', method: 'POST' });
  assert.equal(res.status, 403);
  assert.equal(res.json.ok, false);
});

test('E2E: 目录穿越在桥这一层就被拒', async () => {
  const res = await rpc({ endpoint: '/api/session?file=../../etc/passwd', method: 'GET' });
  assert.equal(res.status, 400);
});

test('E2E: 面板写操作（改名片）仍然可用', async () => {
  const res = await rpc({
    endpoint: '/api/profile',
    method: 'POST',
    data: { name: '面板改的名', avatar: '🧪', role: '测试节点' },
  });
  assert.equal(res.status, 200);
  assert.equal(res.json.ok, true);

  const after = await rpc({ endpoint: '/api/status', method: 'GET' });
  assert.equal(after.json.data.node.name, '面板改的名');
});

test('E2E: 面板的请求体不是 JSON 时返回 400 而不是崩', async () => {
  const res = await request(RPC_BASE, { method: 'POST', body: 'not-json' });
  assert.equal(res.status, 400);
  assert.equal(res.json.ok, false);
});

test('E2E: 浏览器侧不再直接持有 token —— 跨源直连控制面仍被拒', async () => {
  // 模拟旧 client.js 的做法：跨源且不带凭据
  const res = await request(`${CONTROL_BASE}/api/status`, {
    headers: { Origin: 'http://127.0.0.1:52800' },
  });
  assert.equal(res.status, 401, '跨源无凭据必须被拒（这正是面板改走 RPC 的原因）');
});
