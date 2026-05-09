// ─── lumi-image-gen: backend ────────────────────────────────────────────────
// Runs as a Bun worker inside Lumiverse via the Spindle extension runtime.
// Permissions required: chat_mutation, interceptor, cors_proxy, ui_panels
// ─────────────────────────────────────────────────────────────────────────────

declare const spindle: import('lumiverse-spindle-types').SpindleAPI

// ─── Types ───────────────────────────────────────────────────────────────────

export interface Settings {
  enabled: boolean
  backend: 'comfyui' | 'a1111'
  endpoint: string          // Base URL of the SD backend (e.g. http://127.0.0.1:8188)
  picRegex: string          // Regex to match <pic> tags; group 1 = prompt
  displayMode: 'inline' | 'append' | 'new_message'
  maxImages: number
  // Generation params
  width: number
  height: number
  steps: number
  cfgScale: number
  sampler: string
  scheduler: string
  negativePrompt: string
  seed: number              // -1 = random per image
  // ComfyUI specific
  comfyCheckpoint: string   // checkpoint filename as ComfyUI sees it
  comfyWorkflow: string | null  // custom workflow JSON string (null = use built-in)
  comfyPollIntervalMs: number
  comfyMaxPolls: number
  // Prompt injection
  injectSystemPrompt: boolean
  injectionPromptText: string
}

const DEFAULT_SETTINGS: Settings = {
  enabled: false,
  backend: 'comfyui',
  endpoint: 'http://127.0.0.1:8188',
  picRegex: '<pic[^>]*\\sprompt="([^"]*)"[^>]*?>',
  displayMode: 'inline',
  maxImages: 3,
  width: 832,
  height: 1216,
  steps: 25,
  cfgScale: 7.0,
  sampler: 'euler_ancestral',
  scheduler: 'normal',
  negativePrompt: 'lowres, bad anatomy, bad hands, text, error, missing fingers, extra digit, fewer digits, cropped, worst quality, low quality, jpeg artifacts, signature, watermark, username, blurry, ugly, deformed, mutation, extra limbs',
  seed: -1,
  comfyCheckpoint: 'illustriousXL_v10.safetensors',
  comfyWorkflow: null,
  comfyPollIntervalMs: 1500,
  comfyMaxPolls: 60,
  injectSystemPrompt: true,
  injectionPromptText: `<image_generation>When the scene involves a visible action, character appearance, or environment, embed a <pic prompt="..."> tag in your reply. The prompt must be comma-separated Stable Diffusion / danbooru-style tags describing the scene in detail. Example: <pic prompt="score_9, score_8_up, source_anime, 1girl, silver hair, fox ears, white kimono, cherry blossoms, night, moonlight, detailed background">. Include at most {{maxImages}} per reply. Do not narrate or explain the tag.</image_generation>`,
}

// ─── Settings persistence ────────────────────────────────────────────────────

let settings: Settings = { ...DEFAULT_SETTINGS }

async function loadSettings(): Promise<void> {
  try {
    const raw = await spindle.storage.read('settings.json')
    settings = { ...DEFAULT_SETTINGS, ...JSON.parse(raw) }
    spindle.log.info('[imggen] Settings loaded.')
  } catch {
    // First run — use defaults
    spindle.log.info('[imggen] No saved settings, using defaults.')
  }
}

async function saveSettings(next: Partial<Settings>): Promise<void> {
  settings = { ...settings, ...next }
  await spindle.storage.write('settings.json', JSON.stringify(settings))
  spindle.log.info('[imggen] Settings saved.')
}

// ─── Prompt interceptor ───────────────────────────────────────────────────────
// Injects the image generation instruction into the system prompt before
// each generation so the LLM knows to output <pic> tags.

spindle.registerInterceptor(async (messages, _context) => {
  if (!settings.enabled || !settings.injectSystemPrompt) return messages

  const injection = settings.injectionPromptText.replace(
    '{{maxImages}}',
    String(settings.maxImages)
  )

  // Prepend as a system message (before any existing system messages)
  return [
    { role: 'system' as const, content: injection },
    ...messages,
  ]
}, 5) // low priority number = runs early in the interceptor chain

// ─── GENERATION_ENDED handler ─────────────────────────────────────────────────
// Fires after every AI response. Scans the new message for <pic> tags and
// generates images for each one found.

