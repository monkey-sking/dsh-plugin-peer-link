// 测试用宿主（带 Connection）：把插件按 DSH 的方式装配起来，
// 并把注册到 connection.fetch 的路由真实地暴露成一个 HTTP 端口，
// 这样测试就能用普通 HTTP 客户端验证「浏览器 → 宿主 → 控制面」整条链路。
import http from 'node:http';

import { apply } from '../index.js';
import { PANEL_RPC_ROUTE } from '../lib/panel-rpc.js';

const RPC_PORT = Number(process.env.DSH_PEER_RPC_PORT);
if (!RPC_PORT) {
  console.error('缺少 DSH_PEER_RPC_PORT');
  process.exit(2);
}

let handler = null;

const ctx = {
  systemPrompt: { context() {} },
  tools: { register() {} },
  // 模拟 Cordis 的 service 注入：拿到 connection 后立刻调用回调
  inject(deps, fn) {
    fn(this);
  },
  effect(fn) {
    return fn();
  },
  get(name) {
    if (name !== 'connection') return undefined;
    return {
      fetch: {
        register(spec) {
          handler = spec.fetch;
          return () => {
            handler = null;
          };
        },
      },
    };
  },
};

apply(ctx);

if (!handler) {
  console.error('插件没有注册 connection.fetch 路由');
  process.exit(3);
}

// 极小的适配层：Node req → 标准 Request → 插件 handler → 标准 Response → Node res
http
  .createServer(async (req, res) => {
    try {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const body = Buffer.concat(chunks);
      const request = new Request(`http://127.0.0.1/${PANEL_RPC_ROUTE}`, {
        method: req.method,
        headers: { 'content-type': req.headers['content-type'] || 'application/json' },
        body: body.length > 0 ? body : undefined,
      });
      const response = await handler(request);
      res.writeHead(response.status, Object.fromEntries(response.headers));
      res.end(Buffer.from(await response.arrayBuffer()));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end(String(err && err.stack ? err.stack : err));
    }
  })
  .listen(RPC_PORT, '127.0.0.1');

// 保持进程存活，由测试父进程负责终止
setInterval(() => {}, 60_000);
