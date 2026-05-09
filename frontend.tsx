// ─── lumi-image-gen: frontend ────────────────────────────────────────────────
// Settings panel rendered inside Lumiverse's extension sidebar.
// Built with React 19. Communicates with the backend via spindle messaging.
// ─────────────────────────────────────────────────────────────────────────────

import { useState, useEffect, useCallback, useRef } from 'react'
import { createRoot } from 'react-dom/client'
import type { Settings } from './backend'

// Lumiverse injects the frontend Spindle API as a global
declare const spindle: {
  send: (payload: any) => void
  onMessage: (handler: (payload: any) => void) => () => void
  registerPanel: (options: {
    id: string
    label: string
    icon?: string
    component: React.FC
  }) => void
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const css = `
.imggen-panel {
  font-family: inherit;
  color: var(--lumi-text, #e2e8f0);
  padding: 0 0 2rem 0;
  max-width: 680px;
}

.imggen-section {
  margin-bottom: 1.5rem;
}

.imggen-section-title {
  font-size: 0.7rem;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--lumi-text-muted, #94a3b8);
  margin: 0 0 0.75rem 0;
  padding-bottom: 0.4rem;
  border-bottom: 1px solid var(--lumi-border, #2d3748);
}

.imggen-row {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  margin-bottom: 0.75rem;
}

.imggen-row label {
  font-size: 0.85rem;
  min-width: 150px;
  color: var(--lumi-text-secondary, #cbd5e1);
  flex-shrink: 0;
}

.imggen-row input[type="text"],
.imggen-row input[type="number"],
.imggen-row input[type="url"],
.imggen-row select {
  flex: 1;
  background: var(--lumi-input-bg, #1e2533);
  border: 1px solid var(--lumi-border, #2d3748);
  border-radius: 6px;
  color: var(--lumi-text, #e2e8f0);
  padding: 0.4rem 0.6rem;
  font-size: 0.85rem;
  outline: none;
  min-width: 0;
}

.imggen-row input:focus,
.imggen-row select:focus {
  border-color: var(--lumi-accent, #6366f1);
}

.imggen-textarea {
  width: 100%;
  background: var(--lumi-input-bg, #1e2533);
  border: 1px solid var(--lumi-border, #2d3748);
  border-radius: 6px;
  color: var(--lumi-text, #e2e8f0);
  padding: 0.5rem 0.6rem;
  font-size: 0.8rem;
  font-family: 'JetBrains Mono', 'Fira Code', monospace;
  resize: vertical;
  outline: none;
  min-height: 80px;
  box-sizing: border-box;
}

.imggen-textarea:focus {
  border-color: var(--lumi-accent, #6366f1);
}

.imggen-toggle-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.6rem 0;
  border-bottom: 1px solid var(--lumi-border, #2d3748);
  margin-bottom: 1rem;
}

.imggen-toggle-label {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
}

.imggen-toggle-label strong {
  font-size: 0.95rem;
}

.imggen-toggle-label span {
  font-size: 0.78rem;
  color: var(--lumi-text-muted, #94a3b8);
}

/* Toggle switch */
.imggen-toggle {
  position: relative;
  display: inline-block;
  width: 42px;
  height: 24px;
  flex-shrink: 0;
}
.imggen-toggle input { opacity: 0; width: 0; height: 0; }
.imggen-toggle-slider {
  position: absolute;
  inset: 0;
  background: var(--lumi-border, #2d3748);
  border-radius: 24px;
  cursor: pointer;
  transition: background 0.2s;
}
.imggen-toggle-slider::before {
  content: '';
  position: absolute;
  height: 18px;
  width: 18px;
  left: 3px;
  bottom: 3px;
  background: white;
  border-radius: 50%;
  transition: transform 0.2s;
}
.imggen-toggle input:checked + .imggen-toggle-slider {
  background: var(--lumi-accent, #6366f1);
}
.imggen-toggle input:checked + .imggen-toggle-slider::before {
  transform: translateX(18px);
}

/* Buttons */
.imggen-btn {
  padding: 0.45rem 1rem;
  border-radius: 6px;
  border: none;
  font-size: 0.83rem;
  font-weight: 500;
  cursor: pointer;
  transition: opacity 0.15s;
}
.imggen-btn:hover { opacity: 0.85; }
.imggen-btn:disabled { opacity: 0.4; cursor: not-allowed; }

.imggen-btn-primary {
  background: var(--lumi-accent, #6366f1);
  color: white;
}
.imggen-btn-ghost {
  background: var(--lumi-input-bg, #1e2533);
  border: 1px solid var(--lumi-border, #2d3748);
  color: var(--lumi-text-secondary, #cbd5e1);
}
.imggen-btn-row {
  display: flex;
  gap: 0.5rem;
  margin-top: 1.25rem;
  justify-content: flex-end;
}

/* Workflow upload area */
.imggen-upload-area {
  border: 2px dashed var(--lumi-border, #2d3748);
  border-radius: 8px;
  padding: 1rem;
  text-align: center;
  cursor: pointer;
  transition: border-color 0.15s;
  font-size: 0.83rem;
  color: var(--lumi-text-muted, #94a3b8);
}
.imggen-upload-area:hover,
.imggen-upload-area.dragover {
  border-color: var(--lumi-accent, #6366f1);
  color: var(--lumi-text, #e2e8f0);
}

/* Status badge */
.imggen-status {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  font-size: 0.78rem;
  padding: 0.25rem 0.6rem;
  border-radius: 4px;
  font-weight: 500;
}
.imggen-status.ok { background: #14532d; color: #4ade80; }
.imggen-status.error { background: #450a0a; color: #f87171; }
.imggen-status.pending { background: #1e3a5f; color: #60a5fa; }

/* Connection test row */
.imggen-test-row {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  margin-top: 0.5rem;
}

/* 2-column grid for numbers */
.imggen-grid-2 {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.5rem 1rem;
}
.imggen-grid-2 .imggen-row {
  margin-bottom: 0;
  flex-direction: column;
  align-items: flex-start;
  gap: 0.3rem;
}
.imggen-grid-2 .imggen-row label {
  min-width: unset;
  font-size: 0.78rem;
}
.imggen-grid-2 .imggen-row input,
.imggen-grid-2 .imggen-row select {
  width: 100%;
}

.imggen-hint {
  font-size: 0.75rem;
  color: var(--lumi-text-muted, #94a3b8);
  margin-top: 0.35rem;
  line-height: 1.4;
}

.imggen-workflow-actions {
  display: flex;
  gap: 0.5rem;
  margin-top: 0.5rem;
}

.imggen-workflow-loaded {
  font-size: 0.78rem;
  color: #4ade80;
  margin-top: 0.35rem;
}

.imggen-gen-status {
  position: fixed;
  bottom: 1.5rem;
  right: 1.5rem;
  background: var(--lumi-input-bg, #1e2533);
  border: 1px solid var(--lumi-border, #2d3748);
  border-radius: 8px;
  padding: 0.6rem 1rem;
  font-size: 0.83rem;
  display: flex;
  align-items: center;
  gap: 0.5rem;
  box-shadow: 0 4px 20px rgba(0,0,0,0.4);
  z-index: 1000;
  animation: slideIn 0.2s ease;
}
@keyframes slideIn {
  from { transform: translateY(10px); opacity: 0; }
  to { transform: translateY(0); opacity: 1; }
}
.imggen-spinner {
  width: 14px;
  height: 14px;
  border: 2px solid var(--lumi-border, #2d3748);
  border-top-color: var(--lumi-accent, #6366f1);
  border-radius: 50%;
  animation: spin 0.7s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }
`

// ─── Panel component ──────────────────────────────────────────────────────────

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
  negativePrompt: 'lowres, bad anatomy, bad hands, text, error, missing fingers, extra digit, fewer digits, cropped, worst quality, low quality, jpeg artifacts, signature, watermark, username, blurry, ugly, deformed',
  seed: -1,
  comfyCheckpoint: 'illustriousXL_v10.safetensors',
  comfyWorkflow: null,
  comfyPollIntervalMs: 1500,
  comfyMaxPolls: 60,
  injectSystemPrompt: true,
  injectionPromptText: `<image_generation>When the scene involves a visible action, character appearance, or environment, embed a <pic prompt="..."> tag in your reply. The prompt must be comma-separated Stable Diffusion / danbooru-style tags describing the scene in detail. Example: <pic prompt="score_9, score_8_up, source_anime, 1girl, silver hair, fox ears, white kimono, cherry blossoms, night, moonlight, detailed background">. Include at most {{maxImages}} per reply. Do not narrate or explain the tag.</image_generation>`,
}

