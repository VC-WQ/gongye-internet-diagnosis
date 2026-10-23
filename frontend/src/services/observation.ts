/** A relapse immediately reconsults and ends in pending; the verdict preserves its cause. */
export function observationOutcome(result: {
  status_state?: string
  feedback_result?: { verdict?: string }
} | null | undefined): 'recovered' | 'relapsed' | 'observing' | 'unknown' {
  const verdict = result?.feedback_result?.verdict
  if (verdict === 'relapsed' || verdict === 'recovered') return verdict
  if (verdict === 'extend') return 'observing'
  if (result?.status_state === 'relapsed' || result?.status_state === 'recovered') return result.status_state
  return result?.status_state === 'observing' ? 'observing' : 'unknown'
}
