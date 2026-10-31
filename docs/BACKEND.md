# Mori 后端边界

## 当前状态

当前版本是本地优先 MVP：Spotify PKCE、对话 fallback 和记忆仍在 Extension trusted context 中运行。`apps/api/` 只定义生产后端边界，尚无部署服务。

## 生产目标

后端将负责身份、Spotify Refresh Token、AI API、持久记忆和跨设备同步。Extension 只保存 UI 偏好与当前会话快照，Player Host 只在内存中使用短期 Spotify access token。

```text
Extension → Mori API → Spotify / AI / Database
     │
     └→ Offscreen → Player Host → Spotify Web Playback SDK
```

## 安全原则

- AI Key 和数据库凭据只存在后端环境变量或 Secret Manager。
- Spotify Refresh Token 加密保存，Extension 只获得短期凭证。
- API 使用明确的用户会话、权限校验、限流和审计。
- 删除账户时同时删除对话、记忆、Provider token 和关联日志。
- Spotify 音频、歌词和平台内容不得发送给 AI 模型或用于训练。
