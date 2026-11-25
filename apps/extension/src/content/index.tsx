/**
 * 作用：在普通网页中创建隔离的 Shadow DOM，并挂载 Mori React 应用。
 * 输入：Extension 构建内联样式、当前网页 DOM 和 content script 生命周期。
 * 输出：页面中的单一 Mori Shadow DOM 宿主及 MoriPresence React 根节点。
 */
import { createRoot, type Root } from 'react-dom/client'
import { MoriPresence } from '../mori/MoriPresence'
import styles from './styles.css?inline'

declare global { var __moriPresenceRoot: Root | undefined }

// Explicit reinjection means the background needs a client from the current build. A global mount
// flag belongs to one isolated world and can survive while its DOM/listener is stale, so the marked
// host is the visual idempotency boundary. When reinjecting into the same world, unmount first so
// React also removes runtime/document listeners instead of leaving an invisible duplicate client.
globalThis.__moriPresenceRoot?.unmount()
document.querySelectorAll('#mori-extension-presence, [data-mori-extension-root]').forEach((node) => node.remove())
const host = document.createElement('div')
host.id = 'mori-extension-presence'
host.dataset.moriExtensionRoot = 'true'
// React and all component styles stay inside Shadow DOM. The host page only sees one inert node,
// which prevents Mori from changing layout or inheriting arbitrary site CSS.
const shadow = host.attachShadow({ mode: 'closed' })
const style = document.createElement('style')
style.textContent = styles
const mount = document.createElement('div')
shadow.append(style, mount)
// Shadow DOM 隔离样式和节点，但键盘、输入法与剪贴板事件默认是 composed，仍会越过
// Shadow Host 冒泡到宿主页面并触发 GitHub 等站点的全局快捷键。React 在 mount 上先完成
// 自己的事件处理，随后由 ShadowRoot 的冒泡边界截断传播；不 preventDefault，保留输入法、
// 文本编辑、复制粘贴和浏览器原生行为。
const isolatedEvents = [
  'keydown', 'keyup', 'keypress',
  'beforeinput', 'input',
  'compositionstart', 'compositionupdate', 'compositionend',
  'paste', 'copy', 'cut',
  'focusin', 'focusout', 'submit',
] as const
for (const type of isolatedEvents) shadow.addEventListener(type, stopAtMoriBoundary)
document.documentElement.append(host)
globalThis.__moriPresenceRoot = createRoot(mount)
globalThis.__moriPresenceRoot.render(<MoriPresence />)

function stopAtMoriBoundary(event: Event) { event.stopPropagation() }
