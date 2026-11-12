/**
 * 作用：渲染 Mori 对话记录和消息输入表单，并提交用户消息。
 * 输入：ConversationMessage 列表和异步 onSend 回调。
 * 输出：对话面板 React UI，以及通过回调发送的用户文本。
 */
import { useLayoutEffect, useMemo, useRef, useState, type FormEvent } from 'react'
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
  const visibleMessages = useMemo(() => messages.filter((message) => message.text?.trim()), [messages])

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
        ? visibleMessages.map((message) => <p key={message.id} className={message.role}>{message.text}</p>)
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
