# Mori API

Mori 的服务端边界。当前仓库尚未实现生产后端，因此这里不放置伪造接口或临时内存服务器。

未来后端负责：

- Mori 用户身份与会话；
- Spotify OAuth 回调、Refresh Token 加密存储和短期 Token 签发；
- AI Provider 调用与限流；
- 对话、音乐记忆和跨设备同步；
- 隐私授权、审计日志和数据删除。

Extension UI、Chrome Service Worker 和 Player Host 都不属于后端。新增后端实现时应按 `auth/`、`spotify/`、`companion/`、`memory/`、`users/`、`database/` 分类，并通过 `packages/contracts/` 暴露前后端契约。
