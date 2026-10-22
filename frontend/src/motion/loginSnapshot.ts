/** Password visibility changes the native type, but not the field's identity. */
export function isSensitiveLoginInput(input: HTMLInputElement): boolean {
  const autocomplete = (input.getAttribute('autocomplete') ?? '').toLowerCase().split(/\s+/)
  return input.type === 'password' || autocomplete.some((token) => token === 'current-password' || token === 'new-password') ||
    input.closest('[data-login-sensitive]') !== null
}

export function cloneSafe(node: HTMLElement): string {
  const clone = node.cloneNode(true) as HTMLElement
  const inputs = Array.from(node.querySelectorAll('input'))
  clone.querySelectorAll('input').forEach((input, index) => {
    const original = inputs[index]
    if (!original) return
    const sensitive = isSensitiveLoginInput(original)
    const value = sensitive ? '••••••••' : original.value
    if (sensitive) input.setAttribute('type', 'password')
    input.value = value
    input.setAttribute('value', value)
  })
  // B/C clones must be complete even if A was cancelled between two frames.
  clone.setAttribute('data-login-snapshot', 'true')
  clone.querySelectorAll<HTMLElement>('[data-login-entry]').forEach((item) => {
    for (const name of ['opacity', 'transform', 'clip-path', 'will-change']) item.style.removeProperty(name)
  })
  clone.removeAttribute('id')
  clone.querySelectorAll<HTMLElement>('[id]').forEach((item) => item.removeAttribute('id'))
  clone.querySelectorAll<HTMLElement>('[autofocus]').forEach((item) => item.removeAttribute('autofocus'))
  clone.querySelectorAll<HTMLElement>('button, a, input, [tabindex]').forEach((item) => item.setAttribute('tabindex', '-1'))
  clone.setAttribute('aria-hidden', 'true')
  clone.setAttribute('inert', '')
  return clone.outerHTML
}
