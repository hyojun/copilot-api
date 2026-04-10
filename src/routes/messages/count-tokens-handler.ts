import type { Context } from "hono"

import consola from "consola"

import { state } from "~/lib/state"
import { getTokenCount } from "~/lib/tokenizer"

import { type AnthropicMessagesPayload } from "./anthropic-types"
import { translateToOpenAI } from "./non-stream-translation"

const ANTHROPIC_COUNT_TOKENS_URL =
  "https://api.anthropic.com/v1/messages/count_tokens"

/**
 * Handles token counting for Anthropic messages
 */
export async function handleCountTokens(c: Context) {
  try {
    const anthropicBeta = c.req.header("anthropic-beta")

    const rawBody = await c.req.text()
    const anthropicPayload = JSON.parse(rawBody) as AnthropicMessagesPayload

    // Claude models: passthrough to Anthropic API
    if (anthropicPayload.model.startsWith("claude-")) {
      const headers: Record<string, string> = {
        "content-type": "application/json",
      }
      for (const [key, value] of Object.entries(c.req.header())) {
        const lower = key.toLowerCase()
        if (
          lower.startsWith("anthropic-") ||
          lower === "authorization" ||
          lower === "x-api-key"
        ) {
          headers[lower] = value
        }
      }
      const response = await fetch(ANTHROPIC_COUNT_TOKENS_URL, {
        method: "POST",
        headers,
        body: rawBody,
      })
      return new Response(response.body, {
        status: response.status,
        headers: {
          "content-type":
            response.headers.get("content-type") || "application/json",
        },
      })
    }

    const openAIPayload = translateToOpenAI(anthropicPayload)

    const selectedModel = state.models?.data.find(
      (model) => model.id === anthropicPayload.model,
    )

    if (!selectedModel) {
      consola.warn("Model not found, returning default token count")
      return c.json({
        input_tokens: 1,
      })
    }

    const tokenCount = await getTokenCount(openAIPayload, selectedModel)

    if (anthropicPayload.tools && anthropicPayload.tools.length > 0) {
      let mcpToolExist = false
      if (anthropicBeta?.startsWith("claude-code")) {
        mcpToolExist = anthropicPayload.tools.some((tool) =>
          tool.name.startsWith("mcp__"),
        )
      }
      if (!mcpToolExist) {
        if (anthropicPayload.model.startsWith("claude")) {
          // https://docs.anthropic.com/en/docs/agents-and-tools/tool-use/overview#pricing
          tokenCount.input = tokenCount.input + 346
        } else if (anthropicPayload.model.startsWith("grok")) {
          tokenCount.input = tokenCount.input + 480
        }
      }
    }

    let finalTokenCount = tokenCount.input + tokenCount.output
    if (anthropicPayload.model.startsWith("claude")) {
      finalTokenCount = Math.round(finalTokenCount * 1.15)
    } else if (anthropicPayload.model.startsWith("grok")) {
      finalTokenCount = Math.round(finalTokenCount * 1.03)
    }

    consola.info("Token count:", finalTokenCount)

    return c.json({
      input_tokens: finalTokenCount,
    })
  } catch (error) {
    consola.error("Error counting tokens:", error)
    return c.json({
      input_tokens: 1,
    })
  }
}
