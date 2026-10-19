/** Only sourced, significant business notifications may interrupt idle. */
export class NotificationGate {
  private seen = new Map<string, number>()
  private last = -Infinity
  accept(value: { severity?: string; eventId?: number; deviceId?: string; text: string }, now = Date.now()): boolean {
    if (!value.eventId || !value.deviceId || !['critical', 'warning'].includes(value.severity ?? '')) return false
    const key = `${value.eventId}|${value.deviceId}|${value.severity}|${value.text}`
    if (now - (this.seen.get(key) ?? -Infinity) < 300000 || now - this.last < (value.severity === 'critical' ? 3000 : 30000)) return false
    this.last = now
    this.seen.set(key, now)
    if (this.seen.size > 100) this.seen.delete(this.seen.keys().next().value!)
    return true
  }
}
