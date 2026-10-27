// 历史公开密钥的轮换回归测试。
//
// 为什么值得单独立一个文件：这个仓库是 public 的，旧版把
// `dsh-peer-secret-shared-token` 硬编码成兜底密钥，等于一个公开密钥。
// 轮换逻辑如果只改内存不落盘，问题比"没换"更隐蔽：
// `defaultConf.token` 是每次 loadConfig() 现生成的随机值，而控制面每次
// `/api/status` 都会 `cfg = loadConfig()` —— 于是同一个进程里换一次配置调用
// 就换一个 token，鉴权时好时坏，磁盘上还一直留着那个公开旧值。
//
// 所以这里断言的是「稳定」而不是「换过」：轮换后必须落盘，且后续调用读到同一个值。
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';

const LEGACY = 'dsh-peer-secret-shared-token';
const HTTP_PORT = 18821;
const RADAR_PORT = 18820;
const BASE = `http://127.0.0.1:${HTTP_PORT}`;

let child;
let homeDir;
let configPath;

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
          try {
            json = JSON.parse(buf);
          } catch {}
          resolve({ status: res.statusCode, body: buf, json });
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

function readConfig() {
  return JSON.parse(fs.readFileSync(configPath, 'utf8'));
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
  homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'peer-link-rotate-'));
  configPath = path.join(homeDir, 'peer-link', 'config.json');
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  // 预置一份"老版本留下的"配置：token 是公开常量，端口写死在文件里
  fs.writeFileSync(
    configPath,
    JSON.stringify(
      {
        node: { id: 'node-legacy', name: '老配置节点', avatar: '🤖', role: '测试' },
        listen_port: HTTP_PORT,
        radar_port: RADAR_PORT,
        token: LEGACY,
        peers: [],
      },
      null,
      2
    )
  );

  const env = { ...process.env, DSH_HOME: homeDir };
  // 关键：不注入 DSH_PEER_TOKEN，让插件必须自己去处理磁盘上那个公开旧值
  delete env.DSH_PEER_TOKEN;

  child = spawn(process.execPath, [path.join(import.meta.dirname, 'harness.mjs')], {
    env,
    stdio: 'ignore',
  });
  await waitForBoot();
});

after(() => {
  child?.kill('SIGTERM');
  try {
    fs.rmSync(homeDir, { recursive: true, force: true });
  } catch {}
});

test('启动即把磁盘上的公开旧密钥轮换成随机值', () => {
  const cfg = readConfig();
  assert.notEqual(cfg.token, LEGACY, '磁盘上不许留着公开旧密钥');
  assert.match(cfg.token, /^[0-9a-f]{64}$/, '轮换值必须是 32 字节随机 hex');
});

test('轮换后的 token 是稳定的：连续多次鉴权调用都能过', async () => {
  const { token } = readConfig();
  // 控制面每次命中 /api/status 都会重新 loadConfig()。
  // 如果轮换只改内存不落盘，这里第二次请求就会拿到另一个随机 token 而 401。
  for (let i = 0; i < 3; i += 1) {
    const res = await request('/api/status', { headers: { 'x-peer-token': token } });
    assert.equal(res.status, 200, `第 ${i + 1} 次鉴权失败，说明 token 在多次 loadConfig 之间漂移了`);
    assert.equal(res.json.tokenConfigured, true);
  }
});

test('轮换后磁盘上的值没被后续 loadConfig 改写', async () => {
  const before = readConfig().token;
  await request('/api/status', { headers: { 'x-peer-token': before } });
  assert.equal(readConfig().token, before);
});

test('公开旧密钥在轮换后不再可用', async () => {
  const res = await request('/api/status', { headers: { 'x-peer-token': LEGACY } });
  assert.equal(res.status, 401, '旧的公开密钥必须失效');
});
