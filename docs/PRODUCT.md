# Mori 产品定义

Mori 是住在浏览器里的 AI 音乐知音伙伴。

- Spotify 是 Music Provider，负责账号、曲库、音频、DRM 和 Connect 会话。
- Mori 是 Music Companion 与 Music Interaction Layer，负责陪听、轻量控制、对话和授权记忆。
- 用户不需要先打开 Spotify Web Player；Mori 在任意普通网页上悬浮。
- Mori 不复制完整 Spotify Client，不读取 Spotify DOM，不下载或修改 Spotify 音频。

核心体验：连接 Spotify → 召唤 Mori → 点击播放 → Mori 进入 listening → 浏览其他网页时音乐与陪伴持续。

当前 MVP 中，“点击播放”表示恢复账号已有的 Spotify 播放上下文。首次没有可恢复歌曲时，用户先在 Mori 的歌单面板选择一首歌；Mori 不凭空决定播放内容，也不要求打开 Spotify Web Player。
