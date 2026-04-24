const express = require('express');
const { authenticateToken } = require('../middleware/auth');
const axios = require('axios');
const OpenAI = require('openai');

const router = express.Router();

const NVIDIA_API_KEY = process.env.NVIDIA_API_KEY || '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';

const client = new OpenAI({
  baseURL: 'https://integrate.api.nvidia.com/v1',
  apiKey:  NVIDIA_API_KEY,
  timeout: 120000, // 2 minutes — NVIDIA models can be slow to cold-start
});

// ── Model registry ────────────────────────────────────────────────────────────
const MODELS = {
  'glm-5.1': {
    id:          'z-ai/glm-5.1',
    label:       'GLM 5.1',
    temperature: 1.0,
    top_p:       0.95,
    max_tokens:  4096,
  },
  'minimax-m2': {
    id:          'minimaxai/minimax-m2.7',
    label:       'MiniMax M2.7',
    temperature: 1.0,
    top_p:       0.95,
    max_tokens:  4096,
  },
};

const DEFAULT_MODEL_KEY = 'minimax-m2';

// Resolve a model key from the request body (key or full model id both accepted).
function resolveModel(requested) {
  if (!requested) return MODELS[DEFAULT_MODEL_KEY];
  // Exact key match (e.g. 'glm-5.1')
  if (MODELS[requested]) return MODELS[requested];
  // Full model id match (e.g. 'z-ai/glm-5.1')
  const byId = Object.values(MODELS).find(m => m.id === requested);
  if (byId) return byId;
  return null; // unknown model
}

// Strip <think>...</think> reasoning blocks that some models embed in content.
function stripThinking(text) {
  return text.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
}

// Build the create() params for a given model config.
function buildParams(modelCfg, messages) {
  return {
    model:       modelCfg.id,
    messages,
    temperature: modelCfg.temperature,
    top_p:       modelCfg.top_p,
    max_tokens:  modelCfg.max_tokens,
  };
}

// ── System prompt ─────────────────────────────────────────────────────────────
const SYSTEM_PROMPT = `You are an expert race engineer and professional sim racer with deep knowledge of:
- iRacing platform, cars, and tracks
- Le Mans Ultimate (LMU) platform, cars, and tracks
- Race strategy and tire management for both iRacing and LMU
- Setup optimization and telemetry analysis
- Driver coaching and technique improvement
- Endurance racing tactics and stint planning (24h Le Mans, Spa, Daytona, etc.)
- Fuel calculations and pit stop strategy
- Car dynamics, aerodynamics, and handling
- Force feedback (FFB) settings and hardware setup (Moza, Fanatec, Thrustmaster, etc.)
- Tire compounds, pressure management, and wear strategies
- Weather and track condition adaptation

You provide detailed, technical advice while remaining approachable and educational. When answering questions:
- Be specific and actionable
- Reference real-world racing principles when applicable
- Explain technical concepts clearly
- Suggest concrete improvements when discussing driving technique
- Consider both theoretical knowledge and practical sim racing experience
- When discussing LMU-specific content (like 2026 HY tire updates), provide detailed analysis
- For hardware questions (FFB settings, wheel bases, pedals), give practical recommendations

If you need current information (track updates, recent patches, tire updates, current world records, hardware reviews), you should perform web searches to provide accurate, up-to-date information.`;

// ── GET /api/assistant/models ─────────────────────────────────────────────────
// Returns the list of available models so the frontend can populate a selector.
router.get('/models', authenticateToken, (req, res) => {
  const list = Object.entries(MODELS).map(([key, m]) => ({
    key,
    id:       m.id,
    label:    m.label,
    thinking: m.thinking,
    default:  key === DEFAULT_MODEL_KEY,
  }));
  res.json({ models: list, default: DEFAULT_MODEL_KEY });
});

