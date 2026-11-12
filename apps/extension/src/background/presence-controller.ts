/**
 * 作用：管理 Mori 的全局显示状态、工具栏点击行为及页面注入恢复。
 * 输入：Chrome 工具栏点击事件、已保存的 Presence 状态和当前标签页信息。
 * 输出：持久化后的显示状态、页面注入操作，以及发往各 HTTP(S) 标签页的可见性消息。
 */
import type { TabMessage } from '../shared/messages'
import { broadcastTabMessage } from '../shared/tab-messaging'
import { extensionStorage } from '../storage/extension-storage'
import { logInfo } from './logger'

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

    await this.setEnabled(!this.#enabled, tab.id)
    await chrome.action.setBadgeText({ text: '', tabId: tab.id })
  }

  async closeEverywhere() {
    // The service worker records one source-aware `mori_closed` event for a global close. Avoid a
    // second generic `presence_toggled=false` line that makes one action look like two transitions.
    await this.setEnabled(false, undefined, false)
  }

  private async setEnabled(enabled: boolean, currentTabId?: number, logToggle = true) {
    this.#enabled = enabled
    if (logToggle) logInfo('user_event', 'presence_toggled', { visible: enabled, tabId: currentTabId ?? null })
    await extensionStorage.setPresenceEnabled(enabled)
    if (currentTabId !== undefined) await this.ensureCurrentTab(currentTabId)
    await this.broadcast()
  }

  private async ensureCurrentTab(tabId: number) {
    const message: TabMessage = { type: 'MORI_SET_VISIBILITY', visible: this.#enabled }
    // Always execute the current bundle when the toolbar explicitly shows Mori. A stale content
    // world can still accept messages after an unpacked-extension reload while rendering no host.
    // The content entry replaces its marked host, so reinjection remains idempotent.
    await chrome.scripting.executeScript({ target: { tabId }, files: ['build/src/content/content.js'] })
    try {
      await chrome.tabs.sendMessage(tabId, message)
    } catch {
      // React registers its listener in an effect after executeScript resolves. A missed first
      // message is harmless because MoriPresence hydrates the persisted state on mount.
    }
  }

  private async broadcast() {
    const message: TabMessage = { type: 'MORI_SET_VISIBILITY', visible: this.#enabled }
    await broadcastTabMessage(message, (tab) => Boolean(tab.url && /^https?:/.test(tab.url)))
  }
}
