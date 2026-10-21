import { useLayoutEffect, useRef, useState } from 'react'
import { reconcileRows, type PresenceRow } from './presenceState'
import { MOTION, prefersReducedMotion } from './tokens'

export function useRowPresence<T>(items: T[], getId: (item: T) => string) {
  const identity = items.map(getId).join('|')
  const latest = useRef(items)
  latest.current = items
  const idRef = useRef(getId)
  idRef.current = getId
  const generation = useRef(0)
  const [rows, setRows] = useState<PresenceRow<T>[]>(() => reconcileRows([], items, getId))
  useLayoutEffect(() => {
    const epoch = ++generation.current
    const reduced = prefersReducedMotion()
    setRows(old => reconcileRows(reduced ? [] : old, latest.current, idRef.current))
    if (reduced) return
    const timer = setTimeout(() => {
      if (generation.current === epoch) setRows(old => old.filter(row => !row.exiting).map(row => ({ ...row, entering: false })))
    }, MOTION.rowPresence.duration)
    return () => clearTimeout(timer)
  }, [identity])
  const current = new Map(items.map(item => [getId(item), item]))
  return rows.map(row => ({ ...row, item: current.get(row.id) ?? row.item }))
}
