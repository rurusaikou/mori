# Mori API

Mori 的服务端边界。当前包含本地开发使用的音乐特征代理；它让 `MELODATA_API_KEY` 保持在 Extension 之外。该服务不是生产后端，也不持久化用户画像。

```bash
pnpm dev:api
```

启动脚本会从仓库根目录的 `.env.local` 读取 `MELODATA_API_KEY`。默认监听 `http://127.0.0.1:3211`，提供 `POST /music-profile`。Extension 负责采样 Spotify 曲库和本地保存最终画像；服务按 ISRC 将歌曲特征持久化到忽略上传的 `apps/api/data/music-features.json`。重新分析时只请求缓存中不存在的歌曲，且每完成一个小批次就原子写盘，避免重启或中途限流浪费已经消耗的查询次数。

未来后端负责：

- Mori 用户身份与会话；
- Spotify OAuth 回调、Refresh Token 加密存储和短期 Token 签发；
- AI Provider 调用与限流；
- 对话、音乐记忆和跨设备同步；
- 隐私授权、审计日志和数据删除。

Extension UI、Chrome Service Worker 和 Player Host 都不属于后端。新增后端实现时应按 `auth/`、`spotify/`、`companion/`、`memory/`、`users/`、`database/` 分类，并通过 `packages/contracts/` 暴露前后端契约。
