import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import dgram from 'node:dgram';

export const name = 'dsh-plugin-peer-link';
export const inject = ['tools', 'systemPrompt'];

function dshHomePath(...segments) {
  const override = process.env.DSH_HOME;
  const base = override && override.length > 0 ? override : path.join(os.homedir(), '.dsh');
  return path.join(path.resolve(base), ...segments);
}

const PEER_DIR = dshHomePath('peer-link');
const CONFIG_FILE = path.join(PEER_DIR, 'config.json');
const SESSIONS_DIR = path.join(PEER_DIR, 'sessions');
const LEDGER_FILE = path.join(PEER_DIR, 'ledger.jsonl');

function ensureDirs() {
  if (!fs.existsSync(PEER_DIR)) fs.mkdirSync(PEER_DIR, { recursive: true });
  if (!fs.existsSync(SESSIONS_DIR)) fs.mkdirSync(SESSIONS_DIR, { recursive: true });
}

function loadConfig() {
  ensureDirs();
  const defaultId = 'node-' + crypto.randomBytes(4).toString('hex');
  const defaultConf = {
    node: {
      id: defaultId,
      name: process.env.DSH_PEER_MY_NAME || 'Node-Alpha',
      avatar: '🤖',
      role: '全栈架构 · 移动端/UI',
    },
    listen_port: parseInt(process.env.DSH_PEER_PORT || '8765', 10),
    token: process.env.DSH_PEER_TOKEN || 'dsh-peer-secret-shared-token',
    peers: [
      {
        id: 'peer-default',
        name: process.env.DSH_PEER_TARGET_NAME || 'Node-Beta',
        avatar: '🖥',
        role: '后端服务 · 数据引擎',
        url: process.env.DSH_PEER_TARGET_URL || 'http://127.0.0.1:8766',
        token: process.env.DSH_PEER_TOKEN || 'dsh-peer-secret-shared-token',
        online: false,
        latencyMs: null,
        last_seen: null,
      }
    ]
  };

  if (!fs.existsSync(CONFIG_FILE)) {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(defaultConf, null, 2), 'utf-8');
    return defaultConf;
  }

  try {
    const raw = fs.readFileSync(CONFIG_FILE, 'utf-8');
    const parsed = JSON.parse(raw);
    // 兼容老版本迁移
    if (parsed.my_name && !parsed.node) {
      parsed.node = {
        id: defaultId,
        name: parsed.my_name,
        avatar: '🤖',
        role: '本地协同节点',
      };
    }
    if (parsed.peer_url && (!parsed.peers || parsed.peers.length === 0)) {
      parsed.peers = [
        {
          id: 'peer-legacy',
          name: parsed.peer_name || 'Node-Beta',
          avatar: '🖥',
          role: '对等节点',
          url: parsed.peer_url,
          token: parsed.token || 'dsh-peer-secret-shared-token',
          online: false,
          latencyMs: null,
          last_seen: null,
        }
      ];
    }
    return { ...defaultConf, ...parsed, node: { ...defaultConf.node, ...(parsed.node || {}) } };
  } catch {
    return defaultConf;
  }
}

function saveConfig(cfg) {
  ensureDirs();
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2), 'utf-8');
}

function getBroadcastAddresses() {
  const addresses = new Set(['255.255.255.255', '239.255.255.250', '127.0.0.1']);
  try {
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
      for (const iface of interfaces[name]) {
        if (iface.family === 'IPv4' && !iface.internal) {
          const parts = iface.address.split('.');
          if (parts.length === 4) {
            addresses.add(`${parts[0]}.${parts[1]}.${parts[2]}.255`);
          }
        }
      }
    }
  } catch {}
  return Array.from(addresses);
}

class PeerRadar {
  constructor(options) {
    this.port = options.port || 8764;
    this.getNode = options.getNode;
    this.onDiscovered = options.onDiscovered;
    this.socket = null;
    this.heartbeatTimer = null;
    this.cleanupTimer = null;
  }

  start() {
    try {
      this.socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
      this.socket.on('error', (err) => {
        // 端口冲突或网络错误容错
      });

      this.socket.on('message', (msg, rinfo) => {
        try {
          const packet = JSON.parse(msg.toString('utf-8'));
          if (packet.protocol !== 'dsh-peer-link') return;
          const myInfo = this.getNode();
          if (!myInfo || packet.nodeId === myInfo.id) return;
          if (myInfo.token && packet.token && myInfo.token !== packet.token) return;

          if (packet.action === 'announce' || packet.action === 'probe') {
            const peerUrl = `http://${rinfo.address}:${packet.httpPort}`;
            this.onDiscovered({
              id: packet.nodeId,
              name: packet.name,
              avatar: packet.avatar,
              role: packet.role,
              url: peerUrl,
              ip: rinfo.address,
              port: packet.httpPort,
              token: packet.token,
              online: true,
              last_seen: new Date().toISOString(),
              autoDiscovered: true,
            });

            if (packet.action === 'probe') {
              this.sendTo(rinfo.address, rinfo.port, 'announce');
            }
          } else if (packet.action === 'leave') {
            this.onDiscovered({
              id: packet.nodeId,
              url: `http://${rinfo.address}:${packet.httpPort}`,
              online: false,
              last_seen: new Date().toISOString(),
              autoDiscovered: true,
            });
          }
        } catch {}
      });

      this.socket.bind(this.port, () => {
        try {
          this.socket.setBroadcast(true);
          this.socket.addMembership('239.255.255.250');
          this.socket.setMulticastTTL(2);
          this.socket.setMulticastLoopback(true);
        } catch {}
        this.broadcast('announce');
      });

      this.heartbeatTimer = setInterval(() => {
        this.broadcast('announce');
      }, 15000);
    } catch {}
  }

  broadcast(action = 'announce') {
    if (!this.socket) return;
    try {
      const myInfo = this.getNode();
      if (!myInfo) return;
      const payload = Buffer.from(JSON.stringify({
        protocol: 'dsh-peer-link',
        version: '1.0',
        action,
        nodeId: myInfo.id,
        name: myInfo.name,
        avatar: myInfo.avatar,
        role: myInfo.role,
        httpPort: myInfo.activePort,
        token: myInfo.token,
      }));

      const addrs = getBroadcastAddresses();
      for (const addr of addrs) {
        this.socket.send(payload, 0, payload.length, this.port, addr, () => {});
      }
    } catch {}
  }

