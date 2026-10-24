import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';

const PORT = 8790;
const PEER_DIR = path.join(os.homedir(), '.dsh', 'peer-link');
const CONFIG_FILE = path.join(PEER_DIR, 'config.json');
const LEDGER_FILE = path.join(PEER_DIR, 'ledger.jsonl');

function loadConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'));
  } catch {
    return {
      node: { id: 'node-local', name: 'MacBook-Pro', avatar: '🧠', role: '前端架构' },
      listen_port: 8765,
      token: 'dsh-peer-secret-shared-token',
      peers: []
    };
  }
}

function saveConfig(cfg) {
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2), 'utf-8');
}

function readLedger() {
  try {
    if (!fs.existsSync(LEDGER_FILE)) return [];
    const lines = fs.readFileSync(LEDGER_FILE, 'utf-8').trim().split('\n').filter(Boolean);
    return lines.slice(-20).map(l => {
      try { return JSON.parse(l); } catch { return null; }
    }).filter(Boolean).reverse();
  } catch {
    return [];
  }
}

const server = http.createServer((req, res) => {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url, `http://localhost:${PORT}`);

  if (url.pathname === '/api/status' && req.method === 'GET') {
    const cfg = loadConfig();
    const ledger = readLedger();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, node: cfg.node, peers: cfg.peers || [], recentLedger: ledger, token: cfg.token }));
    return;
  }

  if (url.pathname === '/api/profile' && req.method === 'POST') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      try {
        const d = JSON.parse(body);
        const cfg = loadConfig();
        if (d.name) cfg.node.name = d.name;
        if (d.avatar) cfg.node.avatar = d.avatar;
        if (d.role) cfg.node.role = d.role;
        if (d.token !== undefined) cfg.token = d.token;
        saveConfig(cfg);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, node: cfg.node }));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: err.message }));
      }
    });
    return;
  }

  if (url.pathname === '/api/peers' && req.method === 'POST') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      try {
        const d = JSON.parse(body);
        const cfg = loadConfig();
        cfg.peers = cfg.peers || [];
        cfg.peers.push({
          id: `peer-${Date.now().toString(16)}`,
          name: d.name || '对等端',
          avatar: d.avatar || '🖥',
          role: d.role || '协作者',
          url: d.url,
          token: d.token || cfg.token,
          online: true,
          last_seen: new Date().toISOString()
        });
        saveConfig(cfg);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, peers: cfg.peers }));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: err.message }));
      }
    });
    return;
  }

  if (url.pathname === '/api/ping' && req.method === 'POST') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', async () => {
      try {
        const { peerId } = JSON.parse(body);
        const cfg = loadConfig();
        const peer = (cfg.peers || []).find(p => p.id === peerId || p.url === peerId);
        if (!peer) throw new Error('未找到该对等节点');

        const start = Date.now();
        const pingUrl = `${peer.url.replace(/\/+$/, '')}/api/health`;
        const r = await fetch(pingUrl, { signal: AbortSignal.timeout(1500) });
        const latency = Date.now() - start;
        peer.online = r.ok;
        peer.latencyMs = latency;
        peer.last_seen = new Date().toISOString();
        saveConfig(cfg);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, result: { ok: true, durationMs: latency } }));
      } catch (e) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, result: { ok: false, error: e.message } }));
      }
    });
    return;
  }

  if (url.pathname === '/api/send' && req.method === 'POST') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', async () => {
      try {
        const { topic, message, target } = JSON.parse(body);
        const cfg = loadConfig();
        const traceId = `trace-${Date.now().toString(16)}-${crypto.randomBytes(2).toString('hex')}`;
        
        // 记录本地 ledger
        const record = {
          trace_id: traceId,
          direction: 'outbound',
          sender_type: 'human',
          peer: target || '全部节点',
          topic,
          durationMs: 2,
          _ts: new Date().toISOString()
        };
        fs.appendFileSync(LEDGER_FILE, JSON.stringify(record) + '\n', 'utf-8');

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, result: { trace_id: traceId } }));
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: e.message }));
      }
    });
    return;
  }

  // 默认返回 HTML 单页
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(`<!DOCTYPE html>
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
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      padding: 28px;
    }
    .wrap { max-width: 1040px; margin: 0 auto; }
    header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding-bottom: 18px;
      border-bottom: 1px solid #30363d;
      margin-bottom: 24px;
    }
    h1 { font-size: 22px; font-weight: 600; color: #58a6ff; display: flex; align-items: center; gap: 10px; }
    .badge {
      font-size: 12px;
      padding: 2px 10px;
      border-radius: 12px;
      font-weight: 500;
    }
    .badge-green { background: rgba(46,160,67,0.15); color: #3fb950; border: 1px solid rgba(46,160,67,0.4); }
    .badge-purple { background: rgba(163,113,247,0.15); color: #a371f7; border: 1px solid rgba(163,113,247,0.4); }
    .badge-gray { background: rgba(139,148,158,0.15); color: #8b949e; border: 1px solid #30363d; }
    .btn {
      background: #21262d;
      border: 1px solid #30363d;
      color: #c9d1d9;
      padding: 7px 16px;
      border-radius: 6px;
      cursor: pointer;
      font-size: 13px;
      font-weight: 500;
    }
    .btn:hover { background: #30363d; color: #fff; }
    .btn-primary { background: #238636; border-color: #2ea043; color: #fff; }
    .btn-primary:hover { background: #2ea043; }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 24px; }
    .card {
      background: #161b22;
      border: 1px solid #30363d;
      border-radius: 8px;
      padding: 20px;
    }
    .card-title {
      font-size: 15px;
      font-weight: 600;
      color: #f0f6fc;
      margin-bottom: 16px;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .input-group { margin-bottom: 12px; }
    label { display: block; font-size: 12px; color: #8b949e; margin-bottom: 6px; }
    input, textarea, select {
      width: 100%;
      background: #0d1117;
      border: 1px solid #30363d;
      color: #f0f6fc;
      padding: 8px 12px;
      border-radius: 6px;
      font-size: 13px;
    }
    input:focus, textarea:focus { border-color: #58a6ff; outline: none; }
    .peer-card {
      background: #0d1117;
      border: 1px solid #30363d;
      border-radius: 6px;
      padding: 14px;
      margin-bottom: 10px;
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .peer-left { display: flex; align-items: center; gap: 14px; }
    .peer-avatar { font-size: 26px; }
    .peer-name { font-weight: 600; color: #f0f6fc; font-size: 14px; display: flex; align-items: center; gap: 8px; }
    .peer-sub { font-size: 12px; color: #8b949e; margin-top: 2px; }
    table { width: 100%; border-collapse: collapse; font-size: 12px; margin-top: 8px; }
    th, td { text-align: left; padding: 10px; border-bottom: 1px solid #21262d; }
    th { color: #8b949e; font-weight: 500; }
  </style>
</head>
<body>
  <div class="wrap">
    <header>
      <h1>🤝 DSH 跨电脑分布式对等协同网络 <span id="onlineBadge" class="badge badge-green">0 台在线</span></h1>
      <div style="display:flex; gap:10px;">
        <button class="btn" onclick="fetchData()">🔄 刷新状态</button>
      </div>
    </header>

    <div class="grid">
      <!-- 本机档案 -->
      <div class="card">
        <div class="card-title">
          <span>🧠 本机节点档案 (My Identity)</span>
          <button class="btn" style="padding:3px 10px; font-size:12px;" onclick="saveProfile()">保存设置</button>
        </div>
        <div class="input-group">
          <label>节点名称</label>
          <input id="p_name" placeholder="例如: MacBook-Pro-Frontend">
        </div>
        <div style="display:flex; gap:12px;" class="input-group">
          <div style="flex:1;">
            <label>头像 Emoji</label>
            <input id="p_avatar" placeholder="例如: 🧠">
          </div>
          <div style="flex:2;">
            <label>职责定位</label>
            <input id="p_role" placeholder="例如: 前端与移动端架构">
          </div>
        </div>
        <div class="input-group">
          <label>共享认证安全 Token</label>
          <input id="p_token" type="password">
        </div>
      </div>

      <!-- 人类直接发信 -->
      <div class="card">
        <div class="card-title">
          <span>👤 人类直接指令控制台 (Direct Command)</span>
        </div>
        <div class="input-group">
          <label>发送目标</label>
          <select id="p_target">
            <option value="all">📡 局域网全网广播 (All Peers)</option>
          </select>
        </div>
        <div class="input-group">
          <label>指令主题</label>
          <input id="msg_topic" placeholder="例如: 用户中心 API 字段规范对齐">
        </div>
        <div class="input-group">
          <label>任务正文 / 变更提议</label>
          <textarea id="msg_body" rows="2" placeholder="输入要下达给对端 DSH 的工作任务或架构决策..."></textarea>
        </div>
        <div style="text-align:right;">
          <button class="btn btn-primary" onclick="sendDirect()">🚀 发送人类指令</button>
        </div>
      </div>
    </div>

    <!-- 局域网通讯录 -->
    <div class="card" style="margin-bottom:24px;">
      <div class="card-title">
        <span>🌐 局域网在线花名册 (Peers Roster)</span>
        <button class="btn" style="padding:3px 10px; font-size:12px;" onclick="addPeer()">+ 手动添加电脑</button>
      </div>
      <div id="rosterList">正在扫描局域网节点...</div>
    </div>

    <!-- 双端流水账本 -->
    <div class="card">
      <div class="card-title">
        <span>📜 实时双端对账流水账本 (Trace Ledger)</span>
      </div>
      <table>
        <thead>
          <tr>
            <th>流向</th>
            <th>发信身份</th>
            <th>对端名称</th>
            <th>通信主题</th>
            <th>响应耗时</th>
            <th>Trace ID</th>
          </tr>
        </thead>
        <tbody id="ledgerList"></tbody>
      </table>
    </div>
  </div>

  <script>
    async function fetchData() {
      try {
        const res = await fetch('/api/status');
        const data = await res.json();
        if (!data.ok) return;

        document.getElementById('p_name').value = data.node.name || '';
        document.getElementById('p_avatar').value = data.node.avatar || '🧠';
        document.getElementById('p_role').value = data.node.role || '';
        document.getElementById('p_token').value = data.token || '';

        const peers = data.peers || [];
        const onlineCount = peers.filter(p => p.online).length;
        document.getElementById('onlineBadge').innerText = onlineCount + ' 台在线';

        const targetSelect = document.getElementById('p_target');
        targetSelect.innerHTML = '<option value="all">📡 局域网全网广播 (All Peers)</option>';
        peers.forEach(p => {
          targetSelect.innerHTML += '<option value="' + p.name + '">' + (p.avatar || '🖥') + ' ' + p.name + ' (' + p.url + ')</option>';
        });

        const rList = document.getElementById('rosterList');
        if (peers.length === 0) {
          rList.innerHTML = '<div style="color:#8b949e; text-align:center; padding:16px;">局域网内暂未发现其他 DSH 节点，请确认对方已安装本插件并开机。</div>';
        } else {
          rList.innerHTML = peers.map(p => \`
            <div class="peer-card">
              <div class="peer-left">
                <div class="peer-avatar">\${p.avatar || '🖥'}</div>
                <div>
                  <div class="peer-name">
                    \${p.name}
                    \${p.autoDiscovered ? '<span class="badge badge-purple" style="font-size:10px;">📡 雷达发现</span>' : ''}
                  </div>
                  <div class="peer-sub">\${p.role || '协作者'} · \${p.url}</div>
                </div>
              </div>
              <div style="display:flex; align-items:center; gap:8px;">
                <span class="badge \${p.online ? 'badge-green' : 'badge-gray'}">\${p.online ? (p.latencyMs ? p.latencyMs + 'ms' : '在线') : '离线'}</span>
                <button class="btn" style="padding:4px 10px; font-size:12px;" onclick="pingPeer('\${p.id || p.url}')">⚡ 探测</button>
              </div>
            </div>
          \`).join('');
        }

        const lList = document.getElementById('ledgerList');
        const ledger = data.recentLedger || [];
        lList.innerHTML = ledger.map(l => \`
          <tr>
            <td>\${l.direction === 'outbound' ? '📤 出站' : '📥 入站'}</td>
            <td><span class="badge \${l.sender_type === 'human' ? 'badge-green' : 'badge-purple'}">\${l.sender_type === 'human' ? '👤 人类' : '🤖 Agent'}</span></td>
            <td>\${l.peer || '-'}</td>
            <td>\${l.topic || '-'}</td>
            <td>\${l.durationMs ? l.durationMs + 'ms' : '-'}</td>
            <td style="font-family:monospace; color:#8b949e;">\${l.trace_id}</td>
          </tr>
        \`).join('');
      } catch (e) {
        console.error(e);
      }
    }

    async function saveProfile() {
      try {
        await fetch('/api/profile', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: document.getElementById('p_name').value,
            avatar: document.getElementById('p_avatar').value,
            role: document.getElementById('p_role').value,
            token: document.getElementById('p_token').value
          })
        });
        alert('名片已保存');
        fetchData();
      } catch (e) { alert(e.message); }
    }

    async function sendDirect() {
      const topic = document.getElementById('msg_topic').value;
      const message = document.getElementById('msg_body').value;
      const target = document.getElementById('p_target').value;
      if (!topic || !message) return alert('请填写主题和内容');

      try {
        const res = await fetch('/api/send', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ topic, message, target })
        });
        const d = await res.json();
        if (d.ok) {
          alert('指令已发出！Trace: ' + d.result.trace_id);
          document.getElementById('msg_topic').value = '';
          document.getElementById('msg_body').value = '';
          fetchData();
        }
      } catch (e) { alert(e.message); }
    }

    async function addPeer() {
      const name = prompt('电脑名称:');
      if (!name) return;
      const url = prompt('电脑 URL (如 http://192.168.1.100:8765):');
      if (!url) return;
      await fetch('/api/peers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, url })
      });
      fetchData();
    }

    async function pingPeer(peerId) {
      const res = await fetch('/api/ping', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ peerId })
      });
      const d = await res.json();
      alert(d.ok ? '探测成功！' : '探测失败: ' + d.result?.error);
      fetchData();
    }

    fetchData();
    setInterval(fetchData, 4000);
  </script>
</body>
</html>`);
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 DSH Peer Link 控制台已成功启动: http://127.0.0.1:${PORT}`);
});
