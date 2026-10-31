import { useState, type FormEvent } from 'react'
import type { ConversationMessage } from '@mori/domain'

type Props = {
  messages: ConversationMessage[]
  onSend: (text: string) => Promise<void>
}

export function ChatPanel({ messages, onSend }: Props) {
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)

  async function submit(event: FormEvent) {
    event.preventDefault()
    const text = draft.trim()
    if (!text || sending) return
    setSending(true)
    try { await onSend(text); setDraft('') } finally { setSending(false) }
  }

  return <section className="feature-view chat-panel" aria-label="和 Mori 聊聊">
    <div className="conversation" aria-live="polite">
      {messages.length
        ? messages.slice(-4).map((message) => <p key={message.id} className={message.role}>{message.text}</p>)
        : <p className="mori">我在。想聊聊现在听到的歌吗？</p>}
    </div>
    <form className="chat-form" onSubmit={submit}>
      <input value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="和 Mori 聊聊…" aria-label="和 Mori 聊聊" autoFocus />
      <button type="submit" disabled={!draft.trim() || sending}>发送</button>
    </form>
  </section>
}