  sendTo(ip, port, action = 'announce') {
    if (!this.socket) return;
    try {
      const myInfo = this.getNode();
      if (!myInfo) return;
      const payload = Buffer.from(JSON.stringify({
        protocol: 'dsh-peer-link',
        version: '1.0',
        action,
        nodeId: myInfo.id,
        name: myInfo.name,
        avatar: myInfo.avatar,
        role: myInfo.role,
        httpPort: myInfo.activePort,
        token: myInfo.token,
      }));
      this.socket.send(payload, 0, payload.length, port, ip, () => {});
    } catch {}
  }

  stop() {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    if (this.socket) {
      try {
        this.broadcast('leave');
        this.socket.close();
      } catch {}
      this.socket = null;
    }
  }
}

function appendLedger(entry) {
  ensureDirs();
  const line = JSON.stringify({ ...entry, _ts: new Date().toISOString() }) + '\n';
  fs.appendFileSync(LEDGER_FILE, line, 'utf-8');
}

function readRecentLedger(limit = 20) {
  if (!fs.existsSync(LEDGER_FILE)) return [];
  try {
    const lines = fs.readFileSync(LEDGER_FILE, 'utf-8').trim().split('\n').filter(Boolean);
    const sliced = lines.slice(-limit).reverse();
    return sliced.map((l) => {
      try { return JSON.parse(l); } catch { return null; }
    }).filter(Boolean);
  } catch {
    return [];
  }
}

