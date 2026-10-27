window.__ModuleLoader__.load({
  id: "dsh-plugin-peer-link",
  factory: (require) => {
    const React = require("react");
    const h = React.createElement;

    const STYLE_ID = "dsh-peer-link-style";
    function ensureStyles() {
      if (document.getElementById(STYLE_ID)) return;
      const style = document.createElement("style");
      style.id = STYLE_ID;
      style.textContent = `
        .dsh-peer-container {
          display: flex;
          flex-direction: column;
          height: 100%;
          width: 100%;
          background: var(--bg-canvas, #0d1117);
          color: var(--text-normal, #e6edf3);
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
          overflow: hidden;
          box-sizing: border-box;
        }
        .dsh-peer-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 16px 24px;
          border-bottom: 1px solid var(--border-subtle, #30363d);
          background: var(--bg-surface, #161b22);
        }
        .dsh-peer-title-group {
          display: flex;
          align-items: center;
          gap: 12px;
        }
        .dsh-peer-title {
          font-size: 18px;
          font-weight: 600;
          color: #58a6ff;
          margin: 0;
        }
        .dsh-peer-badge {
          display: inline-flex;
          align-items: center;
          padding: 2px 10px;
          border-radius: 12px;
          font-size: 12px;
          font-weight: 500;
        }
        .dsh-peer-badge.online {
          background: rgba(46, 160, 67, 0.15);
          color: #3fb950;
          border: 1px solid rgba(46, 160, 67, 0.4);
        }
        .dsh-peer-badge.offline {
          background: rgba(139, 148, 158, 0.15);
          color: #8b949e;
          border: 1px solid rgba(139, 148, 158, 0.4);
        }
        .dsh-peer-actions {
          display: flex;
          gap: 8px;
        }
        .dsh-peer-btn {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 6px 14px;
          border-radius: 6px;
          font-size: 13px;
          font-weight: 500;
          cursor: pointer;
          border: 1px solid var(--border-default, #30363d);
          background: var(--btn-bg, #21262d);
          color: var(--text-normal, #c9d1d9);
          transition: all 0.15s ease;
        }
        .dsh-peer-btn:hover {
          background: var(--btn-hover-bg, #30363d);
          border-color: #8b949e;
        }
        .dsh-peer-btn.primary {
          background: #238636;
          border-color: rgba(240, 246, 252, 0.1);
          color: #fff;
        }
        .dsh-peer-btn.primary:hover {
          background: #2ea043;
        }
        .dsh-peer-body {
          flex: 1;
          display: flex;
          flex-direction: column;
          padding: 20px 24px;
          gap: 20px;
          overflow-y: auto;
        }
        .dsh-peer-card {
          background: var(--bg-surface, #161b22);
          border: 1px solid var(--border-subtle, #30363d);
          border-radius: 8px;
          padding: 16px;
        }
        .dsh-peer-card-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 12px;
        }
        .dsh-peer-card-title {
          font-size: 14px;
          font-weight: 600;
          color: #8b949e;
          text-transform: uppercase;
          letter-spacing: 0.5px;
        }
        .dsh-peer-profile-row {
          display: flex;
          align-items: center;
          gap: 16px;
        }
        .dsh-peer-avatar {
          width: 52px;
          height: 52px;
          border-radius: 50%;
          background: #21262d;
          border: 2px solid #30363d;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 26px;
          user-select: none;
        }
        .dsh-peer-info {
          flex: 1;
        }
        .dsh-peer-name {
          font-size: 16px;
          font-weight: 600;
          color: #f0f6fc;
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .dsh-peer-role {
          font-size: 13px;
          color: #8b949e;
          margin-top: 4px;
        }
        .dsh-peer-roster {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
          gap: 14px;
        }
        .dsh-peer-node-card {
          background: #21262d;
          border: 1px solid #30363d;
          border-radius: 8px;
          padding: 14px;
          display: flex;
          flex-direction: column;
          gap: 10px;
          position: relative;
        }
        .dsh-peer-node-card.online {
          border-color: rgba(46, 160, 67, 0.4);
        }
        .dsh-peer-node-top {
          display: flex;
          align-items: center;
          gap: 10px;
        }
        .dsh-peer-node-avatar {
          width: 36px;
          height: 36px;
          border-radius: 8px;
          background: #161b22;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 20px;
        }
        .dsh-peer-node-meta {
          flex: 1;
          overflow: hidden;
        }
        .dsh-peer-node-title {
          font-size: 14px;
          font-weight: 600;
          color: #f0f6fc;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .dsh-peer-node-sub {
          font-size: 12px;
          color: #8b949e;
        }
        .dsh-peer-node-url {
          font-size: 12px;
          font-family: monospace;
          color: #79c0ff;
          background: rgba(56, 139, 253, 0.1);
          padding: 4px 8px;
          border-radius: 4px;
        }
        .dsh-peer-node-actions {
          display: flex;
          justify-content: flex-end;
          gap: 6px;
          margin-top: 4px;
        }
        .dsh-peer-workbench {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 16px;
          flex: 1;
          min-height: 350px;
        }
        .dsh-peer-list {
          overflow-y: auto;
          max-height: 380px;
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        .dsh-peer-list-item {
          padding: 10px 12px;
          background: #21262d;
          border: 1px solid #30363d;
          border-radius: 6px;
          cursor: pointer;
          transition: background 0.15s;
        }
        .dsh-peer-list-item:hover, .dsh-peer-list-item.active {
          background: #30363d;
          border-color: #58a6ff;
        }
        .dsh-peer-list-item-top {
          display: flex;
          justify-content: space-between;
          font-size: 12px;
          color: #8b949e;
          margin-bottom: 4px;
        }
        .dsh-peer-list-item-title {
          font-size: 13px;
          font-weight: 500;
          color: #f0f6fc;
        }
        .dsh-peer-input-group {
          margin-bottom: 12px;
        }
        .dsh-peer-label {
          display: block;
          font-size: 12px;
          font-weight: 500;
          color: #8b949e;
          margin-bottom: 6px;
        }
        .dsh-peer-input, .dsh-peer-textarea, .dsh-peer-select {
          width: 100%;
          background: #0d1117;
          border: 1px solid #30363d;
          border-radius: 6px;
          color: #f0f6fc;
          padding: 8px 10px;
          font-size: 13px;
          box-sizing: border-box;
          outline: none;
        }
        .dsh-peer-input:focus, .dsh-peer-textarea:focus, .dsh-peer-select:focus {
          border-color: #58a6ff;
        }
        .dsh-peer-checkbox-row {
          display: flex;
          align-items: center;
          gap: 8px;
          font-size: 13px;
          color: #f0f6fc;
          margin-bottom: 12px;
          cursor: pointer;
        }
        .dsh-peer-preview-box {
          background: #0d1117;
          border: 1px solid #30363d;
          border-radius: 6px;
          padding: 12px;
          font-size: 13px;
          max-height: 200px;
          overflow-y: auto;
          white-space: pre-wrap;
          font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
          color: #c9d1d9;
        }
        .dsh-peer-pulse {
          display: inline-block;
          width: 8px;
          height: 8px;
          border-radius: 50%;
          background: #3fb950;
          box-shadow: 0 0 8px #3fb950;
          margin-right: 6px;
        }
      `;
      document.head.appendChild(style);
    }

    // 宿主同源 RPC 通道。
    //
    // 面板以前直接跨源 fetch `127.0.0.1:8765-8770/api/*`。控制面现在要求
    // x-peer-token，而**凭据不能下发到浏览器**，所以改走宿主 Connection 注册的
    // 同源路由（见 index.js 的 handlePanelRpc）：Host/Origin 围栏和会话鉴权由宿主
    // 代做，真实 token 由宿主在服务端使用，浏览器这一侧一个凭据都不持有。
    //
    // 附带好处：不再需要在 8765-8770 之间探端口——以前那段探测本身就有把本机
    // 其他服务误认成 Peer Link 的风险。路由路径是固定的，插件没加载就是 404。
    const RPC_ROUTE = "api/peer-link.rpc";

    async function apiRequest(endpoint, method = "GET", data = null) {
      let res;
      try {
        res = await fetch(RPC_ROUTE, {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endpoint, method, data }),
        });
      } catch {
        throw new Error("无法连接宿主服务，请确认 Peer Link 插件已加载。");
      }
      if (res.status === 404) {
        throw new Error("Peer Link 的宿主路由未注册（插件可能未启动）。");
      }
      const payload = await res.json().catch(() => null);
      if (!res.ok || !payload || payload.ok !== true) {
        const msg =
          payload && typeof payload.error === "string"
            ? payload.error
            : `宿主返回 HTTP ${res.status}`;
        throw new Error(msg);
      }
      return payload.data;
    }

    // 侧边栏图标组件
    function PeerSidebarIcon() {
      const [online, setOnline] = React.useState(false);

      React.useEffect(() => {
        let isMounted = true;
        const check = async () => {
          try {
            const data = await apiRequest("/api/status");
            if (isMounted) {
              const hasOnline = (data.peers || []).some(p => p.online);
              setOnline(hasOnline);
            }
          } catch {
            if (isMounted) setOnline(false);
          }
        };
        check();
        const timer = setInterval(check, 8000);
        return () => { isMounted = false; clearInterval(timer); };
      }, []);

      return h("span", { style: { position: "relative", display: "inline-flex", alignItems: "center" } },
        h("svg", {
          width: 18,
          height: 18,
          viewBox: "0 0 24 24",
          fill: "none",
          stroke: "currentColor",
          strokeWidth: 2,
          strokeLinecap: "round",
          strokeLinejoin: "round"
        },
          h("circle", { cx: 18, cy: 5, r: 3 }),
          h("circle", { cx: 6, cy: 12, r: 3 }),
          h("circle", { cx: 18, cy: 19, r: 3 }),
          h("line", { x1: 8.59, y1: 13.51, x2: 15.42, y2: 17.49 }),
          h("line", { x1: 15.41, y1: 6.51, x2: 8.59, y2: 10.49 })
        ),
        online ? h("span", {
          style: {
            position: "absolute",
            top: -2,
            right: -2,
            width: 7,
            height: 7,
            borderRadius: "50%",
            backgroundColor: "#3fb950",
            boxShadow: "0 0 6px #3fb950"
          }
        }) : null
      );
    }

    // 主面板组件
    function PeerMainPanel(props) {
      ensureStyles();

      const [statusData, setStatusData] = React.useState(null);
      const [loading, setLoading] = React.useState(true);
      const [error, setError] = React.useState(null);

      // 编辑本机名片状态
      const [editingProfile, setEditingProfile] = React.useState(false);
      const [profileName, setProfileName] = React.useState("");
      const [profileAvatar, setProfileAvatar] = React.useState("🤖");
      const [profileRole, setProfileRole] = React.useState("");

      // 添加对端状态
      const [addingPeer, setAddingPeer] = React.useState(false);
      const [newPeerName, setNewPeerName] = React.useState("");
      const [newPeerUrl, setNewPeerUrl] = React.useState("");

      // 人类发信控制台
      const [targetPeerId, setTargetPeerId] = React.useState("");
      const [topic, setTopic] = React.useState("");
      const [message, setMessage] = React.useState("");
      const [isHuman, setIsHuman] = React.useState(true);
      const [sending, setSending] = React.useState(false);
      const [sendResult, setSendResult] = React.useState(null);

      // 选中的审计会话
      const [selectedSession, setSelectedSession] = React.useState(null);
      const [sessionDetail, setSessionDetail] = React.useState("");

      const loadStatus = async () => {
        try {
          setLoading(true);
          const data = await apiRequest("/api/status");
          setStatusData(data);
          if (data.node) {
            setProfileName(data.node.name || "");
            setProfileAvatar(data.node.avatar || "🤖");
            setProfileRole(data.node.role || "");
          }
          if (data.peers && data.peers.length > 0 && !targetPeerId) {
            setTargetPeerId(data.peers[0].id);
          }
          setError(null);
        } catch (e) {
          setError(e.message);
        } finally {
          setLoading(false);
        }
      };

      React.useEffect(() => {
        loadStatus();
      }, []);

      const handleSaveProfile = async () => {
        try {
          await apiRequest("/api/profile", "POST", {
            name: profileName,
            avatar: profileAvatar,
            role: profileRole,
          });
          setEditingProfile(false);
          await loadStatus();
        } catch (e) {
          alert("保存失败: " + e.message);
        }
      };

      const handleAddPeer = async () => {
        if (!newPeerUrl) return;
        try {
          await apiRequest("/api/peers", "POST", {
            name: newPeerName || "新对等电脑",
            url: newPeerUrl,
          });
          setAddingPeer(false);
          setNewPeerName("");
          setNewPeerUrl("");
          await loadStatus();
        } catch (e) {
          alert("添加失败: " + e.message);
        }
      };

      const handleRemovePeer = async (id) => {
        if (!confirm("确定移除该对等节点吗？")) return;
        try {
          await apiRequest("/api/peers", "DELETE", { id });
          await loadStatus();
        } catch (e) {
          alert("移除失败: " + e.message);
        }
      };

      const handlePing = async (peerId) => {
        try {
          const res = await apiRequest("/api/ping", "POST", { peerId });
          if (res.ok && res.result?.ok) {
            alert(`探测成功！延迟: ${res.result.durationMs}ms`);
          } else {
            alert(`探测失败: ${res.result?.error || '无法连通'}`);
          }
          await loadStatus();
        } catch (e) {
          alert("探测异常: " + e.message);
        }
      };

      const handleRadarScan = async () => {
        try {
          await apiRequest("/api/scan", "POST");
          setTimeout(loadStatus, 700);
        } catch (e) {
          alert("雷达扫描失败: " + e.message);
        }
      };

      const handleSendMessage = async () => {
        if (!message) return;
        try {
          setSending(true);
          const res = await apiRequest("/api/send", "POST", {
            peerId: targetPeerId,
            topic: topic || "Web控制台人工发信",
            message,
            as_human: isHuman,
          });
          setSendResult(res);
          setMessage("");
          await loadStatus();
        } catch (e) {
          alert("发信失败: " + e.message);
        } finally {
          setSending(false);
        }
      };

      const handleSelectLedger = (item) => {
        setSelectedSession(item);
        if (item.sessionPath) {
          const filename = item.sessionPath.split("/").pop();
          apiRequest(`/api/session?file=${encodeURIComponent(filename)}`)
            .then(text => {
              // 文本返回
              setSessionDetail(typeof text === "string" ? text : JSON.stringify(text, null, 2));
            })
            .catch(() => setSessionDetail("无法加载会话内容"));
        }
      };

      const myNode = statusData?.node || { name: "本地节点", avatar: "🤖", role: "全栈开发" };
      const peers = statusData?.peers || [];
      const ledger = statusData?.recentLedger || [];
      const onlineCount = peers.filter(p => p.online).length;

      return h("div", { className: "dsh-peer-container" },
        // 头部
        h("div", { className: "dsh-peer-header" },
          h("div", { className: "dsh-peer-title-group" },
            h("h2", { className: "dsh-peer-title" }, "🤝 跨电脑对等协同网络 (Peer Link)"),
            h("span", { className: `dsh-peer-badge ${onlineCount > 0 ? "online" : "offline"}` },
              onlineCount > 0 ? `${onlineCount} 台对端在线` : "暂无对端在线"
            )
          ),
          h("div", { className: "dsh-peer-actions" },
            h("button", { className: "dsh-peer-btn", onClick: handleRadarScan }, "📡 局域网雷达扫描"),
            h("button", { className: "dsh-peer-btn", onClick: loadStatus }, "🔄 刷新"),
            h("button", { className: "dsh-peer-btn", onClick: () => handlePing() }, "⚡ Ping 首选节点")
          )
        ),

        // 主体
        h("div", { className: "dsh-peer-body" },
          // 1. 本机身份卡片
          h("div", { className: "dsh-peer-card" },
            h("div", { className: "dsh-peer-card-header" },
              h("div", { className: "dsh-peer-card-title" }, "本机节点档案 (My Identity)"),
              !editingProfile
                ? h("button", { className: "dsh-peer-btn", onClick: () => setEditingProfile(true) }, "✏️ 编辑名片")
                : h("div", { style: { display: "flex", gap: "6px" } },
                    h("button", { className: "dsh-peer-btn primary", onClick: handleSaveProfile }, "保存"),
                    h("button", { className: "dsh-peer-btn", onClick: () => setEditingProfile(false) }, "取消")
                  )
            ),
            !editingProfile
              ? h("div", { className: "dsh-peer-profile-row" },
                  h("div", { className: "dsh-peer-avatar" }, myNode.avatar || "🤖"),
                  h("div", { className: "dsh-peer-info" },
                    h("div", { className: "dsh-peer-name" },
                      myNode.name,
                      h("span", { style: { fontSize: "12px", color: "#3fb950", background: "rgba(46,160,67,0.15)", padding: "2px 6px", borderRadius: "4px" } },
                        `端口: ${statusData?.activePort || 8765}`
                      )
                    ),
                    h("div", { className: "dsh-peer-role" }, myNode.role || "未设置角色定位")
                  )
                )
              : h("div", { style: { display: "flex", flexDirection: "column", gap: "10px" } },
                  h("div", { style: { display: "flex", gap: "10px" } },
                    h("div", { style: { width: "120px" } },
                      h("label", { className: "dsh-peer-label" }, "选择头像"),
                      h("select", {
                        className: "dsh-peer-select",
                        value: profileAvatar,
                        onChange: (e) => setProfileAvatar(e.target.value)
                      },
                        ["🤖 机器人", "💻 笔记本", "🖥 工作站", "🧠 智脑", "⚡ 闪电", "🚀 火箭", "🛡 守卫", "👨‍💻 工程师", "👩‍💻 架构师"].map(a =>
                          h("option", { key: a, value: a.split(" ")[0] }, a)
                        )
                      )
                    ),
                    h("div", { style: { flex: 1 } },
                      h("label", { className: "dsh-peer-label" }, "节点名称"),
                      h("input", {
                        className: "dsh-peer-input",
                        value: profileName,
                        onChange: (e) => setProfileName(e.target.value),
                        placeholder: "例如: MacBook Pro (前端)"
                      })
                    )
                  ),
                  h("div", null,
                    h("label", { className: "dsh-peer-label" }, "分工角色描述"),
                    h("input", {
                      className: "dsh-peer-input",
                      value: profileRole,
                      onChange: (e) => setProfileRole(e.target.value),
                      placeholder: "例如: 前端开发 · iOS 界面与组件库"
                    })
                  )
                )
          ),

          // 2. 对等节点花名册 (Roster)
          h("div", { className: "dsh-peer-card" },
            h("div", { className: "dsh-peer-card-header" },
              h("div", { className: "dsh-peer-card-title" }, `对等电脑通讯录 (${peers.length} 台)`),
              h("button", { className: "dsh-peer-btn", onClick: () => setAddingPeer(!addingPeer) },
                addingPeer ? "关闭添加" : "+ 添加对等电脑"
              )
            ),
            addingPeer ? h("div", {
              style: {
                background: "#0d1117",
                border: "1px solid #30363d",
                borderRadius: "6px",
                padding: "12px",
                marginBottom: "14px",
                display: "flex",
                gap: "10px",
                alignItems: "flex-end"
              }
            },
              h("div", { style: { flex: 1 } },
                h("label", { className: "dsh-peer-label" }, "电脑名称"),
                h("input", {
                  className: "dsh-peer-input",
                  value: newPeerName,
                  onChange: (e) => setNewPeerName(e.target.value),
                  placeholder: "例如: Linux 工作站 (后端)"
                })
              ),
              h("div", { style: { flex: 2 } },
                h("label", { className: "dsh-peer-label" }, "对端 URL (IP:端口)"),
                h("input", {
                  className: "dsh-peer-input",
                  value: newPeerUrl,
                  onChange: (e) => setNewPeerUrl(e.target.value),
                  placeholder: "http://192.168.1.100:8765"
                })
              ),
              h("button", { className: "dsh-peer-btn primary", onClick: handleAddPeer }, "添加确认")
            ) : null,
            h("div", { className: "dsh-peer-roster" },
              peers.map((peer) =>
                h("div", {
                  key: peer.id || peer.url,
                  className: `dsh-peer-node-card ${peer.online ? "online" : ""}`
                },
                  h("div", { className: "dsh-peer-node-top" },
                    h("div", { className: "dsh-peer-node-avatar" }, peer.avatar || "🖥"),
                    h("div", { className: "dsh-peer-node-meta" },
                      h("div", { className: "dsh-peer-node-title" },
                        peer.name,
                        peer.autoDiscovered
                          ? h("span", { style: { marginLeft: "6px", fontSize: "11px", color: "#a371f7", background: "rgba(163,113,247,0.15)", padding: "1px 5px", borderRadius: "4px" } }, "📡 雷达发现")
                          : null
                      ),
                      h("div", { className: "dsh-peer-node-sub" }, peer.role || "对等协作者")
                    ),
                    peer.online
                      ? h("span", { className: "dsh-peer-badge online" }, `${peer.latencyMs || 1}ms`)
                      : h("span", { className: "dsh-peer-badge offline" }, "离线")
                  ),
                  h("div", { className: "dsh-peer-node-url" }, peer.url),
                  h("div", { className: "dsh-peer-node-actions" },
                    h("button", { className: "dsh-peer-btn", onClick: () => handlePing(peer.id) }, "⚡ 探测"),
                    h("button", { className: "dsh-peer-btn", onClick: () => handleRemovePeer(peer.id) }, "🗑 移除")
                  )
                )
              )
            )
          ),

          // 3. 跨机对账留痕 & 人类直接发信工作台
          h("div", { className: "dsh-peer-workbench" },
            // 左侧：留痕流水
            h("div", { className: "dsh-peer-card", style: { display: "flex", flexDirection: "column" } },
              h("div", { className: "dsh-peer-card-header" },
                h("div", { className: "dsh-peer-card-title" }, "📜 跨电脑对账留痕簿 (Trace Ledger)")
              ),
              h("div", { className: "dsh-peer-list" },
                ledger.length === 0
                  ? h("div", { style: { color: "#8b949e", fontSize: "13px", padding: "10px" } }, "暂无跨机交流记录")
                  : ledger.map((item, idx) =>
                      h("div", {
                        key: item.trace_id + idx,
                        className: `dsh-peer-list-item ${selectedSession?.trace_id === item.trace_id ? "active" : ""}`,
                        onClick: () => handleSelectLedger(item)
                      },
                        h("div", { className: "dsh-peer-list-item-top" },
                          h("span", null,
                            item.direction === "outbound" ? "📤 发出给 " : "📥 接收自 ",
                            h("strong", null, item.peer)
                          ),
                          h("span", null,
                            item.sender_type === "human" ? "👤 人类" : "🤖 智能体",
                            ` · ${new Date(item._ts || Date.now()).toLocaleTimeString()}`
                          )
                        ),
                        h("div", { className: "dsh-peer-list-item-title" }, item.topic || "跨机交流"),
                        h("div", { style: { fontSize: "11px", color: "#58a6ff", marginTop: "4px" } }, item.trace_id)
                      )
                    )
              )
            ),

            // 右侧：人工发信与详情
            h("div", { className: "dsh-peer-card", style: { display: "flex", flexDirection: "column" } },
              h("div", { className: "dsh-peer-card-header" },
                h("div", { className: "dsh-peer-card-title" },
                  selectedSession ? `📄 会话详情: ${selectedSession.trace_id}` : "💬 人工跨机指令投递"
                ),
                selectedSession
                  ? h("button", { className: "dsh-peer-btn", onClick: () => { setSelectedSession(null); setSessionDetail(""); } }, "返回发信")
                  : null
              ),
              selectedSession
                ? h("div", { className: "dsh-peer-preview-box", style: { flex: 1, maxHeight: "380px" } }, sessionDetail || "正在读取归档...")
                : h("div", { style: { display: "flex", flexDirection: "column", flex: 1 } },
                    h("div", { className: "dsh-peer-input-group" },
                      h("label", { className: "dsh-peer-label" }, "目标电脑"),
                      h("select", {
                        className: "dsh-peer-select",
                        value: targetPeerId,
                        onChange: (e) => setTargetPeerId(e.target.value)
                      },
                        peers.map(p => h("option", { key: p.id, value: p.id }, `${p.avatar || '🖥'} ${p.name} (${p.url})`))
                      )
                    ),
                    h("label", { className: "dsh-peer-checkbox-row" },
                      h("input", {
                        type: "checkbox",
                        checked: isHuman,
                        onChange: (e) => setIsHuman(e.target.checked)
                      }),
                      h("span", null, "👤 作为人类操作者直接派发指令（最高业务优先级）")
                    ),
                    h("div", { className: "dsh-peer-input-group" },
                      h("label", { className: "dsh-peer-label" }, "沟通主题"),
                      h("input", {
                        className: "dsh-peer-input",
                        value: topic,
                        onChange: (e) => setTopic(e.target.value),
                        placeholder: "例如: 核对用户模型最后登录字段"
                      })
                    ),
                    h("div", { className: "dsh-peer-input-group", style: { flex: 1 } },
                      h("label", { className: "dsh-peer-label" }, "指令 / 提议内容"),
                      h("textarea", {
                        className: "dsh-peer-textarea",
                        style: { height: "90px", resize: "none" },
                        value: message,
                        onChange: (e) => setMessage(e.target.value),
                        placeholder: "输入要发送给另一台电脑上 DSH 的消息内容..."
                      })
                    ),
                    sendResult ? h("div", {
                      style: {
                        background: "rgba(46,160,67,0.1)",
                        border: "1px solid rgba(46,160,67,0.3)",
                        padding: "8px 10px",
                        borderRadius: "6px",
                        fontSize: "12px",
                        marginBottom: "10px",
                        color: "#3fb950"
                      }
                    },
                      h("strong", null, "✅ 对端已应答: "),
                      sendResult.reply
                    ) : null,
                    h("button", {
                      className: "dsh-peer-btn primary",
                      style: { justifyContent: "center", padding: "10px" },
                      disabled: sending || !message,
                      onClick: handleSendMessage
                    },
                      sending ? "正在跨机投递..." : "🚀 发送到对端电脑"
                    )
                  )
            )
          )
        )
      );
    }

    // 导出客户端插件规范
    const clientPlugin = {
      name: "dsh-plugin-peer-link/client",
      inject: ["slots"],
      apply(ctx) {
        const slots = ctx.get?.("slots") || ctx.slots;
        if (!slots) return;

        const disposers = [];

        // 注册侧边栏入口
        try {
          if (slots.inject && slots.register) {
            disposers.push(
              slots.inject("sidebar.panellist", () =>
                slots.register(
                  {
                    name: "sidebar.panellist",
                    id: "dsh-plugin-peer-link",
                    order: 12,
                    label: () => "对等协同",
                  },
                  PeerSidebarIcon
                )
              )
            );

            // 注册主屏面板
            disposers.push(
              slots.inject("main", () =>
                slots.register(
                  {
                    name: "main",
                    key: "dsh-plugin-peer-link",
                  },
                  PeerMainPanel
                )
              )
            );
          }
        } catch (e) {
          console.error("[dsh-plugin-peer-link] Client mounting error:", e);
        }

        return () => {
          for (const d of disposers) {
            try { d(); } catch {}
          }
        };
      },
    };

    return clientPlugin;
  },
});
