import { readFile } from 'node:fs/promises'
import assert from 'node:assert/strict'
import test from 'node:test'
import ts from 'typescript'

const source = await readFile(new URL('../src/motion/loginSnapshot.ts', import.meta.url), 'utf8')
const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 } })
const { cloneSafe } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`)

// Small DOM fixture: tree queries/HTML serialization are independent of the
// production sanitizer. No browser, real credentials or API writes are needed.
class Element {
  constructor(tag, attributes = {}, children = [], value = '') {
    this.tag = tag
    this.attributes = new Map(Object.entries(attributes))
    this.children = children
    children.forEach(child => { child.parent = this })
    this.value = value
    const styles = new Map()
    this.style = { values: styles, setProperty: (name, value) => styles.set(name, value), removeProperty: name => styles.delete(name) }
  }
  get type() { return this.getAttribute('type') ?? 'text' }
  getAttribute(name) { return this.attributes.get(name) ?? null }
  setAttribute(name, value) { this.attributes.set(name, String(value)) }
  removeAttribute(name) { this.attributes.delete(name) }
  matches(selector) {
    return selector.startsWith('[') ? this.attributes.has(selector.slice(1, -1)) : this.tag === selector
  }
  closest(selector) { return this.matches(selector) ? this : this.parent?.closest(selector) ?? null }
  querySelectorAll(selector) {
    const selectors = selector.split(',').map(part => part.trim())
    const descendants = this.children.flatMap(child => [child, ...child.querySelectorAll('*')])
    return selector === '*' ? descendants : descendants.filter(child => selectors.some(part => child.matches(part)))
  }
  cloneNode() {
    const clone = new Element(this.tag, Object.fromEntries(this.attributes), this.children.map(child => child.cloneNode()), this.value)
    this.style.values.forEach((value, name) => clone.style.setProperty(name, value))
    return clone
  }
  get outerHTML() {
    const attributes = new Map(this.attributes)
    if (this.style.values.size) attributes.set('style', [...this.style.values].map(([name, value]) => `${name}:${value}`).join(';'))
    const escaped = value => String(value).replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;')
    return `<${this.tag}${[...attributes].map(([name, value]) => ` ${name}="${escaped(value)}"`).join('')}>${this.children.map(child => child.outerHTML).join('')}</${this.tag}>`
  }
}

test('visible and hidden login/register passwords never enter snapshot HTML', () => {
  for (const type of ['password', 'text']) {
    for (const autocomplete of ['current-password', 'new-password', 'section-login current-password']) {
      const marker = 'AUDIT_FAKE_MARKER_20261022'
      const input = new Element('input', { type, autocomplete, value: marker }, [], marker)
      const root = new Element('div', {}, [input])
      const html = cloneSafe(root)
      assert.equal(html.includes(marker), false, `${type}/${autocomplete}`)
      assert.match(html, /type="password"/)
      assert.match(html, /value="••••••••"/)
      assert.equal(input.value, marker, 'live user input is not changed by capture')
      assert.equal(input.type, type)
    }
  }
})

test('a semantic sensitive wrapper masks text inputs even without autocomplete', () => {
  const input = new Element('input', { type: 'text' }, [], 'AUDIT_FAKE_MARKER')
  const root = new Element('div', {}, [new Element('div', { 'data-login-sensitive': '' }, [input])])
  const html = cloneSafe(root)
  assert.equal(html.includes('AUDIT_FAKE_MARKER'), false)
  assert.match(html, /type="password"/)
})

test('B snapshot preserves ordinary input and becomes inert without duplicate IDs or autofocus', () => {
  const root = new Element('div', { id: 'panel' }, [
    new Element('input', { id: 'username', autocomplete: 'username', autofocus: '', tabindex: '0' }, [], '测试用户<&'),
    new Element('button', { id: 'submit' }), new Element('a', { href: '/research' }),
  ])
  const html = cloneSafe(root)
  assert.match(html, /value="测试用户&lt;&amp;"/)
  assert.equal(/\sid=/.test(html), false)
  assert.equal(html.includes('autofocus'), false)
  assert.equal((html.match(/tabindex="-1"/g) ?? []).length, 3)
  assert.match(html, /aria-hidden="true"/)
  assert.match(html, /inert=""/)
  assert.equal(root.getAttribute('id'), 'panel')
})

test('C/early capture produces a complete static clone while preserving unrelated layout styles', () => {
  const heading = new Element('span', { 'data-login-entry': 'heading' })
  for (const [name, value] of [['opacity', '0'], ['transform', 'translateY(14px)'], ['clip-path', 'inset(0 0 100% 0)'], ['will-change', 'transform'], ['color', 'red']]) heading.style.setProperty(name, value)
  const root = new Element('div', {}, [heading])
  const html = cloneSafe(root)
  assert.match(html, /data-login-snapshot="true"/)
  for (const property of ['opacity:', 'transform:', 'clip-path:', 'will-change:']) assert.equal(html.includes(property), false)
  assert.match(html, /color:red/)
  assert.equal(heading.style.values.get('opacity'), '0', 'capture does not mutate live A nodes')
})
