export interface PresenceRow<T> { id: string; item: T; exiting: boolean; entering: boolean }
/** Stable business IDs survive refresh. Removed rows are inert until settled. */
export function reconcileRows<T>(previous: PresenceRow<T>[], next: T[], id: (item: T) => string): PresenceRow<T>[] {
  const ids = new Set(next.map(id))
  return [
    ...next.map(item => ({ id: id(item), item, exiting: false,
      entering: !previous.some(row => row.id === id(item) && !row.exiting) })),
    ...previous.filter(row => !ids.has(row.id)).map(row => ({ ...row, exiting: true })),
  ]
}