// ── POST /api/assistant/chat ──────────────────────────────────────────────────
// Body: { message, conversation_history?, model? }
//   model: key ('glm-5.1', 'minimax-m2') or full id ('z-ai/glm-5.1')
//          defaults to DEFAULT_MODEL_KEY if omitted or unknown
//
// Response modes (Accept header):
//   application/json   → collect full stream, return { response, reasoning?, model }
//   text/event-stream  → SSE: { type:'reasoning'|'content'|'done', text }
router.post('/chat', authenticateToken, async (req, res) => {
  const { message, conversation_history, model: requestedModel } = req.body;

  if (!message) {
    return res.status(400).json({ error: 'Message is required' });
  }

  const modelCfg = resolveModel(requestedModel) ?? MODELS[DEFAULT_MODEL_KEY];

  const messages = [{ role: 'system', content: SYSTEM_PROMPT }];
  if (Array.isArray(conversation_history)) {
    messages.push(...conversation_history);
  }
  messages.push({ role: 'user', content: message });

  console.log(`AI Assistant [${modelCfg.id}] user ${req.user.id}: ${message.substring(0, 100)}`);

  try {
    const response = await client.chat.completions.create(buildParams(modelCfg, messages));
    const content = stripThinking(response.choices[0].message.content);

    res.json({
      response:  content,
      model:     modelCfg.id,
      model_key: Object.keys(MODELS).find(k => MODELS[k].id === modelCfg.id),
    });

  } catch (error) {
    console.error('AI Assistant error:', error);
    const status = error.status ?? 500;
    if (status === 401) return res.status(401).json({ error: 'Invalid API key. Check NVIDIA_API_KEY in environment.' });
    if (status === 429) return res.status(429).json({ error: 'Rate limit reached. Please wait a moment and try again.' });
    res.status(500).json({ error: 'Failed to get AI response. Please try again later.' });
  }
});

// ── GET /api/assistant/search ─────────────────────────────────────────────────
router.get('/search', authenticateToken, async (req, res) => {
  const { query } = req.query;
  if (!query) return res.status(400).json({ error: 'query parameter is required' });

  try {
    const searchResponse = await axios.get('https://api.duckduckgo.com/', {
      params: { q: query, format: 'json', no_html: 1, skip_disambig: 1 },
      timeout: 10000,
    });
    const data = searchResponse.data;
    const results = [];
    if (data.AbstractText) {
      results.push({ title: data.Heading || 'Search Result', snippet: data.AbstractText, url: data.AbstractURL });
    }
    if (Array.isArray(data.RelatedTopics)) {
      data.RelatedTopics.slice(0, 5).forEach(topic => {
        if (topic.Text && topic.FirstURL) {
          results.push({ title: topic.Text.substring(0, 100), snippet: topic.Text, url: topic.FirstURL });
        }
      });
    }
    res.json({ query, results });
  } catch (error) {
    console.error('Search error:', error);
    res.status(500).json({ error: 'Search failed' });
  }
});

// ── GET /api/assistant/health ─────────────────────────────────────────────────
// Result cached for 5 minutes to avoid burning rate-limit quota on every poll.
let _healthCache = null;
let _healthCacheAt = 0;
const HEALTH_CACHE_MS = 5 * 60 * 1000;

router.get('/health', async (req, res) => {
  const now = Date.now();
  if (_healthCache && now - _healthCacheAt < HEALTH_CACHE_MS) {
    return res.status(_healthCache.ok ? 200 : 503).json(_healthCache.body);
  }

  const modelCfg = MODELS[DEFAULT_MODEL_KEY];
  try {
    await client.chat.completions.create({
      model:      modelCfg.id,
      messages:   [{ role: 'user', content: 'ping' }],
      max_tokens: 1,
    });
    const body = { status: 'ok', provider: 'nvidia', default_model: modelCfg.id, available_models: Object.keys(MODELS) };
    _healthCache = { ok: true, body };
    _healthCacheAt = now;
    res.json(body);
  } catch (error) {
    const body = { status: 'error', error: error.message };
    _healthCache = { ok: false, body };
    _healthCacheAt = now;
    res.status(503).json(body);
  }
});

module.exports = router;
