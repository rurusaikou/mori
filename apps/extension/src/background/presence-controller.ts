import type { TabMessage } from '../shared/messages'
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
    const tabs = await chrome.tabs.query({})
    await Promise.allSettled(tabs.filter((tab) => tab.id && tab.url && /^https?:/.test(tab.url)).map((tab) => chrome.tabs.sendMessage(tab.id!, message)))
  }
}
