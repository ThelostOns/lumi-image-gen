# lumi-image-gen

A Lumiverse Spindle extension that automatically generates images from `<pic prompt="...">` tags in AI replies.
Port of [st-image-auto-generation](https://github.com/wickedcode01/st-image-auto-generation) — rebuilt as a proper Lumiverse extension with a full UI settings panel.

Supports **ComfyUI** (with custom workflow upload) and **AUTOMATIC1111 / Forge / SD-WebUI**.

---

## How it works

1. The extension injects an image generation instruction into every generation via the Spindle interceptor, so the LLM knows to output `<pic prompt="...">` tags when describing visual scenes.
2. When generation ends, the backend scans the new message for `<pic>` tags, extracts the SD prompt, calls your local SD backend, uploads the result to Lumiverse, and replaces/appends the image in the chat.

Everything is configured through the **Image Auto Gen** panel in Lumiverse's extension settings — no config files, no scripts, no hardcoded values.

---

## Installation

In Lumiverse, go to **Settings → Extensions → Install from URL**:

```
https://github.com/ThelostOns/lumi-image-gen
```

Lumiverse will clone and build the extension. Grant the requested permissions:

| Permission | Used for |
|-----------|---------|
| `chat_mutation` | Editing messages to embed generated images |
| `interceptor` | Injecting the `<image_generation>` instruction before each generation |
| `cors_proxy` | HTTP calls to your local ComfyUI / A1111 backend |
| `ui_panels` | The settings panel |

---

## Building from source

```bash
# Install Bun if needed: https://bun.sh
bun install
bun run build
```

---

## Setup

1. Install and enable the extension.
2. Open the **Image Auto Gen** settings panel.
3. Set your **Backend URL**:
   - ComfyUI local: `http://127.0.0.1:8188`
   - ComfyUI via Zrok (Colab): `https://xxxx.share.zrok.io`
   - A1111 local: `http://127.0.0.1:7860`
4. Click **Test connection** to verify.
5. **ComfyUI only**: upload your workflow JSON.
   - In ComfyUI: **Menu → Save (API Format)** → saves `workflow_api.json`
   - In the extension panel: drag-and-drop or click to browse for that file
   - In your workflow, set the positive CLIPTextEncode `text` node to `{{PROMPT}}` and the negative to `{{NEGATIVE}}` — the extension will substitute these at runtime
6. Set **checkpoint** (only used if no custom workflow is loaded).
7. Toggle **Image Auto Generation** on.
8. Start chatting. ✓

---

## Custom ComfyUI workflow

The extension supports any ComfyUI workflow in API format. To prepare your workflow:

1. Build your workflow in ComfyUI as normal (add LoRA, upscaler, ADetailer, whatever you want).
2. In the positive CLIPTextEncode node that should receive the scene prompt, set the text to:
   ```
   {{PROMPT}}
   ```
3. In the negative CLIPTextEncode node, set the text to:
   ```
   {{NEGATIVE}}
   ```
4. Export: **Menu → Save (API Format)**.
5. Upload the exported JSON in the extension panel.

The KSampler seed will be auto-randomised per image unless you set a fixed seed in the extension settings.

---

## Settings reference

| Setting | Description |
|---------|-------------|
| **Enabled** | Master on/off toggle |
| **Backend type** | ComfyUI or A1111/Forge/SD-WebUI |
| **Backend URL** | URL of your SD backend |
| **Checkpoint** | ComfyUI checkpoint filename (built-in workflow only) |
| **Custom workflow** | Upload your ComfyUI API-format JSON |
| **Width / Height** | Output resolution |
| **Steps** | Sampling steps |
| **CFG scale** | Classifier-free guidance scale |
| **Sampler** | Sampling algorithm |
| **Scheduler** | Noise scheduler (ComfyUI only) |
| **Seed** | Fixed seed, or −1 for random per image |
| **Negative prompt** | Negative tags (used in built-in workflow and injected into `{{NEGATIVE}}`) |
| **Image insertion** | `inline` / `append` / `new_message` |
| **Max images per reply** | Cap on images generated per AI message |
| **Auto-inject instruction** | Automatically prepend the generation instruction via interceptor |
| **Injection prompt** | The instruction sent to the LLM — fully editable |
| **Tag regex** | Pattern used to find `<pic>` tags (capture group 1 = prompt) |
| **Poll interval / Max polls** | ComfyUI job polling settings |

---

## Project structure

```
lumi-image-gen/
  spindle.json          Extension manifest
  package.json
  tsconfig.json
  src/
    backend.ts          Bun worker — settings, interceptor, GENERATION_ENDED handler, image gen
    frontend.tsx        React settings panel
  dist/
    backend.js          Built backend (bun build --target bun)
    frontend.js         Built frontend (bun build --target browser)
```
