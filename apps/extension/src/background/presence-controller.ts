/**
 * 作用：管理 Mori 的全局显示状态、工具栏点击行为及页面注入恢复。
 * 输入：Chrome 工具栏点击事件、已保存的 Presence 状态和当前标签页信息。
 * 输出：持久化后的显示状态、页面注入操作，以及发往各 HTTP(S) 标签页的可见性消息。
 */
import type { TabMessage } from '../shared/messages'
import { broadcastTabMessage } from '../shared/tab-messaging'
import { extensionStorage } from '../storage/extension-storage'

export class PresenceController {
  #enabled = false

  get enabled() { return this.#enabled }

  async restore() {
    this.#enabled = await extensionStorage.getPresenceEnabled()
  }

  async toggleFromToolbar(tab: chrome.tabs.Tab) {
    if (!tab.id || !tab.url || !/^https?:/.test(tab.url)) {
      if (tab.id) {
        await chrome.action.setBadgeBackgroundColor({ color: '#d45472', tabId: tab.id })
        await chrome.action.setBadgeText({ text: '!', tabId: tab.id })
        await chrome.action.setTitle({ title: 'Mori 只能悬浮在普通 HTTP(S) 网页中', tabId: tab.id })
      }
      throw new Error('Mori 只能悬浮在普通 HTTP(S) 网页中')
    }
    if (!await extensionStorage.getToken()) {
      await chrome.runtime.openOptionsPage()
      return
    }

    this.#enabled = !this.#enabled
    await extensionStorage.setPresenceEnabled(this.#enabled)
    await chrome.action.setBadgeText({ text: '', tabId: tab.id })
    await this.ensureCurrentTab(tab.id)
    await this.broadcast()
  }

  private async ensureCurrentTab(tabId: number) {
    const message: TabMessage = { type: 'MORI_SET_VISIBILITY', visible: this.#enabled }
    try {
      await chrome.tabs.sendMessage(tabId, message)
    } catch {
      // Pages opened before installing/updating the extension do not have the static content script.
      // Injecting once avoids forcing the user to refresh just because the extension was upgraded.
      await chrome.scripting.executeScript({ target: { tabId }, files: ['build/src/content/content.js'] })
      await chrome.tabs.sendMessage(tabId, message)
    }
  }

  private async broadcast() {
    const message: TabMessage = { type: 'MORI_SET_VISIBILITY', visible: this.#enabled }
    await broadcastTabMessage(message, (tab) => Boolean(tab.url && /^https?:/.test(tab.url)))
  }
}
