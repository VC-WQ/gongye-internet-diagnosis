import { useLayoutEffect, useRef } from 'react'
import { Tabs, type TabsProps } from 'antd'
import { useUiPreferences } from '../services/uiPrefs'
import './mechanical.css'

/** Keep Ant's pane lifecycle. A leaving pane is visual only, never a second active form. */
export default function ContentTabs(props: TabsProps) {
  const host = useRef<HTMLDivElement>(null)
  const { reducedMotion } = useUiPreferences()
  useLayoutEffect(() => {
    const root = host.current
    if (!root) return
    const sync = () => root.querySelectorAll<HTMLElement>('[role="tabpanel"]').forEach(pane => {
      const leaving = pane.getAttribute('aria-hidden') === 'true'
      if (leaving && pane.contains(document.activeElement)) {
        root.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')?.focus({ preventScroll: true })
      }
      pane.inert = leaving
    })
    sync()
    const observer = new MutationObserver(sync)
    observer.observe(root, { subtree: true, childList: true, attributes: true, attributeFilter: ['aria-hidden'] })
    return () => observer.disconnect()
  }, [props.activeKey])
  return <div ref={host} className="content-tabs">
    <Tabs {...props} animated={reducedMotion ? false : { inkBar: true, tabPane: true }} destroyOnHidden />
  </div>
}
