import { Hono } from "hono"

import { forwardError } from "~/lib/error"
import { state } from "~/lib/state"
import { cacheModels } from "~/lib/utils"

export const modelRoutes = new Hono()

modelRoutes.get("/", async (c) => {
  try {
    if (!state.models) {
      // This should be handled by startup logic, but as a fallback.
      await cacheModels()
    }

    const ollamaModels = [
      {
        id: "glm-5.1",
        object: "model" as const,
        type: "model" as const,
        created: 0,
        created_at: new Date(0).toISOString(),
        owned_by: "ollama",
        display_name: "GLM 5.1 (Ollama)",
      },
      {
        id: "deepseek-v4-pro",
        object: "model" as const,
        type: "model" as const,
        created: 0,
        created_at: new Date(0).toISOString(),
        owned_by: "ollama",
        display_name: "DeepSeek V4 Pro (Ollama)",
      },
      {
        id: "deepseek-v4-flash",
        object: "model" as const,
        type: "model" as const,
        created: 0,
        created_at: new Date(0).toISOString(),
        owned_by: "ollama",
        display_name: "DeepSeek V4 Flash (Ollama)",
      },
    ]

    const models = [
      ...ollamaModels,
      ...(state.models?.data.map((model) => ({
        id: model.id,
        object: "model" as const,
        type: "model" as const,
        created: 0,
        created_at: new Date(0).toISOString(),
        owned_by: model.vendor,
        display_name: model.name,
      })) ?? []),
    ]

    return c.json({
      object: "list",
      data: models,
      has_more: false,
    })
  } catch (error) {
    return await forwardError(c, error)
  }
})
