/** Input identity is separate from request order and file-preview identity. */
export type VisionRequest = { input: number; request: number }
export class VisionSession {
  private alive = true
  private input = 0
  private file = 0
  private request = 0
  get revision() { return this.input }
  get fileRevision() { return this.file }
  activate() { this.alive = true }
  replaceFile() {
    this.file++
    this.replaceModel()
    return this.file
  }
  replaceModel() { this.input++; this.request++ }
  begin(): VisionRequest { return { input: this.input, request: ++this.request } }
  accepts(token: VisionRequest) {
    return this.alive && token.input === this.input && token.request === this.request
  }
  acceptsFile(revision: number) { return this.alive && revision === this.file }
  dispose() {
    this.alive = false
    this.file++
    this.replaceModel()
  }
}
