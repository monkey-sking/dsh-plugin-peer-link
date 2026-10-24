// 测试用宿主：把插件按 DSH 的方式装配起来，不依赖真实 DSH 进程
import { apply } from '../index.js';

const tools = {};
const ctx = {
  systemPrompt: { context() {} },
  tools: { register(def) { tools[def.name] = def; } },
};

apply(ctx);
// 保持进程存活，由测试父进程负责终止
setInterval(() => {}, 60_000);
