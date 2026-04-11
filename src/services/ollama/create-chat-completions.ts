import consola from "consola"
import { events } from "fetch-event-stream"

import type {
  ChatCompletionsPayload,
  ChatCompletionResponse,
} from "~/services/copilot/create-chat-completions"

import { HTTPError } from "~/lib/error"

const OLLAMA_BASE_URL = "http://localhost:11434/v1"

const OLLAMA_MODEL_MAP: Record<string, string> = {
  "glm-5.1": "glm-5.1:cloud",
}

function resolveOllamaModel(model: string): string {
  return OLLAMA_MODEL_MAP[model] ?? model
}

export function isOllamaModel(model: string): boolean {
  return model in OLLAMA_MODEL_MAP
}

export const createOllamaChatCompletions = async (
  payload: ChatCompletionsPayload,
) => {
  const ollamaPayload = {
    ...payload,
    model: resolveOllamaModel(payload.model),
  }

  consola.info(`Routing to Ollama: ${ollamaPayload.model}`)

  const response = await fetch(`${OLLAMA_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(ollamaPayload),
  })

  if (!response.ok) {
    consola.error("Failed to create Ollama chat completions", response)
    throw new HTTPError("Failed to create Ollama chat completions", response)
  }

  if (payload.stream) {
    return events(response)
  }

  return (await response.json()) as ChatCompletionResponse
}
