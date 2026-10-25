import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';

const PORT = 8790;
const PEER_DIR = path.join(os.homedir(), '.dsh', 'peer-link');
const SESSIONS_DIR = path.join(PEER_DIR, 'sessions');
const CONFIG_FILE = path.join(PEER_DIR, 'config.json');
const LEDGER_FILE = path.join(PEER_DIR, 'ledger.jsonl');

function loadConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'));
  } catch {
    return {
      node: { id: 'node-local', name: 'MacBook-Pro-Frontend', avatar: '🧠', role: '前端与移动端架构专家' },
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
    return lines.slice(-50).map(l => {
      try { return JSON.parse(l); } catch { return null; }
    }).filter(Boolean).reverse();
  } catch {
    return [];
  }
}

// 解析所有 session Markdown 文件并转换为结构化聊天消息
function parseAllChatMessages() {
  const messages = [];
  if (!fs.existsSync(SESSIONS_DIR)) return messages;

  const files = fs.readdirSync(SESSIONS_DIR).filter(f => f.endsWith('.md'));
  for (const file of files) {
    try {
      const fullPath = path.join(SESSIONS_DIR, file);
      const content = fs.readFileSync(fullPath, 'utf-8');

      // 正则提取关键信息
      const traceMatch = content.match(/# 🤝 对等协作留痕会话:\s*([^\n]+)/);
      const timeMatch = content.match(/- \*\*记录时间\*\*:\s*([^\n]+)/);
      const fromMatch = content.match(/- \*\*发起方\*\*:\s*([^\n]+)/);
      const toMatch = content.match(/- \*\*接收方\*\*:\s*([^\n]+)/);
      const topicMatch = content.match(/- \*\*沟通主题\*\*:\s*([^\n]+)/);

      const traceId = traceMatch ? traceMatch[1].trim() : file.replace('.md', '');
      const time = timeMatch ? timeMatch[1].trim() : fs.statSync(fullPath).mtime.toISOString();
      const from = fromMatch ? fromMatch[1].trim() : '未知节点';
      const to = toMatch ? toMatch[1].trim() : '未知节点';
      const topic = topicMatch ? topicMatch[1].trim() : '';

      // 提取发送内容
      const sendPart = content.split('## 📥 接收答复')[0];
      const sendBodyMatch = sendPart.match(/## 📤 发送内容[^\n]*\n([\s\S]*?)(?=### 附带上下文|$)/);
      const contextMatch = sendPart.match(/### 附带上下文\n```[\w]*\n([\s\S]*?)\n```/);

      const reqText = sendBodyMatch ? sendBodyMatch[1].trim() : '';
      const reqContext = contextMatch ? contextMatch[1].trim() : '';

      // 提取接收答复
      let resText = '';
      if (content.includes('## 📥 接收答复')) {
        const replyPart = content.split('## 📥 接收答复')[1];
        resText = replyPart.replace(/---[\s\S]*$/, '').trim();
      }

      // 请求消息
      messages.push({
        id: `${traceId}-req`,
        traceId,
        from,
        to,
        topic,
        content: reqText,
        context: reqContext,
        time,
        type: 'request',
        senderType: (content.includes('human') || content.includes('人类')) ? 'human' : 'agent'
      });

      // 答复消息
      if (resText) {
        messages.push({
          id: `${traceId}-res`,
          traceId,
          from: to,
          to: from,
          topic,
          content: resText,
          time: new Date(new Date(time).getTime() + 100).toISOString(),
          type: 'response',
          senderType: 'agent'
        });
      }
    } catch (e) {
      console.error('Error parsing session file:', file, e);
    }
  }

  // 按时间升序排列
  return messages.sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime());
}

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url, `http://localhost:${PORT}`);

  // 1. 基础状态
  if (url.pathname === '/api/status' && req.method === 'GET') {
    const cfg = loadConfig();
    const ledger = readLedger();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, node: cfg.node, peers: cfg.peers || [], recentLedger: ledger, token: cfg.token }));
    return;
  }

  // 2. 聊天消息聚合
  if (url.pathname === '/api/chat/messages' && req.method === 'GET') {
    const peerName = url.searchParams.get('peer');
    let allMsgs = parseAllChatMessages();
    if (peerName && peerName !== 'all') {
      allMsgs = allMsgs.filter(m => m.from === peerName || m.to === peerName);
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, messages: allMsgs }));
    return;
  }

  // 3. 修改档案
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

  // 4. 添加对端
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

  // 5. 节点探测
  if (url.pathname === '/api/ping' && req.method === 'POST') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', async () => {
      try {
        const { peerId } = JSON.parse(body);
        const cfg = loadConfig();
        const peer = (cfg.peers || []).find(p => p.id === peerId || p.url === peerId || p.name === peerId);
        if (!peer) throw new Error('未找到该对等节点');

        const start = Date.now();
        const pingUrl = `${peer.url.replace(/\/+$/, '')}/health`;
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

  // 6. 人类控制台专属发信端点（物理路径决定身份，强制 human）
  if ((url.pathname === '/api/human/send' || url.pathname === '/api/send') && req.method === 'POST') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', async () => {
      try {
        const { topic, message, context, target } = JSON.parse(body);
        const cfg = loadConfig();
        const traceId = `trace-${Date.now().toString(16)}-${crypto.randomBytes(2).toString('hex')}`;
        const myNode = cfg.node || { name: 'MacBook-Pro-Frontend' };
        
        // 关键安全原则：来自 Web 人类控制台路径的请求，身份强制为 human，不接受外部传入伪造
        const asHuman = true;
        
        let targetPeer = null;
        if (target && target !== 'all') {
          targetPeer = (cfg.peers || []).find(p => p.name === target || p.id === target);
        }

        let replyText = '';
        let durationMs = 0;

        // 如果配置了具体 URL，发起真实 HTTP 投递
        if (targetPeer && targetPeer.url) {
          try {
            const start = Date.now();
            const postUrl = `${targetPeer.url.replace(/\/+$/, '')}/talk`;
            const payload = {
              topic: topic || '聊天消息',
              message,
              context,
              token: targetPeer.token || cfg.token,
              as_human: !!asHuman,
              sender: {
                name: myNode.name,
                avatar: myNode.avatar || '🧠',
                role: myNode.role || '协作者',
                type: asHuman ? 'human' : 'agent',
                url: `http://192.168.31.124:${cfg.listen_port || 8765}`
              }
            };
            const r = await fetch(postUrl, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${targetPeer.token || cfg.token}`
              },
              body: JSON.stringify(payload),
              signal: AbortSignal.timeout(3000)
            });
            durationMs = Date.now() - start;
            if (r.ok) {
              const resData = await r.json();
              replyText = resData.reply || '【对端已成功接收并纳入处理】';
            } else {
              replyText = `【投递状态: HTTP ${r.status}】`;
            }
          } catch (err) {
            replyText = `【发送中转记录: 对端当前可能离线或未启动服务 (${err.message})】`;
          }
        } else {
          replyText = '【广播消息已分发并记录至局域网协同账本】';
        }

        // 保存 Markdown 会话记录
        if (!fs.existsSync(SESSIONS_DIR)) {
          fs.mkdirSync(SESSIONS_DIR, { recursive: true });
        }
        const sessionDate = new Date().toISOString().slice(0, 10);
        const sessionFile = path.join(SESSIONS_DIR, `${sessionDate}_${traceId}.md`);
        const mdContent = `# 🤝 对等协作留痕会话: ${traceId}
- **记录时间**: ${new Date().toISOString()}
- **发起方**: ${myNode.name} (${asHuman ? '👤 人类' : '🤖 Agent'})
- **接收方**: ${target || '局域网集群'}
- **沟通主题**: ${topic || '即时对话'}
- **状态**: completed
- **耗时**: ${durationMs}ms

## 📤 发送内容 / 提议草案
${message}
${context ? `\n### 附带上下文\n\`\`\`\n${context}\n\`\`\`\n` : ''}

## 📥 接收答复 / 协商共识
${replyText}
---
*由 DSH Peer Link 插件双端自动审计落盘*
`;
        fs.writeFileSync(sessionFile, mdContent, 'utf-8');

        // 写入 Ledger
        const record = {
          trace_id: traceId,
          direction: 'outbound',
          sender_type: asHuman ? 'human' : 'agent',
          peer: target || '全部节点',
          topic: topic || '即时对话',
          durationMs,
          sessionPath: sessionFile,
          _ts: new Date().toISOString()
        };
        fs.appendFileSync(LEDGER_FILE, JSON.stringify(record) + '\n', 'utf-8');

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, result: { trace_id: traceId, reply: replyText } }));
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: e.message }));
      }
    });
    return;
  }

  // 默认返回现代聊天软件风格单页 (WeChat / Slack 风格)
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(`<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <title>💬 DSH 对等协同即时通讯中心</title>
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: #090d16;
      color: #e6edf3;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", sans-serif;
      height: 100vh;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }
    
    /* 顶部导航条 */
    .top-nav {
      height: 52px;
      background: #161b22;
      border-bottom: 1px solid #30363d;
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0 20px;
      flex-shrink: 0;
    }
    .logo {
      font-size: 16px;
      font-weight: 600;
      color: #58a6ff;
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .nav-tabs {
      display: flex;
      gap: 8px;
    }
    .tab-btn {
      background: transparent;
      border: 1px solid transparent;
      color: #8b949e;
      padding: 6px 14px;
      border-radius: 6px;
      cursor: pointer;
      font-size: 13px;
      font-weight: 500;
      transition: all 0.2s;
    }
    .tab-btn.active {
      background: #21262d;
      color: #58a6ff;
      border-color: #30363d;
    }
    .tab-btn:hover:not(.active) {
      color: #c9d1d9;
    }

    /* 主体布局：仿聊天软件双栏 */
    .app-main {
      flex: 1;
      display: flex;
      overflow: hidden;
    }

    /* 左侧好友/节点列表 */
    .peer-sidebar {
      width: 290px;
      background: #0d1117;
      border-right: 1px solid #30363d;
      display: flex;
      flex-direction: column;
      flex-shrink: 0;
    }
    .sidebar-header {
      padding: 14px 16px;
      border-bottom: 1px solid #21262d;
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-size: 13px;
      font-weight: 600;
      color: #8b949e;
    }
    .peer-list {
      flex: 1;
      overflow-y: auto;
      padding: 8px;
    }
    .peer-item {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 10px 12px;
      border-radius: 8px;
      cursor: pointer;
      margin-bottom: 4px;
      transition: background 0.15s;
      position: relative;
    }
    .peer-item:hover {
      background: #161b22;
    }
    .peer-item.active {
      background: #1f242c;
      border-left: 3px solid #58a6ff;
    }
    .avatar-wrap {
      position: relative;
      font-size: 24px;
      line-height: 1;
    }
    .status-dot {
      width: 9px;
      height: 9px;
      border-radius: 50%;
      position: absolute;
      bottom: -1px;
      right: -2px;
      border: 2px solid #0d1117;
    }
    .dot-online { background: #3fb950; }
    .dot-offline { background: #6e7681; }

    .peer-info {
      flex: 1;
      min-width: 0;
    }
    .peer-top-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 3px;
    }
    .peer-name {
      font-size: 13px;
      font-weight: 600;
      color: #f0f6fc;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .peer-desc {
      font-size: 11px;
      color: #8b949e;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    /* 右侧聊天窗口 */
    .chat-window {
      flex: 1;
      display: flex;
      flex-direction: column;
      background: #090d16;
      position: relative;
    }
    .chat-header {
      height: 58px;
      padding: 0 20px;
      background: #0d1117;
      border-bottom: 1px solid #30363d;
      display: flex;
      align-items: center;
      justify-content: space-between;
      flex-shrink: 0;
    }
    .chat-header-title {
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .chat-header-name {
      font-size: 15px;
      font-weight: 600;
      color: #f0f6fc;
    }
    .chat-header-sub {
      font-size: 12px;
      color: #8b949e;
    }

    /* 消息气泡流 */
    .chat-messages {
      flex: 1;
      overflow-y: auto;
      scroll-behavior: smooth;
      padding: 20px 24px;
      display: flex;
      flex-direction: column;
      gap: 18px;
    }
    .msg-group {
      display: flex;
      gap: 12px;
      max-width: 82%;
    }
    .msg-group.outbound {
      align-self: flex-end;
      flex-direction: row-reverse;
    }
    .msg-group.inbound {
      align-self: flex-start;
    }
    .msg-avatar {
      font-size: 26px;
      line-height: 1;
      margin-top: 2px;
    }
    .msg-body-wrap {
      display: flex;
      flex-direction: column;
    }
    .msg-meta {
      font-size: 11px;
      color: #8b949e;
      margin-bottom: 5px;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .msg-group.outbound .msg-meta {
      justify-content: flex-end;
    }
    .badge-tag {
      font-size: 10px;
      padding: 1px 6px;
      border-radius: 10px;
      font-weight: 500;
    }
    .badge-human { background: rgba(56, 139, 253, 0.15); color: #58a6ff; border: 1px solid rgba(56, 139, 253, 0.4); }
    .badge-agent { background: rgba(163, 113, 247, 0.15); color: #bc8cff; border: 1px solid rgba(163, 113, 247, 0.4); }

    .bubble {
      padding: 12px 16px;
      border-radius: 12px;
      font-size: 13px;
      line-height: 1.55;
      word-break: break-word;
      position: relative;
    }
    .msg-group.inbound .bubble {
      background: #161b22;
      border: 1px solid #30363d;
      color: #e6edf3;
      border-top-left-radius: 2px;
    }
    .msg-group.outbound .bubble {
      background: #1f365d;
      border: 1px solid #2f5496;
      color: #f0f6fc;
      border-top-right-radius: 2px;
    }
    .bubble-topic {
      font-size: 12px;
      font-weight: 600;
      color: #79c0ff;
      margin-bottom: 6px;
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .code-block {
      background: #0d1117;
      border: 1px solid #30363d;
      border-radius: 6px;
      padding: 10px;
      margin-top: 8px;
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 11.5px;
      color: #7ee787;
      white-space: pre-wrap;
    }

    /* 底部输入框 */
    .chat-input-area {
      background: #0d1117;
      border-top: 1px solid #30363d;
      padding: 14px 20px;
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    .input-toolbar {
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .role-toggle {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 12px;
      color: #8b949e;
    }
    .input-row {
      display: flex;
      gap: 10px;
    }
    .topic-input {
      width: 220px;
      background: #161b22;
      border: 1px solid #30363d;
      color: #f0f6fc;
      padding: 8px 12px;
      border-radius: 6px;
      font-size: 13px;
    }
    .msg-input {
      flex: 1;
      background: #161b22;
      border: 1px solid #30363d;
      color: #f0f6fc;
      padding: 8px 12px;
      border-radius: 6px;
      font-size: 13px;
      resize: none;
      height: 42px;
    }
    .topic-input:focus, .msg-input:focus {
      border-color: #58a6ff;
      outline: none;
    }
    .send-btn {
      background: #238636;
      border: 1px solid #2ea043;
      color: #fff;
      padding: 0 18px;
      border-radius: 6px;
      cursor: pointer;
      font-size: 13px;
      font-weight: 500;
      transition: background 0.15s;
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .send-btn:hover { background: #2ea043; }
  </style>
</head>
<body>
  <!-- 顶部状态栏 -->
  <div class="top-nav">
    <div class="logo">
      <span>💬 DSH 对等协同即时通讯中心</span>
      <span id="myProfileBadge" style="font-size:12px; color:#8b949e; font-weight:normal;"></span>
    </div>
    <div class="nav-tabs">
      <button class="tab-btn active" id="tabChat" onclick="switchView('chat')">💬 即时对话聊天流</button>
      <button class="tab-btn" id="tabDash" onclick="switchView('dash')">📊 集群看板与设置</button>
    </div>
  </div>

  <!-- 聊天模式视图 -->
  <div class="app-main" id="viewChat">
    <!-- 左侧通讯录 -->
    <div class="peer-sidebar">
      <div class="sidebar-header">
        <span>对等联系人 (Peers)</span>
        <button style="background:none; border:none; color:#58a6ff; cursor:pointer; font-size:12px;" onclick="refreshAll()">🔄 刷新</button>
      </div>
      <div class="peer-list" id="peerListEl"></div>
    </div>

    <!-- 右侧会话窗口 -->
    <div class="chat-window">
      <div class="chat-header">
        <div class="chat-header-title">
          <span id="currentPeerAvatar" style="font-size:22px;">📡</span>
          <div>
            <div class="chat-header-name" id="currentPeerName">局域网全网集群 (All Peers)</div>
            <div class="chat-header-sub" id="currentPeerSub">广播给局域网中所有在线的 DSH 节点</div>
          </div>
        </div>
        <button class="tab-btn" style="border:1px solid #30363d;" onclick="pingCurrent()">⚡ 探测对端连通性</button>
      </div>

      <!-- 消息气泡流 -->
      <div class="chat-messages" id="chatStreamEl"></div>

      <!-- 输入栏 -->
      <div class="chat-input-area">
        <div class="input-toolbar">
          <div class="role-toggle">
            <span>发信通道:</span>
            <span class="badge-tag badge-human" style="font-size:11px; padding:2px 8px; font-weight:600;">👤 人类控制台专属直连 (Human Path)</span>
          </div>
          <span style="font-size:11px; color:#6e7681;">按 Enter 发送人类指令</span>
        </div>
        <div class="input-row">
          <input class="topic-input" id="inputTopic" placeholder="议题 (如: API数据模型确认)">
          <textarea class="msg-input" id="inputMsg" placeholder="输入要下达给对端 DSH 的工作任务、提议或指令..."></textarea>
          <button class="send-btn" onclick="sendMessage()">🚀 发送</button>
        </div>
      </div>
    </div>
  </div>

  <!-- 集群看板视图（嵌入之前完整看板） -->
  <div class="app-main" id="viewDash" style="display:none; overflow-y:auto; padding:24px;">
    <div style="max-width:1000px; margin:0 auto; width:100%;">
      <div style="background:#161b22; border:1px solid #30363d; border-radius:8px; padding:20px; margin-bottom:20px;">
        <h3 style="margin-bottom:12px; color:#58a6ff;">🧠 本机名片设置</h3>
        <div style="display:grid; grid-template-columns:1fr 1fr 1fr; gap:12px; margin-bottom:12px;">
          <div><label style="font-size:12px; color:#8b949e;">节点名称</label><input id="dash_name" style="width:100%; background:#0d1117; border:1px solid #30363d; color:#fff; padding:6px; border-radius:4px;"></div>
          <div><label style="font-size:12px; color:#8b949e;">头像 Emoji</label><input id="dash_avatar" style="width:100%; background:#0d1117; border:1px solid #30363d; color:#fff; padding:6px; border-radius:4px;"></div>
          <div><label style="font-size:12px; color:#8b949e;">职责定位</label><input id="dash_role" style="width:100%; background:#0d1117; border:1px solid #30363d; color:#fff; padding:6px; border-radius:4px;"></div>
        </div>
        <button class="send-btn" style="padding:6px 14px;" onclick="saveDashProfile()">保存档案</button>
      </div>

      <div style="background:#161b22; border:1px solid #30363d; border-radius:8px; padding:20px;">
        <h3 style="margin-bottom:12px; color:#58a6ff;">📜 完整通信 Ledger 原始审计流水</h3>
        <div id="dashLedgerEl" style="font-size:12px; font-family:monospace; color:#8b949e;"></div>
      </div>
    </div>
  </div>

  <script>
    let currentPeer = 'all';
    let myNode = { name: 'MacBook-Pro-Frontend', avatar: '🧠', role: '前端架构' };
    let peers = [];

    function switchView(v) {
      document.getElementById('viewChat').style.display = v === 'chat' ? 'flex' : 'none';
      document.getElementById('viewDash').style.display = v === 'dash' ? 'block' : 'none';
      document.getElementById('tabChat').className = 'tab-btn' + (v === 'chat' ? ' active' : '');
      document.getElementById('tabDash').className = 'tab-btn' + (v === 'dash' ? ' active' : '');
      if (v === 'dash') loadDash();
    }

    async function refreshAll() {
      try {
        const res = await fetch('/api/status');
        const d = await res.json();
        if (!d.ok) return;

        myNode = d.node || myNode;
        peers = d.peers || [];
        document.getElementById('myProfileBadge').innerText = '当前本机: ' + (myNode.avatar || '🧠') + ' ' + myNode.name + ' (' + (myNode.role || '') + ')';

        // 渲染联系人列表
        renderPeerList();
        // 渲染聊天气泡流
        renderChatMessages();
      } catch (e) {
        console.error(e);
      }
    }

    function renderPeerList() {
      const listEl = document.getElementById('peerListEl');
      let html = \`
        <div class="peer-item \${currentPeer === 'all' ? 'active' : ''}" onclick="selectPeer('all')">
          <div class="avatar-wrap">📡<span class="status-dot dot-online"></span></div>
          <div class="peer-info">
            <div class="peer-top-row">
              <span class="peer-name">全网集群广播 (All)</span>
            </div>
            <div class="peer-desc">向局域网内所有电脑广播</div>
          </div>
        </div>
      \`;

      peers.forEach(p => {
        const isOnline = p.online;
        html += \`
          <div class="peer-item \${currentPeer === p.name ? 'active' : ''}" onclick="selectPeer('\${p.name}')">
            <div class="avatar-wrap">\${p.avatar || '🖥'}<span class="status-dot \${isOnline ? 'dot-online' : 'dot-offline'}"></span></div>
            <div class="peer-info">
              <div class="peer-top-row">
                <span class="peer-name">\${p.name}</span>
                <span style="font-size:10px; color:\${isOnline ? '#3fb950' : '#8b949e'}">\${isOnline ? (p.latencyMs ? p.latencyMs + 'ms' : '在线') : '离线'}</span>
              </div>
              <div class="peer-desc">\${p.role || '对等端'} · \${p.url}</div>
            </div>
          </div>
        \`;
      });
      listEl.innerHTML = html;
    }

    function selectPeer(peerName) {
      currentPeer = peerName;
      if (peerName === 'all') {
        document.getElementById('currentPeerAvatar').innerText = '📡';
        document.getElementById('currentPeerName').innerText = '局域网全网集群 (All Peers)';
        document.getElementById('currentPeerSub').innerText = '广播给局域网中所有在线的 DSH 节点';
      } else {
        const p = peers.find(x => x.name === peerName) || {};
        document.getElementById('currentPeerAvatar').innerText = p.avatar || '🖥';
        document.getElementById('currentPeerName').innerText = p.name;
        document.getElementById('currentPeerSub').innerText = (p.role || '协作者') + ' · ' + (p.url || '');
      }
      renderPeerList();
      renderChatMessages(true);
    }

    let lastRenderedMsgCount = 0;
    let lastRenderedMsgId = '';

    async function renderChatMessages(forceScroll = false) {
      try {
        const url = '/api/chat/messages' + (currentPeer !== 'all' ? '?peer=' + encodeURIComponent(currentPeer) : '');
        const res = await fetch(url);
        const data = await res.json();
        const msgs = data.messages || [];

        const streamEl = document.getElementById('chatStreamEl');
        if (msgs.length === 0) {
          streamEl.innerHTML = '<div style="color:#6e7681; text-align:center; padding:40px;">暂无历史聊天记录。在下方输入框中发送消息开始对话吧！</div>';
          lastRenderedMsgCount = 0;
          lastRenderedMsgId = '';
          return;
        }

        const latestMsg = msgs[msgs.length - 1];
        const latestMsgId = latestMsg.id || (latestMsg.traceId + '-' + latestMsg.type);

        // 如果消息总数和最新一条均无变化，且非强制滚动，则跳过重绘，保护用户当前阅读和滚动状态
        if (!forceScroll && msgs.length === lastRenderedMsgCount && latestMsgId === lastRenderedMsgId) {
          return;
        }

        // 检查用户当前是否在底部附近（距离底部 80px 以内）
        const isNearBottom = (streamEl.scrollHeight - streamEl.scrollTop - streamEl.clientHeight) < 80;

        lastRenderedMsgCount = msgs.length;
        lastRenderedMsgId = latestMsgId;

        streamEl.innerHTML = msgs.map(m => {
          const isOut = (m.from === myNode.name) || (m.type === 'request' && currentPeer !== 'all');
          const isHuman = m.senderType === 'human';
          return \`
            <div class="msg-group \${isOut ? 'outbound' : 'inbound'}">
              <div class="msg-avatar">\${isOut ? (myNode.avatar || '🧠') : '🖥'}</div>
              <div class="msg-body-wrap">
                <div class="msg-meta">
                  <span style="font-weight:600; color:#c9d1d9;">\${m.from}</span>
                  <span class="badge-tag \${isHuman ? 'badge-human' : 'badge-agent'}">\${isHuman ? '👤 人类' : '🤖 Agent'}</span>
                  <span>\${new Date(m.time).toLocaleTimeString()}</span>
                </div>
                <div class="bubble">
                  \${m.topic ? '<div class="bubble-topic">📌 ' + m.topic + '</div>' : ''}
                  <div>\${escapeHtml(m.content)}</div>
                  \${m.context ? '<div class="code-block">' + escapeHtml(m.context) + '</div>' : ''}
                </div>
              </div>
            </div>
          \`;
        }).join('');

        // 关键体验优化：只有当用户原本就在底部附近，或者刚发送了新消息时，才滚到底部；
        // 如果用户正在往上滚动看历史记录，绝不打扰，保持当前滚动位置！
        if (forceScroll || isNearBottom) {
          streamEl.scrollTop = streamEl.scrollHeight;
        }
      } catch (e) {
        console.error(e);
      }
    }

    function escapeHtml(str) {
      if (!str) return '';
      return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\\n/g, '<br>');
    }

    async function sendMessage() {
      const topic = document.getElementById('inputTopic').value.trim();
      const message = document.getElementById('inputMsg').value.trim();
      if (!message) return alert('请输入消息内容');

      try {
        // 走物理通道：/api/human/send（强制标记为人类指令，无法伪造）
        const res = await fetch('/api/human/send', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            topic,
            message,
            target: currentPeer
          })
        });
        const d = await res.json();
        if (d.ok) {
          document.getElementById('inputMsg').value = '';
          await renderChatMessages(true);
        }
      } catch (e) {
        alert('发送失败: ' + e.message);
      }
    }

    async function pingCurrent() {
      if (currentPeer === 'all') return alert('广播目标无需探测单个连通性');
      const res = await fetch('/api/ping', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ peerId: currentPeer })
      });
      const d = await res.json();
      alert(d.ok ? '探测成功！' : '探测失败: ' + d.result?.error);
      refreshAll();
    }

    async function loadDash() {
      document.getElementById('dash_name').value = myNode.name;
      document.getElementById('dash_avatar').value = myNode.avatar || '🧠';
      document.getElementById('dash_role').value = myNode.role || '';

      const res = await fetch('/api/status');
      const d = await res.json();
      const ledger = d.recentLedger || [];
      document.getElementById('dashLedgerEl').innerHTML = ledger.map(l => JSON.stringify(l)).join('<br><br>');
    }

    async function saveDashProfile() {
      await fetch('/api/profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: document.getElementById('dash_name').value,
          avatar: document.getElementById('dash_avatar').value,
          role: document.getElementById('dash_role').value
        })
      });
      alert('已保存');
      refreshAll();
    }

    document.getElementById('inputMsg').addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
      }
    });

    refreshAll();
    setInterval(refreshAll, 3000);
  </script>
</body>
</html>`);
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 DSH 对等协同即时通讯中心已成功启动: http://127.0.0.1:${PORT}`);
});
