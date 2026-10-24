# 🤝 DSH Peer Link (分布式跨机对等协作插件)

[![Powered by DSH](https://img.shields.io/badge/Powered%20by-DSH-blue?style=flat-square)](https://github.com/monkey-sking)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

跨电脑 DeepSeek Harness (DSH) 实例之间的**零配置局域网自动发现、对等协同与双端实时留痕**插件。

---

## 🌟 核心特性

1. **完全对等（P2P Mesh 拓扑）**：
   - 无中心服务器，无 Master/Worker 差别，所有运行 DSH 的电脑地位完全对称，自由互联；
   - 支持单对单定向协商与全网集群并发广播（`target: "all"`）。

2. **局域网 UDP 雷达自动发现（PeerRadar）**：
   - 基于 Node.js 原生 UDP 8764 端口与组播（`239.255.255.250`）实现零配置自动探测；
   - 电脑开机自动通告名片，局域网同网段其他 DSH 实例秒级点亮；支持 15s 心跳保活与离线下线广播。

3. **信封染色与身份标记（Envelope Stamping）**：
   - 消息层自动区分 `👤 人类直接指令 (human)` 与 `🤖 智能体同级探讨 (agent)`；
   - 支持自定义每台电脑的专属名称、Emoji 头像和职责角色（如前端专家、后端架构师）。

4. **双端对账与审计留痕（Trace Ledger）**：
   - 每次跨机交流自动生成全局唯一的 `trace_id`；
   - 两端各自在本地 `~/.dsh/peer-link/sessions/` 归档 Markdown 格式的完整对谈与共识；
   - 本地 `~/.dsh/peer-link/ledger.jsonl` 提供高性能流水日志。

5. **可视化 Web 控制中心**：
   - 深度集成 DSH Web UI，左侧导航栏专属图标；
   - 提供节点档案编辑、局域网在线节点通讯录、雷达实时扫描、Ping 延迟探测与人类发信操作台。

6. **轻量与安全**：
   - 纯 Node.js 内置模块（`http`, `dgram`, `crypto`, `os`, `fs`）编写，**零外部 npm 依赖**；
   - 支持共享 Token 身份验证。

---

## 🚀 快速开始

### 1. 安装插件
在 DSH 终端执行：
```bash
# 从 npm / GitHub release 安装
pnpm add dsh-plugin-peer-link
```
或直接通过 DSH 插件市场/管理工具安装本地打包好的 `dsh-plugin-peer-link-1.0.2.tgz`。

### 2. 自动发现与使用
两台电脑只要处于同一 Wi-Fi 或局域网下：
- 启动 DSH 后，雷达会在 1 秒内自动互相发现对方！
- 打开 DSH Web 界面左下角 **🤝 跨电脑对等协作** 面板，即可看到在线节点与延迟。

### 3. Agent 智能体调用
当在 DSH 中指派任务时，智能体会自动使用内置原生工具：
- `peer_talk`：向对端电脑发起架构评审、接口规范核对或多机集群协同；
- `peer_status`：查看局域网通讯录、探测连通性或触发雷达重新扫描。

---

## 🛠 配置说明 (`~/.dsh/peer-link/config.json`)

配置文件会在首次启动时自动生成，您也可以在 Web 界面或直接修改：

```json
{
  "node": {
    "id": "node-b269cbd7",
    "name": "MacBook-Pro-Frontend",
    "avatar": "🧠",
    "role": "前端与移动端架构专家"
  },
  "listen_port": 8765,
  "token": "dsh-peer-secret-shared-token",
  "peers": [
    {
      "name": "Ubuntu-Server-Backend",
      "avatar": "🐧",
      "role": "后端与分布式计算专家",
      "url": "http://192.168.1.100:8765",
      "token": "dsh-peer-secret-shared-token"
    }
  ]
}
```
*(跨公网/远程协作时，可配合 Tailscale / ZeroTier 填入虚拟内网 IP)*

---

## 📄 License
MIT © 2026 DSH Team