type ConnectionStatus =
  | { state: 'idle' }
  | { state: 'pending' }
  | { state: 'ok'; message: string }
  | { state: 'error'; message: string }

type GenerationStatus = 'idle' | 'generating' | 'done'

function ImageAutoGenPanel() {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS)
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [conn, setConn] = useState<ConnectionStatus>({ state: 'idle' })
  const [genStatus, setGenStatus] = useState<GenerationStatus>('idle')
  const [genCount, setGenCount] = useState(0)
  const workflowInputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)

  // ── Message bus ────────────────────────────────────────────────────────────

  useEffect(() => {
    spindle.send({ type: 'get_settings' })

    const unsub = spindle.onMessage((msg: any) => {
      switch (msg.type) {
        case 'settings':
          setSettings(msg.settings)
          setDirty(false)
          setSaving(false)
          break
        case 'test_connection_pending':
          setConn({ state: 'pending' })
          break
        case 'test_connection_result':
          setConn(msg.ok
            ? { state: 'ok', message: msg.message }
            : { state: 'error', message: msg.message }
          )
          break
        case 'imggen_status':
          if (msg.status === 'generating') {
            setGenStatus('generating')
            setGenCount(msg.count)
          } else if (msg.status === 'done') {
            setGenStatus('done')
            setTimeout(() => setGenStatus('idle'), 3000)
          } else {
            setGenStatus('idle')
          }
          break
      }
    })

    return unsub
  }, [])

  // ── Helpers ────────────────────────────────────────────────────────────────

  const update = useCallback(<K extends keyof Settings>(key: K, value: Settings[K]) => {
    setSettings(prev => ({ ...prev, [key]: value }))
    setDirty(true)
  }, [])

  const save = useCallback(() => {
    setSaving(true)
    spindle.send({ type: 'save_settings', settings })
  }, [settings])

  const testConnection = useCallback(() => {
    spindle.send({ type: 'test_connection' })
  }, [])

  const resetToDefaults = useCallback(() => {
    if (!confirm('Reset all settings to defaults?')) return
    setSettings(DEFAULT_SETTINGS)
    setDirty(true)
  }, [])

  // ── Workflow JSON handling ─────────────────────────────────────────────────

  const loadWorkflowFile = useCallback((file: File) => {
    const reader = new FileReader()
    reader.onload = (e) => {
      const text = e.target?.result as string
      try {
        JSON.parse(text) // validate
        update('comfyWorkflow', text)
      } catch {
        alert('Invalid JSON file — please export your workflow using ComfyUI\'s "Save (API Format)" option.')
      }
    }
    reader.readAsText(file)
  }, [update])

  const onWorkflowDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragging(false)
    const file = e.dataTransfer.files[0]
    if (file) loadWorkflowFile(file)
  }, [loadWorkflowFile])

  const clearWorkflow = useCallback(() => {
    update('comfyWorkflow', null)
  }, [update])

  // ─────────────────────────────────────────────────────────────────────────

  const isComfy = settings.backend === 'comfyui'

  return (
    <div className="imggen-panel">
      {/* Master toggle */}
      <div className="imggen-toggle-row">
        <div className="imggen-toggle-label">
          <strong>Image Auto Generation</strong>
          <span>Automatically generate images from &lt;pic prompt="..."&gt; tags in AI replies</span>
        </div>
        <label className="imggen-toggle">
          <input
            type="checkbox"
            checked={settings.enabled}
            onChange={e => update('enabled', e.target.checked)}
          />
          <span className="imggen-toggle-slider" />
        </label>
      </div>

      {/* ── Backend ── */}
      <div className="imggen-section">
        <p className="imggen-section-title">Backend</p>

        <div className="imggen-row">
          <label>Backend type</label>
          <select
            value={settings.backend}
            onChange={e => update('backend', e.target.value as 'comfyui' | 'a1111')}
          >
            <option value="comfyui">ComfyUI</option>
            <option value="a1111">AUTOMATIC1111 / Forge / SD-WebUI</option>
          </select>
        </div>

        <div className="imggen-row">
          <label>Backend URL</label>
          <input
            type="url"
            value={settings.endpoint}
            onChange={e => update('endpoint', e.target.value)}
            placeholder={isComfy ? 'http://127.0.0.1:8188' : 'http://127.0.0.1:7860'}
            spellCheck={false}
          />
        </div>

        <p className="imggen-hint" style={{ marginLeft: 158, marginTop: -0.25 + 'rem' }}>
          {isComfy
            ? 'Use your Zrok URL when running ComfyUI on Colab (e.g. https://xxxx.share.zrok.io)'
            : 'Standard AUTOMATIC1111 WebUI URL'}
        </p>

        <div className="imggen-test-row">
          <button className="imggen-btn imggen-btn-ghost" onClick={testConnection} disabled={conn.state === 'pending'}>
            Test connection
          </button>
          {conn.state === 'pending' && (
            <span className="imggen-status pending">⏳ Testing…</span>
          )}
          {conn.state === 'ok' && (
            <span className="imggen-status ok">✓ {conn.message}</span>
          )}
          {conn.state === 'error' && (
            <span className="imggen-status error">✗ {conn.message}</span>
          )}
        </div>
      </div>

      {/* ── ComfyUI Workflow ── */}
      {isComfy && (
        <div className="imggen-section">
          <p className="imggen-section-title">ComfyUI Workflow</p>

          <div className="imggen-row">
            <label>Checkpoint</label>
            <input
              type="text"
              value={settings.comfyCheckpoint}
              onChange={e => update('comfyCheckpoint', e.target.value)}
              placeholder="illustriousXL_v10.safetensors"
              spellCheck={false}
            />
          </div>
          <p className="imggen-hint" style={{ marginLeft: 158, marginTop: -0.25 + 'rem' }}>
            Only used when no custom workflow is loaded. Must match exactly what ComfyUI's model list shows.
          </p>

          <div style={{ marginTop: '0.75rem' }}>
            {settings.comfyWorkflow ? (
              <>
                <p className="imggen-workflow-loaded">
                  ✓ Custom workflow loaded ({Math.round(settings.comfyWorkflow.length / 1024)} KB)
                </p>
                <p className="imggen-hint" style={{ marginTop: '0.25rem' }}>
                  In your workflow, set the positive CLIPTextEncode text to <code>{'{{PROMPT}}'}</code> and
                  negative to <code>{'{{NEGATIVE}}'}</code> so the extension can inject prompts.
                  The KSampler seed will be auto-randomised unless you set a fixed seed below.
                </p>
                <div className="imggen-workflow-actions">
                  <button className="imggen-btn imggen-btn-ghost" onClick={clearWorkflow}>
                    Remove workflow (use built-in)
                  </button>
                  <button className="imggen-btn imggen-btn-ghost" onClick={() => workflowInputRef.current?.click()}>
                    Replace
                  </button>
                </div>
              </>
            ) : (
              <>
                <div
                  className={`imggen-upload-area ${dragging ? 'dragover' : ''}`}
                  onDragOver={e => { e.preventDefault(); setDragging(true) }}
                  onDragLeave={() => setDragging(false)}
                  onDrop={onWorkflowDrop}
                  onClick={() => workflowInputRef.current?.click()}
                >
                  Drop your ComfyUI API-format workflow JSON here, or click to browse
                  <br />
                  <span style={{ fontSize: '0.72rem', marginTop: '0.3rem', display: 'block' }}>
                    Export from ComfyUI: Menu → Save (API Format) → workflow_api.json
                  </span>
                </div>
                <p className="imggen-hint" style={{ marginTop: '0.4rem' }}>
                  No workflow loaded — using built-in default (checkpoint + KSampler + VAEDecode).
                  For full control (LoRA, upscaler, etc.) load your own workflow.
                </p>
              </>
            )}
            <input
              ref={workflowInputRef}
              type="file"
              accept=".json,application/json"
              style={{ display: 'none' }}
              onChange={e => { if (e.target.files?.[0]) loadWorkflowFile(e.target.files[0]) }}
            />
          </div>
        </div>
      )}

      {/* ── Generation params ── */}
      <div className="imggen-section">
        <p className="imggen-section-title">Generation Parameters</p>
        <div className="imggen-grid-2">
          <div className="imggen-row">
            <label>Width</label>
            <input type="number" value={settings.width} step={64} min={256} max={2048}
              onChange={e => update('width', Number(e.target.value))} />
          </div>
          <div className="imggen-row">
            <label>Height</label>
            <input type="number" value={settings.height} step={64} min={256} max={2048}
              onChange={e => update('height', Number(e.target.value))} />
          </div>
          <div className="imggen-row">
            <label>Steps</label>
            <input type="number" value={settings.steps} min={1} max={150}
              onChange={e => update('steps', Number(e.target.value))} />
          </div>
          <div className="imggen-row">
            <label>CFG scale</label>
            <input type="number" value={settings.cfgScale} step={0.5} min={1} max={30}
              onChange={e => update('cfgScale', Number(e.target.value))} />
          </div>
          <div className="imggen-row">
            <label>Sampler</label>
            <select value={settings.sampler} onChange={e => update('sampler', e.target.value)}>
              <option value="euler_ancestral">Euler Ancestral</option>
              <option value="euler">Euler</option>
              <option value="dpm_2_ancestral">DPM++ 2M Ancestral</option>
              <option value="dpmpp_2m">DPM++ 2M</option>
              <option value="dpmpp_sde">DPM++ SDE</option>
              <option value="lcm">LCM</option>
              <option value="ddim">DDIM</option>
            </select>
          </div>
          {isComfy && (
            <div className="imggen-row">
              <label>Scheduler</label>
              <select value={settings.scheduler} onChange={e => update('scheduler', e.target.value)}>
                <option value="normal">Normal</option>
                <option value="karras">Karras</option>
                <option value="exponential">Exponential</option>
                <option value="sgm_uniform">SGM Uniform</option>
                <option value="simple">Simple</option>
              </select>
            </div>
          )}
          <div className="imggen-row">
            <label>Seed (−1 = random)</label>
            <input type="number" value={settings.seed} min={-1}
              onChange={e => update('seed', Number(e.target.value))} />
          </div>
        </div>

        <div style={{ marginTop: '0.75rem' }}>
          <label style={{ fontSize: '0.83rem', color: 'var(--lumi-text-secondary, #cbd5e1)', display: 'block', marginBottom: '0.3rem' }}>
            Negative prompt
          </label>
          <textarea
            className="imggen-textarea"
            value={settings.negativePrompt}
            rows={3}
            onChange={e => update('negativePrompt', e.target.value)}
          />
        </div>
      </div>

      {/* ── Display ── */}
      <div className="imggen-section">
        <p className="imggen-section-title">Display</p>

        <div className="imggen-row">
          <label>Image insertion</label>
          <select
            value={settings.displayMode}
            onChange={e => update('displayMode', e.target.value as Settings['displayMode'])}
          >
            <option value="inline">Inline — replace &lt;pic&gt; tag in place</option>
            <option value="append">Append — strip tags, add images at end of message</option>
            <option value="new_message">New message — post a separate system message per image</option>
          </select>
        </div>

        <div className="imggen-row">
          <label>Max images per reply</label>
          <input
            type="number"
            value={settings.maxImages}
            min={1}
            max={10}
            onChange={e => update('maxImages', Number(e.target.value))}
          />
        </div>
      </div>

      {/* ── Prompt injection ── */}
      <div className="imggen-section">
        <p className="imggen-section-title">Prompt Injection</p>

        <div className="imggen-row" style={{ marginBottom: '0.5rem' }}>
          <label>Auto-inject instruction</label>
          <label className="imggen-toggle">
            <input
              type="checkbox"
              checked={settings.injectSystemPrompt}
              onChange={e => update('injectSystemPrompt', e.target.checked)}
            />
            <span className="imggen-toggle-slider" />
          </label>
        </div>
        <p className="imggen-hint" style={{ marginLeft: 0, marginBottom: '0.5rem' }}>
          When enabled, the instruction below is automatically prepended to every generation via the
          interceptor — no world book entry needed.
          <code style={{ display: 'block', marginTop: '0.2rem' }}>{'{{maxImages}}'}</code> is replaced
          with the max images value at injection time.
        </p>
        <textarea
          className="imggen-textarea"
          value={settings.injectionPromptText}
          rows={6}
          onChange={e => update('injectionPromptText', e.target.value)}
        />
      </div>

      {/* ── Advanced ── */}
      <div className="imggen-section">
        <p className="imggen-section-title">Advanced</p>

        <div className="imggen-row">
          <label>Tag regex</label>
          <input
            type="text"
            value={settings.picRegex}
            onChange={e => update('picRegex', e.target.value)}
            spellCheck={false}
            style={{ fontFamily: 'monospace' }}
          />
        </div>
        <p className="imggen-hint" style={{ marginLeft: 158 }}>
          Must capture the SD prompt as capture group 1. Default matches{' '}
          <code>{'<pic prompt="...">'}</code>.
        </p>

        {isComfy && (
          <div className="imggen-grid-2" style={{ marginTop: '0.75rem' }}>
            <div className="imggen-row">
              <label>Poll interval (ms)</label>
              <input type="number" value={settings.comfyPollIntervalMs} min={500} step={100}
                onChange={e => update('comfyPollIntervalMs', Number(e.target.value))} />
            </div>
            <div className="imggen-row">
              <label>Max polls</label>
              <input type="number" value={settings.comfyMaxPolls} min={5} max={300}
                onChange={e => update('comfyMaxPolls', Number(e.target.value))} />
            </div>
          </div>
        )}
      </div>

      {/* ── Action buttons ── */}
      <div className="imggen-btn-row">
        <button className="imggen-btn imggen-btn-ghost" onClick={resetToDefaults}>
          Reset to defaults
        </button>
        <button
          className="imggen-btn imggen-btn-primary"
          onClick={save}
          disabled={!dirty || saving}
        >
          {saving ? 'Saving…' : dirty ? 'Save settings' : 'Saved'}
        </button>
      </div>

      {/* ── Generation status toast ── */}
      {genStatus !== 'idle' && (
        <div className="imggen-gen-status">
          {genStatus === 'generating' ? (
            <>
              <div className="imggen-spinner" />
              Generating {genCount} image{genCount !== 1 ? 's' : ''}…
            </>
          ) : (
            <>✓ {genCount} image{genCount !== 1 ? 's' : ''} generated</>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Register the panel with Lumiverse ───────────────────────────────────────

// Inject styles
const styleEl = document.createElement('style')
styleEl.textContent = css
document.head.appendChild(styleEl)

// Register extension settings panel
spindle.registerPanel({
  id: 'image_auto_gen',
  label: 'Image Auto Gen',
  icon: '🖼',
  component: ImageAutoGenPanel,
})
