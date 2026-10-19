import { DurableObject } from 'cloudflare:workers'

export class DocRoom extends DurableObject<Env> {
  async fetch() {
    return new Response('not implemented', { status: 501 })
  }
}