spindle.onEvent('GENERATION_ENDED', async (payload: {
  chatId: string
  messageId: string
  content: string
  role: string
}) => {
  if (!settings.enabled) return
  if (payload.role !== 'assistant' && payload.role !== 'char') return

  const content = payload.content
  const picTagRx = new RegExp(settings.picRegex, 'g')
  const allMatches = [...content.matchAll(picTagRx)]

  if (allMatches.length === 0) return

  const toProcess = allMatches.slice(0, settings.maxImages)
  spindle.log.info(`[imggen] Found ${toProcess.length} <pic> tag(s) in message ${payload.messageId}`)

  // Notify the frontend that generation has started
  spindle.sendToFrontend({
    type: 'imggen_status',
    status: 'generating',
    count: toProcess.length,
  })

  const results: Array<{ originalTag: string; imageUrl: string }> = []

  for (const match of toProcess) {
    const originalTag = match[0]
    const prompt = match[1]?.trim()
    if (!prompt) continue

    spindle.log.info(`[imggen] Generating for: "${prompt.substring(0, 80)}..."`)

    try {
      const base64 = settings.backend === 'a1111'
        ? await generateA1111(prompt)
        : await generateComfyUI(prompt)

      if (!base64) continue

      // Upload to Lumiverse image store to get a stable URL
      const imageUrl = await uploadImage(base64)
      results.push({ originalTag, imageUrl })
      spindle.log.info(`[imggen] Image ready → ${imageUrl}`)
    } catch (err) {
      spindle.log.error(`[imggen] Generation failed: ${err}`)
    }
  }

  if (results.length === 0) {
    spindle.sendToFrontend({ type: 'imggen_status', status: 'idle' })
    return
  }

  // Apply images to the chat message
  await applyImages(payload.chatId, payload.messageId, content, results)

  spindle.sendToFrontend({
    type: 'imggen_status',
    status: 'done',
    count: results.length,
  })
})

// ─── Image application ────────────────────────────────────────────────────────

async function applyImages(
  chatId: string,
  messageId: string,
  originalContent: string,
  results: Array<{ originalTag: string; imageUrl: string }>
) {
  const picTagRx = new RegExp(settings.picRegex, 'g')

  if (settings.displayMode === 'inline') {
    let newContent = originalContent
    for (const r of results) {
      newContent = newContent.replace(r.originalTag, `\n\n![](${r.imageUrl})\n`)
    }
    await spindle.chat.editMessage(chatId, messageId, newContent)

  } else if (settings.displayMode === 'append') {
    let newContent = originalContent.replace(picTagRx, '').trim()
    const imgs = results.map(r => `![](${r.imageUrl})`).join('\n\n')
    await spindle.chat.editMessage(chatId, messageId, `${newContent}\n\n${imgs}`)

  } else if (settings.displayMode === 'new_message') {
    for (const r of results) {
      await spindle.chat.sendMessage(chatId, `![](${r.imageUrl})`, 'system')
    }
  }
}

// ─── Image upload to Lumiverse ────────────────────────────────────────────────

async function uploadImage(base64Png: string): Promise<string> {
  const result = await spindle.images.upload({
    data: base64Png,
    mimeType: 'image/png',
  })
  return result.url
}

// ─── AUTOMATIC1111 / Forge / SD-WebUI ────────────────────────────────────────

async function generateA1111(prompt: string): Promise<string> {
  const seed = settings.seed < 0 ? Math.floor(Math.random() * 4294967295) : settings.seed

  const res = await fetch(`${settings.endpoint}/sdapi/v1/txt2img`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      prompt,
      negative_prompt: settings.negativePrompt,
      steps: settings.steps,
      cfg_scale: settings.cfgScale,
      width: settings.width,
      height: settings.height,
      sampler_name: settings.sampler,
      seed,
      batch_size: 1,
      send_images: true,
      save_images: false,
    }),
  })

  if (!res.ok) throw new Error(`A1111 HTTP ${res.status}`)
  const data = await res.json() as { images: string[] }
  if (!data.images?.[0]) throw new Error('A1111 returned no images')
  return data.images[0] // raw base64 PNG
}

// ─── ComfyUI ─────────────────────────────────────────────────────────────────

function buildDefaultComfyWorkflow(prompt: string, seed: number): object {
  return {
    "1": {
      class_type: "CheckpointLoaderSimple",
      inputs: { ckpt_name: settings.comfyCheckpoint },
    },
    "2": {
      class_type: "CLIPTextEncode",
      inputs: { clip: ["1", 1], text: prompt },
    },
    "3": {
      class_type: "CLIPTextEncode",
      inputs: { clip: ["1", 1], text: settings.negativePrompt },
    },
    "4": {
      class_type: "EmptyLatentImage",
      inputs: { width: settings.width, height: settings.height, batch_size: 1 },
    },
    "5": {
      class_type: "KSampler",
      inputs: {
        model: ["1", 0],
        positive: ["2", 0],
        negative: ["3", 0],
        latent_image: ["4", 0],
        seed,
        steps: settings.steps,
        cfg: settings.cfgScale,
        sampler_name: settings.sampler,
        scheduler: settings.scheduler,
        denoise: 1.0,
      },
    },
    "6": {
      class_type: "VAEDecode",
      inputs: { samples: ["5", 0], vae: ["1", 2] },
    },
    "7": {
      class_type: "SaveImage",
      inputs: { images: ["6", 0], filename_prefix: "lumi_imggen" },
    },
  }
}

