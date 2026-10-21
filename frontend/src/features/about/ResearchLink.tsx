import { createContext, useContext, type AnchorHTMLAttributes, type MouseEvent, type ReactNode } from 'react'
import { useLocation } from 'react-router-dom'

export type ResearchAnchorHandler = (event: MouseEvent<HTMLAnchorElement>, id: string) => void
const Context = createContext<ResearchAnchorHandler | undefined>(undefined)
export function ResearchNavigationProvider({ onAnchor, children }: { onAnchor: ResearchAnchorHandler; children: ReactNode }) {
  return <Context.Provider value={onAnchor}>{children}</Context.Provider>
}
export default function ResearchLink({ anchor, children, ...props }: Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href' | 'onClick'> & { anchor: string }) {
  const onAnchor = useContext(Context)
  const location = useLocation()
  return <a {...props} href={`/research${location.search}#${anchor}`} onClick={event => onAnchor?.(event, anchor)}>{children}</a>
}
