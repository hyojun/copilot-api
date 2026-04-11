import type { Context } from "hono"

import consola from "consola"
import { streamSSE } from "hono/streaming"

import { awaitApproval } from "~/lib/approval"
import { checkRateLimit } from "~/lib/rate-limit"
import { state } from "~/lib/state"
import {
  createChatCompletions,
  type ChatCompletionChunk,
  type ChatCompletionResponse,
} from "~/services/copilot/create-chat-completions"
import {
  createOllamaChatCompletions,
  isOllamaModel,
} from "~/services/ollama/create-chat-completions"

import {
  type AnthropicMessagesPayload,
  type AnthropicStreamState,
} from "./anthropic-types"
import {
  translateToAnthropic,
  translateToOpenAI,
} from "./non-stream-translation"
import { translateChunkToAnthropicEvents } from "./stream-translation"

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages"

function isClaudeModel(model: string): boolean {
  return model.startsWith("claude-")
}

async function handleClaudePassthrough(c: Context, body: string) {
  const headers: Record<string, string> = {
    "content-type": "application/json",
  }

  // Pass through all anthropic-* headers and authorization
  for (const [key, value] of Object.entries(c.req.header())) {
    const lower = key.toLowerCase()
    if (
      lower.startsWith("anthropic-")
      || lower === "authorization"
      || lower === "x-api-key"
    ) {
      headers[lower] = value
    }
  }

  consola.info("Proxying Claude model request to api.anthropic.com")

  const response = await fetch(ANTHROPIC_API_URL, {
    method: "POST",
    headers,
    body,
  })

  // Stream the response back as-is
  return new Response(response.body, {
    status: response.status,
    headers: {
      "content-type":
        response.headers.get("content-type") || "application/json",
      ...(response.headers.get("x-request-id") ?
        { "x-request-id": response.headers.get("x-request-id") ?? "" }
      : {}),
    },
  })
}

export async function handleCompletion(c: Context) {
  // Read body once as text so we can inspect model and potentially forward as-is
  const rawBody = await c.req.text()
  const anthropicPayload = JSON.parse(rawBody) as AnthropicMessagesPayload
  consola.debug("Anthropic request payload:", JSON.stringify(anthropicPayload))

  // Claude models: passthrough directly to Anthropic API
  if (isClaudeModel(anthropicPayload.model)) {
    return handleClaudePassthrough(c, rawBody)
  }

  await checkRateLimit(state)

  const openAIPayload = translateToOpenAI(anthropicPayload)
  consola.debug(
    "Translated OpenAI request payload:",
    JSON.stringify(openAIPayload),
  )

  if (state.manualApprove) {
    await awaitApproval()
  }

  const response =
    isOllamaModel(anthropicPayload.model) ?
      await createOllamaChatCompletions(openAIPayload)
    : await createChatCompletions(openAIPayload)

  if (isNonStreaming(response)) {
    consola.debug(
      "Non-streaming response from Copilot:",
      JSON.stringify(response).slice(-400),
    )
    const anthropicResponse = translateToAnthropic(response)
    consola.debug(
      "Translated Anthropic response:",
      JSON.stringify(anthropicResponse),
    )
    return c.json(anthropicResponse)
  }

  consola.debug("Streaming response from Copilot")
  return streamSSE(c, async (stream) => {
    const streamState: AnthropicStreamState = {
      messageStartSent: false,
      contentBlockIndex: 0,
      contentBlockOpen: false,
      toolCalls: {},
    }

    for await (const rawEvent of response) {
      consola.debug("Copilot raw stream event:", JSON.stringify(rawEvent))
      if (rawEvent.data === "[DONE]") {
        break
      }

      if (!rawEvent.data) {
        continue
      }

      const chunk = JSON.parse(rawEvent.data) as ChatCompletionChunk
      const events = translateChunkToAnthropicEvents(chunk, streamState)

      for (const event of events) {
        consola.debug("Translated Anthropic event:", JSON.stringify(event))
        await stream.writeSSE({
          event: event.type,
          data: JSON.stringify(event),
        })
      }
    }
  })
}

const isNonStreaming = (
  response: Awaited<ReturnType<typeof createChatCompletions>>,
): response is ChatCompletionResponse => Object.hasOwn(response, "choices")
