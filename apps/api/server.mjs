/**
 * 作用：保留 Mori API 的稳定启动入口，并加载 src 中的 HTTP composition root。
 * 输入：Node 环境变量与启动命令。
 * 输出：由 src/server.mjs 创建的本地 Mori API 服务。
 */
import './src/server.mjs'
