/**
 * 作用：在普通网页中创建隔离的 Shadow DOM，并挂载 Mori React 应用。
 * 输入：Extension 构建内联样式、当前网页 DOM 和 content script 生命周期。
 * 输出：页面中的单一 Mori Shadow DOM 宿主及 MoriPresence React 根节点。
 */
import { createRoot } from 'react-dom/client'
import { MoriPresence } from '../mori/MoriPresence'
import styles from './styles.css?inline'

declare global { var __moriPresenceMounted: boolean | undefined }

if (!globalThis.__moriPresenceMounted) {
  globalThis.__moriPresenceMounted = true
  // Reloading an unpacked extension destroys the old isolated JS world but does not remove DOM
  // nodes that world injected. Remove every marked stale host before mounting, otherwise each
  // extension reload can leave another Mori on long-lived pages or SPAs.
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
  document.documentElement.append(host)
  createRoot(mount).render(<MoriPresence />)
}
