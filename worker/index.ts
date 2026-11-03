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

    return new Response(null, { status: 404 })
  },
} satisfies ExportedHandler<ChatEnv>