function recordSessionMarkdown({ traceId, sender, receiver, topic, message, context, reply, durationMs, status = 'completed' }) {
  ensureDirs();
  const dateStr = new Date().toISOString().slice(0, 10);
  const filePath = path.join(SESSIONS_DIR, `${dateStr}_${traceId}.md`);

  const senderTypeBadge = sender.type === 'human' ? '👤 【人类直接指令】' : '🤖 【智能体对等提议】';
  const md = `# 🤝 对等协作留痕会话: ${traceId}
- **记录时间**: ${new Date().toISOString()}
- **发起方**: ${sender.avatar || '💻'} **${sender.name}** (${senderTypeBadge})
- **角色定位**: ${sender.role || '未注明'}
- **接收方**: ${receiver.avatar || '🖥'} **${receiver.name}** (${receiver.role || '对等端'})
- **沟通主题**: ${topic}
- **会话状态**: ${status}
- **耗时**: ${durationMs}ms

---

## 📤 发送内容 / 提议草案
${message}
${context ? `\n### 附带上下文 / 代码证据\n\`\`\`\n${context}\n\`\`\`\n` : ''}

---

## 📥 接收答复 / 协商共识
${reply}

---
*由 DSH Peer Link 插件双端自动审计落盘 · 确保跨电脑双端无歧义*
`;

  fs.writeFileSync(filePath, md, 'utf-8');
  return filePath;
}

// 自动学习/更新对端信息到本地花名册
function upsertPeer(cfg, peerData) {
  if (!peerData || !peerData.url) return;
  const normalizedUrl = peerData.url.replace(/\/+$/, '');
  const existingIndex = cfg.peers.findIndex(
    (p) => (peerData.id && p.id === peerData.id) || p.url.replace(/\/+$/, '') === normalizedUrl
  );

  const now = new Date().toISOString();
  if (existingIndex >= 0) {
    const current = cfg.peers[existingIndex];
    cfg.peers[existingIndex] = {
      ...current,
      name: peerData.name || current.name,
      avatar: peerData.avatar || current.avatar,
      role: peerData.role || current.role,
      id: peerData.id || current.id,
      url: normalizedUrl,
      last_seen: now,
      online: true,
      latencyMs: peerData.latencyMs !== undefined ? peerData.latencyMs : current.latencyMs,
    };
  } else {
    cfg.peers.push({
      id: peerData.id || ('peer-' + crypto.randomBytes(3).toString('hex')),
      name: peerData.name || '新对等节点',
      avatar: peerData.avatar || '🖥',
      role: peerData.role || '局域网协作者',
      url: normalizedUrl,
      token: peerData.token || cfg.token || '',
      online: true,
      latencyMs: peerData.latencyMs || null,
      last_seen: now,
    });
  }
  saveConfig(cfg);
}

// 发起跨机网络请求
async function postJson(url, data, timeoutMs = 20000) {
  const parsed = new URL(url);
  const bodyStr = JSON.stringify(data);
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: parsed.hostname,
        port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
        path: parsed.pathname + (parsed.search || ''),
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(bodyStr),
        },
      },
      (res) => {
        let respBody = '';
        res.on('data', (c) => (respBody += c));
        res.on('end', () => {
          try {
            resolve({ statusCode: res.statusCode, data: JSON.parse(respBody) });
          } catch {
            resolve({ statusCode: res.statusCode, raw: respBody });
          }
        });
      }
    );
    req.on('error', (err) => reject(err));
    req.setTimeout(timeoutMs, () => {
      req.destroy();
      reject(new Error(`连接对端超时 (${timeoutMs}ms)`));
    });
    req.write(bodyStr);
    req.end();
  });
}

async function pingPeer(cfg, targetPeer) {
  const start = Date.now();
  const targetUrl = `${targetPeer.url.replace(/\/+$/, '')}/health`;
  try {
    const parsed = new URL(targetUrl);
    const resp = await new Promise((resolve, reject) => {
      const req = http.get(
        {
          hostname: parsed.hostname,
          port: parsed.port || 80,
          path: parsed.pathname,
          timeout: 4000,
        },
        (res) => {
          let str = '';
          res.on('data', (c) => (str += c));
          res.on('end', () => {
            try { resolve(JSON.parse(str)); } catch { resolve({}); }
          });
        }
      );
      req.on('error', (err) => reject(err));
      req.setTimeout(4000, () => {
        req.destroy();
        reject(new Error('探测超时'));
      });
    });

    const latency = Date.now() - start;
    upsertPeer(cfg, {
      ...targetPeer,
      id: resp.node?.id || targetPeer.id,
      name: resp.node?.name || targetPeer.name,
      avatar: resp.node?.avatar || targetPeer.avatar,
      role: resp.node?.role || targetPeer.role,
      online: true,
      latencyMs: latency,
    });
    return { ok: true, latencyMs: latency, info: resp };
  } catch (err) {
    upsertPeer(cfg, {
      ...targetPeer,
      online: false,
      latencyMs: null,
    });
    return { ok: false, error: err.message };
  }
}

// 核心应用主入口
export function apply(ctx) {
  let cfg = loadConfig();
  let server = null;
  let activePort = cfg.listen_port;
  let radar = null;

  // 1. 启动本地监听服务
  function renderDashboardHtml() {
    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <title>🤝 DSH Peer Link 控制中心</title>
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: #0d1117;
      color: #c9d1d9;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      padding: 24px;
      line-height: 1.5;
    }
    .container { max-width: 1080px; margin: 0 auto; }
    header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding-bottom: 20px;
      border-bottom: 1px solid #30363d;
      margin-bottom: 24px;
    }
    h1 { font-size: 20px; font-weight: 600; color: #58a6ff; display: flex; align-items: center; gap: 8px; }
    .badge {
      font-size: 12px;
      padding: 3px 8px;
      border-radius: 12px;
      font-weight: 500;
    }
    .badge-green { background: rgba(46,160,67,0.15); color: #3fb950; border: 1px solid #238636; }
    .badge-purple { background: rgba(163,113,247,0.15); color: #a371f7; border: 1px solid #8957e5; }
    .btn {
      background: #21262d;
      border: 1px solid #30363d;
      color: #c9d1d9;
      padding: 6px 14px;
      border-radius: 6px;
      cursor: pointer;
      font-size: 13px;
      transition: all 0.2s;
    }
    .btn:hover { background: #30363d; border-color: #8b949e; }
    .btn-primary { background: #238636; border-color: #2ea043; color: #fff; }
    .btn-primary:hover { background: #2ea043; }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 24px; }
    .card {
      background: #161b22;
      border: 1px solid #30363d;
      border-radius: 8px;
      padding: 18px;
    }
    .card-title {
      font-size: 14px;
      font-weight: 600;
      color: #f0f6fc;
      margin-bottom: 14px;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .peer-item {
      background: #0d1117;
      border: 1px solid #30363d;
      border-radius: 6px;
      padding: 12px;
      margin-bottom: 10px;
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .peer-left { display: flex; align-items: center; gap: 12px; }
    .peer-avatar { font-size: 24px; }
    .peer-name { font-weight: 600; color: #f0f6fc; font-size: 14px; }
    .peer-sub { font-size: 12px; color: #8b949e; }
    .input-row { margin-bottom: 12px; }
    label { display: block; font-size: 12px; color: #8b949e; margin-bottom: 4px; }
    input, textarea {
      width: 100%;
      background: #0d1117;
      border: 1px solid #30363d;
      color: #f0f6fc;
      padding: 8px 10px;
      border-radius: 6px;
      font-size: 13px;
    }
    table { width: 100%; border-collapse: collapse; font-size: 12px; margin-top: 10px; }
    th, td { text-align: left; padding: 8px 10px; border-bottom: 1px solid #21262d; }
    th { color: #8b949e; font-weight: 500; }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <h1>🤝 DSH Peer Link 控制中心 <span id="onlineCountBadge" class="badge badge-green">加载中...</span></h1>
      <div style="display:flex; gap:8px;">
        <button class="btn" onclick="scanRadar()">📡 局域网雷达扫描</button>
        <button class="btn" onclick="loadData()">🔄 刷新</button>
      </div>
    </header>

    <div class="grid">
      <!-- 本机名片 -->
      <div class="card">
        <div class="card-title">
          <span>🧠 本机节点档案 (My Identity)</span>
          <button class="btn" style="padding:2px 8px; font-size:11px;" onclick="saveMyProfile()">保存名片</button>
        </div>
        <div class="input-row">
          <label>节点名称</label>
          <input id="my_name" value="">
        </div>
        <div style="display:flex; gap:12px;" class="input-row">
          <div style="flex:1;">
            <label>头像 Emoji</label>
            <input id="my_avatar" value="">
          </div>
          <div style="flex:2;">
            <label>职责角色</label>
            <input id="my_role" value="">
          </div>
        </div>
        <div class="input-row">
          <label>共享认证密钥 (Token)</label>
          <input id="my_token" type="password" value="">
        </div>
      </div>

      <!-- 人类直接发信 -->
      <div class="card">
        <div class="card-title">
          <span>👤 人类直接指令下发 (Direct Command)</span>
        </div>
        <div class="input-row">
          <label>目标电脑</label>
          <select id="send_target" style="width:100%; background:#0d1117; border:1px solid #30363d; color:#fff; padding:6px; border-radius:6px; font-size:13px;">
            <option value="all">📡 局域网全网广播 (All Peers)</option>
          </select>
        </div>
        <div class="input-row">
          <label>指令主题</label>
          <input id="send_topic" placeholder="例如：用户中心 API 字段规范确认">
        </div>
        <div class="input-row">
          <label>指令内容</label>
          <textarea id="send_message" rows="2" placeholder="输入要下发给对端 DSH 的任务或说明..."></textarea>
        </div>
        <div style="text-align:right;">
          <button class="btn btn-primary" onclick="sendMessage()">🚀 发送人类指令</button>
        </div>
      </div>
    </div>

    <!-- 局域网在线花名册 -->
    <div class="card" style="margin-bottom:24px;">
      <div class="card-title">
        <span>🌐 局域网发现与对等通讯录 (Peers Roster)</span>
        <button class="btn" style="padding:2px 8px; font-size:11px;" onclick="addManualPeer()">+ 手动添加</button>
      </div>
      <div id="peerList">加载中...</div>
    </div>

    <!-- 双端对账流水 -->
    <div class="card">
      <div class="card-title">
        <span>📜 实时双端对账流水账本 (Trace Ledger)</span>
      </div>
      <table>
        <thead>
          <tr>
            <th>流向</th>
            <th>发信角色</th>
            <th>对端节点</th>
            <th>主题</th>
            <th>耗时</th>
            <th>Trace ID</th>
          </tr>
        </thead>
        <tbody id="ledgerBody"></tbody>
      </table>
    </div>
  </div>

  <script>
    async function loadData() {
      try {
        const res = await fetch('/api/status');
        const data = await res.json();
        if (!data.ok) return;

        document.getElementById('my_name').value = data.node.name || '';
        document.getElementById('my_avatar').value = data.node.avatar || '🤖';
        document.getElementById('my_role').value = data.node.role || '';
        document.getElementById('my_token').value = data.token || '';

        const peers = data.peers || [];
        const onlineCount = peers.filter(p => p.online).length;
        document.getElementById('onlineCountBadge').innerText = onlineCount + ' 台在线';

        // 渲染 target 下拉框
        const targetSel = document.getElementById('send_target');
        targetSel.innerHTML = '<option value="all">📡 局域网全网广播 (All Peers)</option>';
        peers.forEach(p => {
          targetSel.innerHTML += '<option value="' + p.name + '">' + (p.avatar || '🖥') + ' ' + p.name + ' (' + p.url + ')</option>';
        });

        // 渲染 Peer 列表
        const listDiv = document.getElementById('peerList');
        if (peers.length === 0) {
          listDiv.innerHTML = '<div style="color:#8b949e; text-align:center; padding:16px;">局域网内暂未发现其他 DSH 节点，请确认对方已安装本插件并开机。</div>';
        } else {
          listDiv.innerHTML = peers.map(p => \`
            <div class="peer-item">
              <div class="peer-left">
                <div class="peer-avatar">\${p.avatar || '🖥'}</div>
                <div>
                  <div class="peer-name">\${p.name} \${p.autoDiscovered ? '<span class="badge badge-purple" style="font-size:10px;">📡 雷达发现</span>' : ''}</div>
                  <div class="peer-sub">\${p.role || '对等端'} · \${p.url}</div>
                </div>
              </div>
              <div style="display:flex; align-items:center; gap:8px;">
                <span class="badge \${p.online ? 'badge-green' : 'badge-offline'}">\${p.online ? (p.latencyMs ? p.latencyMs + 'ms' : '在线') : '离线'}</span>
                <button class="btn" style="padding:3px 8px; font-size:11px;" onclick="pingPeer('\${p.id || p.url}')">⚡ 探测</button>
              </div>
            </div>
          \`).join('');
        }

        // 渲染流水
        const ledgerBody = document.getElementById('ledgerBody');
        const ledger = data.recentLedger || [];
        ledgerBody.innerHTML = ledger.map(item => \`
          <tr>
            <td>\${item.direction === 'outbound' ? '📤 出站' : '📥 入站'}</td>
            <td><span class="badge \${item.sender_type === 'human' ? 'badge-green' : 'badge-purple'}">\${item.sender_type === 'human' ? '👤 人类' : '🤖 Agent'}</span></td>
            <td>\${item.peer || ''}</td>
            <td>\${item.topic || ''}</td>
            <td>\${item.durationMs ? item.durationMs + 'ms' : '-'}</td>
            <td style="font-family:monospace; color:#8b949e;">\${item.trace_id}</td>
          </tr>
        \`).join('');
      } catch (e) {
        console.error(e);
      }
    }

    async function scanRadar() {
      try {
        await fetch('/api/scan', { method: 'POST' });
        setTimeout(loadData, 700);
      } catch (e) { alert(e.message); }
    }

    async function pingPeer(peerId) {
      try {
        const res = await fetch('/api/ping', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ peerId })
        });
        const d = await res.json();
        alert(d.ok && d.result?.ok ? '连通成功！延迟: ' + d.result.durationMs + 'ms' : '探测失败: ' + (d.result?.error || '无法连通'));
        loadData();
      } catch (e) { alert(e.message); }
    }

    async function saveMyProfile() {
      try {
        await fetch('/api/profile', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: document.getElementById('my_name').value,
            avatar: document.getElementById('my_avatar').value,
            role: document.getElementById('my_role').value,
            token: document.getElementById('my_token').value
          })
        });
        alert('名片已保存');
        loadData();
      } catch (e) { alert(e.message); }
    }

    async function sendMessage() {
      const topic = document.getElementById('send_topic').value;
      const message = document.getElementById('send_message').value;
      const target = document.getElementById('send_target').value;
      if (!topic || !message) return alert('请填写主题和内容');

      try {
        const res = await fetch('/api/send', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ topic, message, target, asHuman: true })
        });
        const d = await res.json();
        if (d.ok) {
          alert('指令发送成功！Trace ID: ' + d.result?.trace_id);
          document.getElementById('send_topic').value = '';
          document.getElementById('send_message').value = '';
          loadData();
        } else {
          alert('发送失败: ' + d.error);
        }
      } catch (e) { alert(e.message); }
    }

    async function addManualPeer() {
      const name = prompt('请输入电脑名称:');
      if (!name) return;
      const url = prompt('请输入对端 URL (例如 http://192.168.1.100:8765):');
      if (!url) return;
      await fetch('/api/peers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, url })
      });
      loadData();
    }

    loadData();
    setInterval(loadData, 5000);
  </script>
</body>
</html>`;
  }

  function startHttpServer(port) {
    const srv = http.createServer(async (req, res) => {
      // 允许跨域（本地 Web GUI 访问）
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-peer-token');

      if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
      }

      const reqUrl = new URL(req.url, `http://${req.headers.host || '127.0.0.1'}`);

      // 探针接口
      if (req.method === 'GET' && reqUrl.pathname === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            status: 'ok',
            node: cfg.node,
            port: activePort,
            peersCount: cfg.peers.length,
            time: new Date().toISOString(),
          })
        );
        return;
      }

      // Web 前端 API: 获取完整状态与花名册
      if (req.method === 'GET' && reqUrl.pathname === '/api/status') {
        cfg = loadConfig();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          ok: true,
          node: cfg.node,
          activePort,
          token: cfg.token,
          peers: cfg.peers,
          recentLedger: readRecentLedger(15),
        }));
        return;
      }

      // Web 前端 API: 更新本节点名片 (Profile)
      if (req.method === 'POST' && reqUrl.pathname === '/api/profile') {
        let body = '';
        req.on('data', (c) => (body += c));
        req.on('end', () => {
          try {
            const data = JSON.parse(body || '{}');
            if (data.name) cfg.node.name = data.name;
            if (data.avatar) cfg.node.avatar = data.avatar;
            if (data.role) cfg.node.role = data.role;
            if (data.token !== undefined) cfg.token = data.token;
            saveConfig(cfg);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: true, node: cfg.node }));
          } catch (e) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: false, error: e.message }));
          }
        });
        return;
      }

      // Web 前端 API: 添加或修改对等节点
      if (req.method === 'POST' && reqUrl.pathname === '/api/peers') {
        let body = '';
        req.on('data', (c) => (body += c));
        req.on('end', () => {
          try {
            const data = JSON.parse(body || '{}');
            if (!data.url) throw new Error('缺少对端 URL');
            upsertPeer(cfg, data);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: true, peers: cfg.peers }));
          } catch (e) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: false, error: e.message }));
          }
        });
        return;
      }

      // Web 前端 API: 删除对等节点
      if (req.method === 'DELETE' && reqUrl.pathname === '/api/peers') {
        let body = '';
        req.on('data', (c) => (body += c));
        req.on('end', () => {
          try {
            const data = JSON.parse(body || '{}');
            cfg.peers = cfg.peers.filter((p) => p.id !== data.id && p.url !== data.url);
            saveConfig(cfg);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: true, peers: cfg.peers }));
          } catch (e) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: false, error: e.message }));
          }
        });
        return;
      }

      // Web 前端 API: 探测对端连通性
      if (req.method === 'POST' && reqUrl.pathname === '/api/ping') {
        let body = '';
        req.on('data', (c) => (body += c));
        req.on('end', async () => {
          try {
            const data = JSON.parse(body || '{}');
            const target = data.peerId ? cfg.peers.find((p) => p.id === data.peerId) : cfg.peers[0];
            if (!target) throw new Error('未找到指定对等节点');
            const result = await pingPeer(cfg, target);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: true, result, peers: cfg.peers }));
          } catch (e) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: false, error: e.message }));
          }
        });
        return;
      }

      // Web 前端 API: 人类直接在 Web 发信
      if (req.method === 'POST' && reqUrl.pathname === '/api/send') {
        let body = '';
        req.on('data', (c) => (body += c));
        req.on('end', async () => {
          try {
            const data = JSON.parse(body || '{}');
            const target = data.peerId ? cfg.peers.find((p) => p.id === data.peerId) : cfg.peers[0];
            if (!target) throw new Error('未找到指定对等节点');

            const traceId = `trace-${new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)}-${crypto.randomBytes(3).toString('hex')}`;
            const startMs = Date.now();
            const senderEnvelope = {
              id: cfg.node.id,
              name: cfg.node.name,
              avatar: cfg.node.avatar,
              role: cfg.node.role,
              type: data.as_human !== false ? 'human' : 'agent',
              url: `http://${os.hostname()}:${activePort}`,
            };

            const postUrl = `${target.url.replace(/\/+$/, '')}/talk`;
            const resp = await postJson(postUrl, {
              trace_id: traceId,
              sender: senderEnvelope,
              target: target.name,
              topic: data.topic || 'Web控制台人工发信',
              message: data.message,
              context: data.context || '',
              token: target.token || cfg.token,
              intent: senderEnvelope.type === 'human' ? 'command' : 'proposal',
            });

            const durationMs = Date.now() - startMs;
            const resData = resp.data || {};
            const replyText = resData.reply || `HTTP ${resp.statusCode}`;

            upsertPeer(cfg, { ...target, online: true, latencyMs: durationMs });

            const sessionPath = recordSessionMarkdown({
              traceId,
              sender: senderEnvelope,
              receiver: target,
              topic: data.topic || 'Web控制台人工发信',
              message: data.message,
              context: data.context || '',
              reply: replyText,
              durationMs,
              status: 'completed',
            });

            appendLedger({
              trace_id: traceId,
              direction: 'outbound',
              sender_type: senderEnvelope.type,
              peer: target.name,
              topic: data.topic || '人工发信',
              durationMs,
              sessionPath,
            });

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
              ok: true,
              trace_id: traceId,
              reply: replyText,
              durationMs,
              sessionPath,
            }));
          } catch (e) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: false, error: e.message }));
          }
        });
        return;
      }

      // Web 前端 API: 局域网 UDP 雷达主动扫描
      if (req.method === 'POST' && reqUrl.pathname === '/api/scan') {
        if (radar) {
          radar.broadcast('probe');
        }
        setTimeout(() => {
          cfg = loadConfig();
        }, 500);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, message: '局域网雷达探测广播已发送' }));
        return;
      }

      // Web 前端 API: 历史会话列表与详情
      if (req.method === 'GET' && reqUrl.pathname === '/api/sessions') {
        try {
          const files = fs.readdirSync(SESSIONS_DIR).filter((f) => f.endsWith('.md')).reverse();
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, sessions: files.slice(0, 30) }));
        } catch {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, sessions: [] }));
        }
        return;
      }

      if (req.method === 'GET' && reqUrl.pathname === '/api/session') {
        const file = reqUrl.searchParams.get('file');
        const safePath = path.join(SESSIONS_DIR, path.basename(file || ''));
        if (fs.existsSync(safePath)) {
          const content = fs.readFileSync(safePath, 'utf-8');
          res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
          res.end(content);
        } else {
          res.writeHead(404, { 'Content-Type': 'text/plain' });
          res.end('Not found');
        }
        return;
      }

      // 核心跨机协商通信接口 /talk (双向通信)
      if (req.method === 'POST' && reqUrl.pathname === '/talk') {
        let body = '';
        req.on('data', (chunk) => (body += chunk));
        req.on('end', async () => {
          try {
            const payload = JSON.parse(body || '{}');
            const { trace_id, sender, topic, message, context, token, intent = 'proposal' } = payload;

            // 安全 Token 校验
            if (cfg.token && token && token !== cfg.token) {
              res.writeHead(401, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ ok: false, error: 'Token 认证失败: 密钥不匹配' }));
              return;
            }

            const senderObj = sender || { name: '远端节点', avatar: '💻', role: '协作者', type: 'agent' };

            // 自动学习对方节点信息，充实本地通讯录 (Roster Auto-Learning)
            if (senderObj.url || req.headers.host) {
              const remoteIp = req.socket.remoteAddress;
              const guessedUrl = senderObj.url || `http://${remoteIp}:${activePort}`;
              upsertPeer(cfg, {
                id: senderObj.id,
                name: senderObj.name,
                avatar: senderObj.avatar,
                role: senderObj.role,
                url: guessedUrl,
                online: true,
              });
            }

            // 区分人类发出的消息 vs 智能体发出的消息
            const isHuman = senderObj.type === 'human';
            const traceId = trace_id || `trace-${Date.now()}`;

            // 生成协商回复内容
            let replyContent = '';
            if (isHuman) {
              replyContent = `【${cfg.node.name} · 智能体响应指令】\n- 指令类型: 来自人类操作者的顶层业务指示 (来自 ${senderObj.avatar || '👤'} ${senderObj.name})\n- 接收状态: 已接收并纳入当前工作区最高优先级执行规划。\n- 确认主题: “${topic}”\n- 正文反馈: “${message}” 已由本端 DSH 理解并落盘准备推进。`;
            } else {
              replyContent = `【${cfg.node.name} · 对等智能体协商响应】\n- 协同类型: 同级智能体跨机技术对齐\n- 来源对端: ${senderObj.avatar || '🤖'} ${senderObj.name} (${senderObj.role || '对等端'})\n- 确认主题: ${topic}\n- 处理结果: 已成功接收对端提议与代码上下文，已存入本地审计留痕，双方契约已同步。`;
            }

            // 落盘双端留痕文件
            const sessionPath = recordSessionMarkdown({
              traceId,
              sender: senderObj,
              receiver: cfg.node,
              topic: topic || '对等协作通信',
              message: message || '',
              context: context || '',
              reply: replyContent,
              durationMs: 0,
              status: 'completed',
            });

            appendLedger({
              trace_id: traceId,
              direction: 'inbound',
              sender_type: senderObj.type || 'agent',
              peer: senderObj.name,
              topic: topic || '对等通信',
              sessionPath,
            });

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(
              JSON.stringify({
                ok: true,
                trace_id: traceId,
                responder: {
                  ...cfg.node,
                  type: 'agent',
                },
                reply: replyContent,
                sessionPath,
                timestamp: new Date().toISOString(),
              })
            );
          } catch (err) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: false, error: err.message }));
          }
        });
        return;
      }

      // 7. 独立 Web 控制台页面
      if ((req.url === '/' || req.url === '/dashboard') && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(renderDashboardHtml());
        return;
      }

      // 未知路由
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not Found');
    });

    srv.on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        const nextPort = port + 1;
        srv.close();
        startHttpServer(nextPort);
      }
    });

    srv.listen(port, '0.0.0.0', () => {
      activePort = port;
      try {
        fs.writeFileSync(path.join(PEER_DIR, 'active_port.json'), JSON.stringify({ port: activePort }), 'utf-8');
      } catch {}
    });

    return srv;
  }

  server = startHttpServer(cfg.listen_port);

  // 启动局域网 UDP 自动雷达发现服务
  radar = new PeerRadar({
    port: 8764,
    getNode: () => ({
      id: cfg.node.id,
      name: cfg.node.name,
      avatar: cfg.node.avatar,
      role: cfg.node.role,
      activePort,
      token: cfg.token,
    }),
    onDiscovered: (info) => {
      cfg = loadConfig();
      const existing = cfg.peers.find((p) => p.id === info.id || p.url === info.url);
      if (existing) {
        if (info.name) existing.name = info.name;
        if (info.avatar) existing.avatar = info.avatar;
        if (info.role) existing.role = info.role;
        existing.online = info.online !== false;
        existing.last_seen = info.last_seen;
        existing.autoDiscovered = true;
      } else if (info.online !== false) {
        cfg.peers.push({
          id: info.id || `peer-${Date.now().toString(16)}`,
          name: info.name || '局域网自动发现节点',
          avatar: info.avatar || '🖥',
          role: info.role || '对等端',
          url: info.url,
          token: info.token || cfg.token,
          online: true,
          latencyMs: 1,
          last_seen: info.last_seen,
          autoDiscovered: true,
        });
      }
      saveConfig(cfg);
    },
  });
  radar.start();

  // 2. 注入系统 Prompt 提示词
  if (typeof ctx.systemPrompt?.context === 'function') {
    try {
      ctx.systemPrompt.context({
        name: 'dsh-plugin-peer-link',
        order: 15,
        text() {
          cfg = loadConfig();
          const peersSummary = cfg.peers
            .map((p) => `• [${p.avatar || '🖥'}] ${p.name} (${p.role || '对等节点'}, URL: ${p.url}, 状态: ${p.online ? '🟢在线' : '⚪离线'})`)
            .join('\n');

          return `【DSH 分布式对等协同网络 (Peer Link)】
当前节点身份: ${cfg.node.avatar || '🤖'} ${cfg.node.name} (角色: ${cfg.node.role || '智能体'}, 本地监听端口: ${activePort})
已知对等节点通讯录 (Roster):
${peersSummary || '• 暂无对等节点，可通过 peer_status 进行发现或添加'}

跨机协同纪律与规则:
1. 区分人类与智能体: 消息带有 sender.type (human 为人类终审指令，agent 为智能体同级探讨)。
2. 主动核对契约: 涉及跨机 API、数据结构、架构决策时，使用 \`peer_talk\` 向对端发起核对。
3. 支持定向发送: peer_talk 支持 target 参数，可指定发送给某个具体的对端名称。
4. 全程审计留痕: 每次跨机交流均会自动生成全局 Trace ID 并双端留痕。`;
        },
      });
    } catch {}
  }

  // 3. 注册工具: peer_talk
  ctx.tools?.register({
    name: 'peer_talk',
    description: '向局域网或远程另一台电脑上的 DSH 发起对等协作、接口核对、架构商讨或指令派发，支持多对端路由与身份染色。',
    parameters: {
      type: 'object',
      properties: {
        topic: {
          type: 'string',
          description: '沟通主题（例如：“用户中心 API 字段规范确认”或“数据库迁移联调”）。',
        },
        message: {
          type: 'string',
          description: '发送给对端 DSH 的沟通正文、问题说明、方案草案或具体提议。',
        },
        target: {
          type: 'string',
          description: '可选：目标对等节点名称或 URL。缺省发送给当前首选对端；传 "all" 为全网广播。',
        },
        as_human: {
          type: 'boolean',
          description: '可选：是否代表人类操作者下达指令。true=人类直接指令(human)；false=智能体对等探讨(agent，缺省)。',
        },
        context: {
          type: 'string',
          description: '可选：附带的上下文片段、代码示例或结构定义。',
        },
      },
      required: ['topic', 'message'],
    },
    output: {
      schema: {},
      render: (_args, value) => {
        const v = value || {};
        if (v.ok) {
          const lines = [
            `🤝【对等协作已响应 · ${v.responder?.avatar || '🖥'} ${v.responder?.name || v.peer || '对端节点'}】`,
            `📌 主题: ${v.topic || ''} (Trace: ${v.trace_id || ''}, 耗时: ${v.durationMs}ms)`,
            `🏷 身份信封: ${v.sender_type === 'human' ? '👤 人类直接指令' : '🤖 智能体同级协商'}`,
            ``,
            `📥 答复内容:`,
            v.reply || '',
            ``,
            `📄 本地对账归档: ${v.audit_session_file || ''}`
          ];
          return [{ type: 'text', text: lines.join('\n') }];
        }
        return [{
          type: 'text',
          text: `❌【对等协作失败】\n错误: ${v.error || '未知错误'}\nTrace: ${v.trace_id || ''}\n建议: ${v.suggestion || ''}`
        }];
      }
    },
    async execute(args) {
      cfg = loadConfig();
      const topic = args.topic;
      const message = args.message;
      const context = args.context || '';
      const asHuman = args.as_human === true;
      const targetQuery = args.target;

      let targetPeers = [];
      if (targetQuery === 'all') {
        targetPeers = cfg.peers;
      } else if (targetQuery) {
        const found = cfg.peers.find(
          (p) => p.name.toLowerCase().includes(targetQuery.toLowerCase()) || p.url.includes(targetQuery) || p.id === targetQuery
        );
        targetPeers = found ? [found] : [{ name: targetQuery, url: targetQuery, token: cfg.token }];
      } else {
        targetPeers = cfg.peers.length > 0 ? [cfg.peers[0]] : [];
      }

      if (targetPeers.length === 0) {
        return {
          ok: false,
          error: '通讯录中无有效对等节点',
          suggestion: '请使用 peer_status 添加对端电脑的 IP 和端口。',
        };
      }

      const senderEnvelope = {
        id: cfg.node.id,
        name: cfg.node.name,
        avatar: cfg.node.avatar,
        role: cfg.node.role,
        type: asHuman ? 'human' : 'agent',
        url: `http://${os.hostname()}:${activePort}`,
      };

      if (targetQuery === 'all' && targetPeers.length > 1) {
        const traceId = `trace-broadcast-${new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)}-${crypto.randomBytes(3).toString('hex')}`;
        const startMs = Date.now();
        const broadcastResults = await Promise.all(
          targetPeers.map(async (peer) => {
            try {
              const postUrl = `${peer.url.replace(/\/+$/, '')}/talk`;
              const res = await postJson(postUrl, {
                trace_id: traceId,
                sender: senderEnvelope,
                target: peer.name,
                topic,
                message,
                context,
                token: peer.token || cfg.token,
                intent: asHuman ? 'command' : 'proposal',
              });
              const replyText = res.data?.reply || (res.statusCode === 200 ? '已处理' : `HTTP ${res.statusCode}`);
              upsertPeer(cfg, { ...peer, online: true, last_seen: new Date().toISOString() });
              return { peer: peer.name, ok: res.statusCode === 200, reply: replyText };
            } catch (err) {
              upsertPeer(cfg, { ...peer, online: false });
              return { peer: peer.name, ok: false, error: err.message };
            }
          })
        );
        const durationMs = Date.now() - startMs;
        const repliesSummary = broadcastResults
          .map((r) => `• [${r.peer}]: ${r.ok ? r.reply : '失败 (' + r.error + ')'}`)
          .join('\n');

        const sessionPath = recordSessionMarkdown({
          traceId,
          sender: senderEnvelope,
          receiver: { name: '局域网集群广播 (All Peers)', avatar: '📡', role: `${targetPeers.length} 个节点` },
          topic,
          message,
          context,
          reply: repliesSummary,
          durationMs,
          status: 'completed',
        });

        appendLedger({
          trace_id: traceId,
          direction: 'outbound',
          sender_type: senderEnvelope.type,
          peer: `广播 (${targetPeers.length}节点)`,
          topic,
          durationMs,
          sessionPath,
        });

        return {
          ok: true,
          broadcast: true,
          trace_id: traceId,
          topic,
          target_node: `集群广播 (${targetPeers.length} 台电脑)`,
          sender: `${senderEnvelope.avatar || '🤖'} ${senderEnvelope.name}`,
          is_human: asHuman,
          reply: repliesSummary,
          audit_session_file: sessionPath,
        };
      }

      const targetPeer = targetPeers[0];
      const traceId = `trace-${new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)}-${crypto.randomBytes(3).toString('hex')}`;
      const startMs = Date.now();

      try {
        const postUrl = `${targetPeer.url.replace(/\/+$/, '')}/talk`;
        const res = await postJson(postUrl, {
          trace_id: traceId,
          sender: senderEnvelope,
          target: targetPeer.name,
          topic,
          message,
          context,
          token: targetPeer.token || cfg.token,
          intent: asHuman ? 'command' : 'proposal',
        });

        const durationMs = Date.now() - startMs;
        const resData = res.data || {};
        const replyText = resData.reply || (res.statusCode === 200 ? '对端已接收并处理' : `HTTP ${res.statusCode}`);

        // 自动更新该对端的在线状态与延迟
        upsertPeer(cfg, {
          ...targetPeer,
          online: true,
          latencyMs: durationMs,
          last_seen: new Date().toISOString(),
        });

        const sessionPath = recordSessionMarkdown({
          traceId,
          sender: senderEnvelope,
          receiver: targetPeer,
          topic,
          message,
          context,
          reply: replyText,
          durationMs,
          status: 'completed',
        });

        appendLedger({
          trace_id: traceId,
          direction: 'outbound',
          sender_type: senderEnvelope.type,
          peer: targetPeer.name,
          topic,
          durationMs,
          sessionPath,
        });

        return {
          ok: true,
          trace_id: traceId,
          peer: targetPeer.name,
          responder: resData.responder || targetPeer,
          sender_type: senderEnvelope.type,
          topic,
          durationMs,
          reply: replyText,
          audit_session_file: sessionPath,
        };
      } catch (err) {
        const durationMs = Date.now() - startMs;
        upsertPeer(cfg, {
          ...targetPeer,
          online: false,
          latencyMs: null,
        });

        const sessionPath = recordSessionMarkdown({
          traceId,
          sender: senderEnvelope,
          receiver: targetPeer,
          topic,
          message,
          context,
          reply: `[网络通信异常] ${err.message}`,
          durationMs,
          status: 'failed',
        });

        appendLedger({
          trace_id: traceId,
          direction: 'outbound',
          sender_type: senderEnvelope.type,
          peer: targetPeer.name,
          topic,
          durationMs,
          sessionPath,
          status: 'failed',
        });

        return {
          ok: false,
          trace_id: traceId,
          peer: targetPeer.name,
          error: err.message,
          audit_session_file: sessionPath,
          suggestion: '请确认对端电脑上的 DSH 已启动，且 IP、端口和防火墙配置正确。',
        };
      }
    },
  });

  // 4. 注册工具: peer_status
  ctx.tools?.register({
    name: 'peer_status',
    description: '管理分布式对等节点：查看花名册状态、连通性探测(ping)、修改本地身份名片、添加/删除对端电脑。',
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['status', 'test_ping', 'update_profile', 'add_peer', 'remove_peer', 'recent_sessions', 'scan'],
          description: '操作类型: status(查看状态与花名册), scan(局域网UDP雷达主动扫描发现), test_ping(探测对端), update_profile(更新本机名片), add_peer(添加对端), remove_peer(删除对端), recent_sessions(近期留痕流水)。',
        },
        peer_name: {
          type: 'string',
          description: '对端电脑名称（用于 add_peer 或 test_ping）。',
        },
        peer_url: {
          type: 'string',
          description: '对端电脑 URL（例如 http://192.168.1.100:8765）。',
        },
        my_name: {
          type: 'string',
          description: '本机节点显示名称（用于 update_profile）。',
        },
        my_avatar: {
          type: 'string',
          description: '本机头像 Emoji 或图标（例如 🤖, 💻, 🧠, ⚡）。',
        },
        my_role: {
          type: 'string',
          description: '本机职责定位（例如：前端/移动端, 后端/API）。',
        },
        token: {
          type: 'string',
          description: '共享安全认证 Token。',
        },
      },
      required: ['action'],
    },
    output: {
      schema: {},
      render: (_args, value) => {
        return [{
          type: 'text',
          text: typeof value === 'string' ? value : JSON.stringify(value, null, 2),
        }];
      }
    },
    async execute(args) {
      cfg = loadConfig();

      if (args.action === 'status') {
        return {
          node: cfg.node,
          listen_port: activePort,
          token: cfg.token ? '已配置 (******)' : '未配置',
          peers: cfg.peers,
          ledger_dir: SESSIONS_DIR,
          status: 'listening',
        };
      }

      if (args.action === 'update_profile') {
        if (args.my_name) cfg.node.name = args.my_name;
        if (args.my_avatar) cfg.node.avatar = args.my_avatar;
        if (args.my_role) cfg.node.role = args.my_role;
        if (args.token !== undefined) cfg.token = args.token;
        saveConfig(cfg);
        return { ok: true, node: cfg.node, message: '本机名片已成功更新' };
      }

      if (args.action === 'add_peer') {
        if (!args.peer_url) return { ok: false, error: '缺少 peer_url 参数' };
        upsertPeer(cfg, {
          name: args.peer_name || '对端电脑',
          url: args.peer_url,
          token: args.token || cfg.token,
        });
        return { ok: true, peers: cfg.peers, message: '对等节点已添加到花名册' };
      }

      if (args.action === 'remove_peer') {
        const query = args.peer_name || args.peer_url;
        cfg.peers = cfg.peers.filter((p) => p.name !== query && p.url !== query && p.id !== query);
        saveConfig(cfg);
        return { ok: true, peers: cfg.peers, message: '已从花名册移除该节点' };
      }

      if (args.action === 'test_ping') {
        const target = args.peer_name
          ? cfg.peers.find((p) => p.name.includes(args.peer_name) || p.url.includes(args.peer_name))
          : cfg.peers[0];

        if (!target) return { ok: false, error: '未找到可探测的对等节点' };
        const result = await pingPeer(cfg, target);
        return {
          ok: result.ok,
          targetNode: target.name,
          targetUrl: target.url,
          durationMs: result.latencyMs,
          peerInfo: result.info,
          error: result.error,
        };
      }

      if (args.action === 'recent_sessions') {
        const entries = readRecentLedger(15);
        return { count: entries.length, entries };
      }

      if (args.action === 'scan') {
        if (radar) {
          radar.broadcast('probe');
        }
        await new Promise((r) => setTimeout(r, 600));
        cfg = loadConfig();
        const onlineCount = cfg.peers.filter((p) => p.online).length;
        return {
          ok: true,
          message: `局域网雷达探测完毕，当前共发现 ${onlineCount} 台在线 DSH 电脑`,
          onlineCount,
          peers: cfg.peers,
        };
      }

      return { ok: false, error: '未知 action' };
    },
  });

  return () => {
    if (radar) {
      radar.stop();
      radar = null;
    }
    if (server) {
      server.close();
      server = null;
    }
  };
}