function injectPromptIntoCustomWorkflow(workflow: object, prompt: string, seed: number): object {
  // Walk the workflow graph and replace placeholder values.
  // Looks for CLIPTextEncode nodes whose text contains {{PROMPT}} or is empty,
  // and KSampler nodes to inject seed.
  const wf = JSON.parse(JSON.stringify(workflow)) as Record<string, any>

  for (const nodeId of Object.keys(wf)) {
    const node = wf[nodeId]
    if (!node?.class_type || !node?.inputs) continue

    if (node.class_type === 'CLIPTextEncode') {
      if (node.inputs.text === '{{PROMPT}}' || node.inputs.text === '{{prompt}}') {
        node.inputs.text = prompt
      } else if (node.inputs.text === '{{NEGATIVE}}' || node.inputs.text === '{{negative}}') {
        node.inputs.text = settings.negativePrompt
      }
    }

    if (node.class_type === 'KSampler' || node.class_type === 'KSamplerAdvanced') {
      if (settings.seed < 0) {
        node.inputs.seed = seed
      }
    }
  }

  return wf
}

async function generateComfyUI(prompt: string): Promise<string> {
  const seed = settings.seed < 0 ? Math.floor(Math.random() * 4294967295) : settings.seed

  let workflow: object
  if (settings.comfyWorkflow) {
    try {
      const base = JSON.parse(settings.comfyWorkflow)
      workflow = injectPromptIntoCustomWorkflow(base, prompt, seed)
    } catch (e) {
      spindle.log.error(`[imggen] Failed to parse custom workflow JSON: ${e}`)
      workflow = buildDefaultComfyWorkflow(prompt, seed)
    }
  } else {
    workflow = buildDefaultComfyWorkflow(prompt, seed)
  }

  // Queue the prompt
  const queueRes = await fetch(`${settings.endpoint}/prompt`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: workflow }),
  })

  if (!queueRes.ok) throw new Error(`ComfyUI /prompt HTTP ${queueRes.status}`)
  const { prompt_id } = await queueRes.json() as { prompt_id: string }
  if (!prompt_id) throw new Error('ComfyUI returned no prompt_id')

  spindle.log.info(`[imggen] ComfyUI queued → prompt_id=${prompt_id}`)

  // Poll /history until the job is done
  for (let i = 0; i < settings.comfyMaxPolls; i++) {
    await new Promise(r => setTimeout(r, settings.comfyPollIntervalMs))

    const histRes = await fetch(`${settings.endpoint}/history/${prompt_id}`)
    if (!histRes.ok) continue

    const history = await histRes.json() as Record<string, any>
    const entry = history[prompt_id]
    if (!entry?.outputs) continue

    // Find any SaveImage node output
    for (const nodeOutput of Object.values(entry.outputs) as any[]) {
      if (!nodeOutput?.images?.length) continue
      const imgInfo = nodeOutput.images[0] as { filename: string; subfolder: string; type: string }

      // Download the image bytes
      const viewUrl = `${settings.endpoint}/view?filename=${encodeURIComponent(imgInfo.filename)}&subfolder=${encodeURIComponent(imgInfo.subfolder ?? '')}&type=${imgInfo.type ?? 'output'}`
      const imgRes = await fetch(viewUrl)
      if (!imgRes.ok) throw new Error(`ComfyUI /view HTTP ${imgRes.status}`)

      const buffer = await imgRes.arrayBuffer()
      const base64 = Buffer.from(buffer).toString('base64')
      return base64
    }
  }

  throw new Error(`ComfyUI timed out after ${settings.comfyMaxPolls} polls`)
}

// ─── Test connection helper ───────────────────────────────────────────────────

async function testConnection(): Promise<{ ok: boolean; message: string }> {
  try {
    if (settings.backend === 'a1111') {
      const res = await fetch(`${settings.endpoint}/sdapi/v1/sd-models`)
      if (!res.ok) return { ok: false, message: `HTTP ${res.status}` }
      const models = await res.json() as Array<{ model_name: string }>
      return { ok: true, message: `Connected — ${models.length} model(s) available` }
    } else {
      const res = await fetch(`${settings.endpoint}/system_stats`)
      if (!res.ok) return { ok: false, message: `HTTP ${res.status}` }
      const stats = await res.json() as { system?: { python_version?: string } }
      const pyv = stats.system?.python_version ?? 'unknown'
      return { ok: true, message: `Connected — Python ${pyv}` }
    }
  } catch (err) {
    return { ok: false, message: String(err) }
  }
}

// ─── Frontend message handler ─────────────────────────────────────────────────
// All UI interactions (saving settings, testing connection, etc.) arrive here.

spindle.onFrontendMessage(async (payload: any, userId: string) => {
  switch (payload.type) {

    case 'get_settings': {
      spindle.sendToFrontend({ type: 'settings', settings }, userId)
      break
    }

    case 'save_settings': {
      await saveSettings(payload.settings as Partial<Settings>)
      spindle.sendToFrontend({ type: 'settings', settings }, userId)
      spindle.log.info('[imggen] Settings updated from UI.')
      break
    }

    case 'test_connection': {
      spindle.sendToFrontend({ type: 'test_connection_pending' }, userId)
      const result = await testConnection()
      spindle.sendToFrontend({ type: 'test_connection_result', ...result }, userId)
      break
    }

    default:
      spindle.log.info(`[imggen] Unknown frontend message type: ${payload.type}`)
  }
})

// ─── Init ─────────────────────────────────────────────────────────────────────

await loadSettings()
spindle.log.info('[imggen] Image Auto Generation loaded.')
