// 侧栏面板 ↔ 宿主 的同源 RPC 契约。
//
// 为什么需要这一层：
// client.js 是渲染在 DSH 页面里的浏览器代码。它以前直接跨源 fetch
// `http://127.0.0.1:8765/api/*`，那时控制面是裸的；现在控制面要求
// `x-peer-token`（见 index.js 的 authorizeControlPlane），而**凭据绝不该下发到
// 浏览器**——所以面板改走宿主 Connection 注册的同源路由：
//
//   浏览器 → 宿主 Connection（Host/Origin 围栏 + 会话 Cookie 鉴权）
//          → handlePanelRpc()（本模块定义的契约）
//          → 服务端用真实 token 走回环调自己的控制面
//
// 这一层是「代理」，所以必须有白名单：否则面板就成了一个能把任意路径打到
// 控制面的万能转发器（SSRF-lite）。白名单 + 参数规范化都在这里，方便单测。

/** 宿主 Connection 上注册的路由路径（不带前导斜杠，由 Connection 的 /api 前缀挂载）。 */
export const PANEL_RPC_ROUTE = 'api/peer-link.rpc';

/**
 * 允许面板调用的控制面接口。
 *
 * 只列 client.js 真正会用到的，多一条都不加——白名单的价值在于「短到能一眼看完」。
 * 值是该接口允许的 HTTP 方法集合。
 */
export const ALLOWED_CALLS = Object.freeze({
  '/api/status': ['GET'],
  '/api/profile': ['POST'],
  '/api/peers': ['POST', 'DELETE'],
  '/api/ping': ['POST'],
  '/api/scan': ['POST'],
  '/api/send': ['POST'],
  '/api/sessions': ['GET'],
  '/api/session': ['GET'],
});

/** 只有这些接口需要（且允许）携带查询串。 */
const QUERY_KEYS = Object.freeze({ '/api/session': 'file' });

export class PanelRpcError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'PanelRpcError';
    this.status = status;
  }
}

/**
 * 校验并规范化一次面板调用。
 *
 * @param {{endpoint?: unknown, method?: unknown, data?: unknown}} payload
 * @returns {{path: string, method: string, body: unknown}}
 * @throws {PanelRpcError} 调用不在白名单、方法不允许、或参数非法
 */
export function normalizeCall(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new PanelRpcError('请求体必须是 JSON 对象', 400);
  }

  const rawEndpoint = payload.endpoint;
  if (typeof rawEndpoint !== 'string' || !rawEndpoint) {
    throw new PanelRpcError('缺少 endpoint', 400);
  }

  // 同一路径只处理一次：`/api/x?y=1` 拆成 path + query，避免把查询串当路径白名单比对。
  const qIndex = rawEndpoint.indexOf('?');
  const pathname = qIndex === -1 ? rawEndpoint : rawEndpoint.slice(0, qIndex);
  const search = qIndex === -1 ? '' : rawEndpoint.slice(qIndex + 1);

  const methods = ALLOWED_CALLS[pathname];
  if (!methods) {
    throw new PanelRpcError(`不允许的接口: ${pathname}`, 403);
  }

  const method = String(payload.method ?? 'GET').toUpperCase();
  if (!methods.includes(method)) {
    throw new PanelRpcError(`${pathname} 不支持方法 ${method}`, 405);
  }

  // 查询串按接口白名单逐项校验：只允许声明过的键，且值必须是 basename
  // （`file=../../etc/passwd` 这类穿越在这里就挡掉，不指望下游 path.join 兜底）。
  let query = '';
  if (search) {
    const allowedKey = QUERY_KEYS[pathname];
    if (!allowedKey) {
      throw new PanelRpcError(`${pathname} 不接受查询参数`, 400);
    }
    const value = new URLSearchParams(search).get(allowedKey);
    if (!value) {
      throw new PanelRpcError(`缺少 ${allowedKey} 参数`, 400);
    }
    if (value !== basename(value)) {
      throw new PanelRpcError(`${allowedKey} 只能是文件名`, 400);
    }
    query = `?${allowedKey}=${encodeURIComponent(value)}`;
  }

  const body = method === 'GET' ? null : (payload.data ?? null);
  return { path: pathname + query, method, body };
}

/** 取路径最后一段（不 import node:path，纯字符串就能满足 basename 语义）。 */
function basename(value) {
  const parts = String(value).split(/[\\/]/);
  return parts[parts.length - 1];
}
