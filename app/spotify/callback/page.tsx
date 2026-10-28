'use client'

import { useEffect, useRef, useState } from 'react'
import { completeSpotifyLogin } from '@/lib/spotify'

export default function SpotifyCallbackPage() {
  const [message, setMessage] = useState('正在完成 Spotify 连接…')
  const exchangeStarted = useRef(false)

  useEffect(() => {
    // Next.js 开发模式会重复执行 effect；授权码与 PKCE verifier 都只能交换一次。
    if (exchangeStarted.current) return
    exchangeStarted.current = true
    const params = new URLSearchParams(window.location.search)
    const error = params.get('error')
    const code = params.get('code')
    if (error || !code) { setMessage(error === 'access_denied' ? '你取消了 Spotify 授权' : 'Spotify 没有返回有效授权'); return }
    void completeSpotifyLogin(code, params.get('state'))
      .then(() => window.location.replace('/?screen=connect&spotify=connected'))
      .catch((cause) => setMessage(cause instanceof Error ? cause.message : 'Spotify 连接失败'))
  }, [])
  return <main className="grid min-h-dvh place-items-center bg-[#0c0918] px-6 text-center text-white"><div><div className="mx-auto mb-5 size-10 animate-spin rounded-full border-2 border-white/20 border-t-[#b995ff]" /><p>{message}</p><a href="/?screen=connect" className="mt-5 inline-block text-sm text-[#c9a8ff]">返回 Mori</a></div></main>
}
