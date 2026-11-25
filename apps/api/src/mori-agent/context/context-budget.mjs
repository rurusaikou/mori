export const DEFAULT_CONTEXT_BUDGET = Object.freeze({
  personaChars: 4_000,
  runtimeChars: 1_800,
  memoryChars: 4_000,
  instructionsChars: 900,
  historyChars: 7_200,
  perMessageChars: 1_200,
  latestMessageChars: 4_000,
})

export function clipContextText(value, maxChars, suffix = '\n…（上下文预算截断）') {
  const text = String(value ?? '')
  if (text.length <= maxChars) return text
  if (maxChars <= suffix.length) return text.slice(0, maxChars)
  return `${text.slice(0, maxChars - suffix.length)}${suffix}`
}

export function fitHistoryToBudget(messages, budget = DEFAULT_CONTEXT_BUDGET) {
  const selected = []
  let remaining = budget.historyChars
  for (const message of [...messages].slice(-12).reverse()) {
    if (remaining <= 0) break
    const allowance = Math.min(budget.perMessageChars, remaining)
    const content = clipContextText(message.content, allowance)
    selected.push({ ...message, content })
    remaining -= content.length
  }
  return selected.reverse()
}

export function measureContext(messages) {
  const systemChars = messages.find((message) => message.role === 'system')?.content.length ?? 0
  const historyMessages = messages.filter((message) => message.role !== 'system')
  return {
    systemChars,
    historyChars: historyMessages.slice(0, -1).reduce((sum, message) => sum + message.content.length, 0),
    latestMessageChars: historyMessages.at(-1)?.content.length ?? 0,
    messageCount: messages.length,
  }
}