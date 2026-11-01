/**
 * 作用：向符合条件的浏览器标签页广播类型化 Extension 消息。
 * 输入：TabMessage 和可选的标签页筛选函数。
 * 输出：等待所有发送尝试完成的 Promise；单个标签失败不会中断其他发送。
 */
import type { TabMessage } from './messages'

export async function broadcastTabMessage(
  message: TabMessage,
  includes: (tab: chrome.tabs.Tab) => boolean = () => true,
) {
  const tabs = await chrome.tabs.query({})
  // Tabs without an injected content script are normal (Chrome pages, discarded tabs, pages
  // opened before an update). One rejected delivery must not block synchronization to other tabs.
  await Promise.allSettled(
    tabs
      .filter((tab): tab is chrome.tabs.Tab & { id: number } => tab.id !== undefined && includes(tab))
      .map((tab) => chrome.tabs.sendMessage(tab.id, message)),
  )
}
