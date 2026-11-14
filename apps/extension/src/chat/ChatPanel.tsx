/**
 * 作用：渲染 Mori 对话记录和消息输入表单，并提交用户消息。
 * 输入：ConversationMessage 列表和异步 onSend 回调。
 * 输出：对话面板 React UI，以及通过回调发送的用户文本。
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import type { ConversationMessage } from '@mori/domain'

type Props = {
  messages: ConversationMessage[]
  onSend: (text: string) => Promise<void>
  sending: boolean
  sendError: string
}

export function ChatPanel({ messages, onSend, sending, sendError }: Props) {
  const [draft, setDraft] = useState('')
  const conversationRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const wasSending = useRef(sending)
  const [revealingId, setRevealingId] = useState<string | null>(null)
  const visibleMessages = useMemo(() => messages.filter((message) => message.text?.trim()), [messages])

  useEffect(() => {
    // 只在本次请求由“等待”变为“完成”时播放新回复；重新打开面板不会重播历史消息。
    if (wasSending.current && !sending) {
      const latest = [...visibleMessages].reverse().find((message) => message.role === 'mori')
      if (latest) setRevealingId(latest.id)
    }
    wasSending.current = sending
  }, [sending, visibleMessages])

  useLayoutEffect(() => {
    const conversation = conversationRef.current
    if (!conversation) return
    // Set the final position in the same layout pass. Smooth scrolling was repeatedly interrupted
    // by panel renders and could leave an old, partially clipped bubble looking like an empty block.
    conversation.scrollTop = conversation.scrollHeight
  }, [visibleMessages.length, sending, sendError])

  async function submit(event: FormEvent) {
    event.preventDefault()
    const text = draft.trim()
    if (!text || sending) return
    // Local models can take tens of seconds. Commit the user's intent to the visible timeline
    // immediately, then keep the composer focused while the single in-flight request completes.
    setDraft('')
    queueMicrotask(() => inputRef.current?.focus())
    try { await onSend(text) }
    catch (error) {
      setDraft((current) => current || text)
    } finally {
      queueMicrotask(() => inputRef.current?.focus())
    }
  }

  return <section className="feature-view chat-panel" aria-label="和 Mori 聊聊">
    <div ref={conversationRef} className="conversation" aria-live="polite">
      {visibleMessages.length
        ? visibleMessages.map((message) => <p key={message.id} className={message.role} aria-label={message.text}>
          {message.id === revealingId ? <TypewriterText text={message.text} onProgress={() => {
            const conversation = conversationRef.current
            if (conversation) conversation.scrollTop = conversation.scrollHeight
          }} onComplete={() => setRevealingId(null)} /> : message.text}
        </p>)
        : <p className="mori">我在。想聊聊现在听到的歌吗？</p>}
      {sending && <p className="mori thinking" aria-label="Mori 正在思考"><span>正在想</span><i /><i /><i /></p>}
      {sendError && <p className="chat-error" role="alert">{sendError}</p>}
    </div>
    <form className="chat-form" onSubmit={submit}>
      <input ref={inputRef} value={draft} onChange={(event) => setDraft(event.target.value)} placeholder={sending ? '可以先写下一句…' : '和 Mori 聊聊…'} aria-label="和 Mori 聊聊" autoFocus />
      <button type="submit" className={sending ? 'busy' : ''} disabled={!draft.trim() || sending}>{sending ? '思考中' : '发送'}</button>
    </form>
  </section>
}

function TypewriterText({ text, onProgress, onComplete }: { text: string; onProgress: () => void; onComplete: () => void }) {
  const [length, setLength] = useState(0)
  const onCompleteRef = useRef(onComplete)
  const onProgressRef = useRef(onProgress)
  onCompleteRef.current = onComplete
  onProgressRef.current = onProgress

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setLength(text.length)
      onCompleteRef.current()
      return
    }
    let frame = 0
    const startedAt = performance.now()
    // 长回复仍控制在约 1.2～3.6 秒，既有逐字感，也不会让用户长时间等待显示。
    const duration = Math.min(3_600, Math.max(1_200, text.length * 32))
    const reveal = (now: number) => {
      const next = Math.min(text.length, Math.ceil(((now - startedAt) / duration) * text.length))
      setLength(next)
      onProgressRef.current()
      if (next >= text.length) onCompleteRef.current()
      else frame = requestAnimationFrame(reveal)
    }
    frame = requestAnimationFrame(reveal)
    return () => cancelAnimationFrame(frame)
  }, [text])

  return <>{text.slice(0, length)}<span className="typing-caret" aria-hidden="true">▍</span></>
}
