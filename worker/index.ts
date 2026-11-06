import { handleChat, type ChatEnv } from './chat.ts'

export default {
  async fetch(request, env) {
    const url = new URL(request.url)

    if (url.pathname === '/api/health') {
      return Response.json({ ok: true, chat: Boolean(env.ANTHROPIC_API_KEY) })
    }
    if (url.pathname === '/api/chat') {
      return handleChat(request, env)
    }
    if (url.pathname.startsWith('/models/')) {
      return gzipped(request, env)
    }

    return new Response(null, { status: 404 })
  },
} satisfies ExportedHandler<ChatEnv>

// The 3D models are binary glTF, which Cloudflare passes on as it is. Their meshopt data shrinks
// by about half again with gzip, so they go out gzipped to every browser that takes it. The tag
// is marked weak, as the bytes differ from the stored file's.
async function gzipped(request: Request, env: Env): Promise<Response> {
  const tag = request.headers.get('if-none-match')
  const asked = tag?.startsWith('W/') ? new Request(request, { headers: { ...Object.fromEntries(request.headers), 'if-none-match': tag.slice(2) } }) : request
  const asset = await env.ASSETS.fetch(asked)
  if (asset.status !== 200 || !asset.body || !/\bgzip\b/.test(request.headers.get('accept-encoding') ?? '')) return asset
  const headers = new Headers(asset.headers)
  headers.set('content-encoding', 'gzip')
  headers.delete('content-length')
  headers.append('vary', 'accept-encoding')
  const etag = headers.get('etag')
  if (etag && !etag.startsWith('W/')) headers.set('etag', `W/${etag}`)
  return new Response(asset.body.pipeThrough(new CompressionStream('gzip')), { status: 200, headers, encodeBody: 'manual' })
}
