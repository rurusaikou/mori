/**
 * LangGraph 只持有一次 Mori Run 的原始事实和节点结果。
 * Prompt 文本、Repository、Tool 实例和 LLM Client 都是可注入依赖，不进入 State，
 * 这样未来启用 Checkpointer 时不会尝试序列化连接池或函数闭包。
 */
import { Annotation } from '@langchain/langgraph'

const value = () => Annotation()

export const MoriGraphState = Annotation.Root({
  // Run identity：只用于一次请求的生命周期和观测，不参与模型判断。
  input: value(),
  runId: value(),
  started: value(),

  // Perception output：agentState 是规范化事实，context 是允许交给模型的最小上下文。
  // 二者分开保存，避免后续 Node 从 Prompt 输入反推播放状态等原始事实。
  agentState: value(),
  conversationUnderstanding: value(),
  understandingTokenUsage: value(),
  context: value(),

  // Brain output：Decision 只消费上方 Structured Understanding，选择回复或 Tool。
  decision: value(),

  // Model accounting：第一次调用和最终/修订调用分别保留，便于比较两种 Runtime。
  model: value(),
  firstTokenUsage: value(),
  tokenUsage: value(),

  // Action / Expression output：action 只是交给 Extension 的计划，不能表示 Spotify 已执行。
  toolName: value(),
  toolResult: value(),
  action: value(),
  finalResponse: value(),

  // 多个 Node 都会追加 Trace；reducer 必须只追加，才能保持 Legacy 的阶段顺序。
  trace: Annotation({ reducer: (current, update) => [...current, ...update], default: () => [] }),
})
