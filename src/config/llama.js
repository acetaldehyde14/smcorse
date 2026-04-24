const OpenAI = require('openai');
require('dotenv').config();

const NVIDIA_API_KEY = process.env.NVIDIA_API_KEY || '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';

const _client = new OpenAI({
  baseURL: 'https://integrate.api.nvidia.com/v1',
  apiKey:  NVIDIA_API_KEY,
  timeout: 120000,
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

function stripThinking(text) {
  return text.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
}

function resolveModel(requested) {
  if (!requested) return MODELS[DEFAULT_MODEL_KEY];
  if (MODELS[requested]) return MODELS[requested];
  const byId = Object.values(MODELS).find(m => m.id === requested);
  return byId ?? MODELS[DEFAULT_MODEL_KEY];
}

// ── LlamaClient ───────────────────────────────────────────────────────────────
class LlamaClient {
  constructor() {
    this.model = MODELS[DEFAULT_MODEL_KEY].id;
  }

  static availableModels() {
    return { models: MODELS, default: DEFAULT_MODEL_KEY };
  }

  async isAvailable() {
    try {
      const modelCfg = MODELS[DEFAULT_MODEL_KEY];
      await _client.chat.completions.create({
        model:      modelCfg.id,
        messages:   [{ role: 'user', content: 'ping' }],
        max_tokens: 1,
      });
      return true;
    } catch (err) {
      console.error('NVIDIA API not available:', err.message);
      return false;
    }
  }

  async generate(prompt, options = {}) {
    const modelCfg = resolveModel(options.model);
    const response = await _client.chat.completions.create({
      model:       modelCfg.id,
      messages:    [{ role: 'user', content: prompt }],
      temperature: options.temperature ?? modelCfg.temperature,
      top_p:       options.top_p       ?? modelCfg.top_p,
      max_tokens:  options.max_tokens  ?? modelCfg.max_tokens,
    });
    return stripThinking(response.choices[0].message.content);
  }

  async chat(messages, options = {}) {
    const modelCfg = resolveModel(options.model);
    const response = await _client.chat.completions.create({
      model:       modelCfg.id,
      messages,
      temperature: options.temperature ?? modelCfg.temperature,
      top_p:       options.top_p       ?? modelCfg.top_p,
      max_tokens:  options.max_tokens  ?? modelCfg.max_tokens,
    });
    return stripThinking(response.choices[0].message.content);
  }

  async generateCoaching(lapAnalysis, referenceData, userContext = {}) {
    const prompt = this.buildCoachingPrompt(lapAnalysis, referenceData, userContext);
    return await this.generate(prompt, { model: 'glm-5.1', temperature: 1.0, top_p: 0.95, max_tokens: 4096 });
  }

  buildCoachingPrompt(lapAnalysis, referenceData, userContext) {
    const { username = 'Driver', skill_level = 'Intermediate' } = userContext;
    return `You are a professional sim racing coach analyzing iRacing telemetry data.

DRIVER INFO:
- Name: ${username}
- Skill Level: ${skill_level}
- Track: ${lapAnalysis.track_name}
- Car: ${lapAnalysis.car_name}

LAP TIMES:
- Driver's lap: ${lapAnalysis.lap_time.toFixed(3)}s
- Reference lap: ${referenceData.lap_time.toFixed(3)}s
- Time gap: ${(lapAnalysis.lap_time - referenceData.lap_time).toFixed(3)}s

SECTOR BREAKDOWN:
- Sector 1: Driver ${lapAnalysis.sector1_time?.toFixed(3) || 'N/A'}s | Reference ${referenceData.sector1_time?.toFixed(3) || 'N/A'}s
- Sector 2: Driver ${lapAnalysis.sector2_time?.toFixed(3) || 'N/A'}s | Reference ${referenceData.sector2_time?.toFixed(3) || 'N/A'}s
- Sector 3: Driver ${lapAnalysis.sector3_time?.toFixed(3) || 'N/A'}s | Reference ${referenceData.sector3_time?.toFixed(3) || 'N/A'}s

CORNER-BY-CORNER ANALYSIS:
${JSON.stringify(lapAnalysis.corner_comparison, null, 2)}

INPUT COMPARISON:
${JSON.stringify(lapAnalysis.input_analysis, null, 2)}

TASK:
Provide detailed, actionable coaching feedback. Include:

1. **Top 3 Priorities**: The most important areas to focus on (ranked by potential time gain)

2. **Detailed Corner Analysis**: For the biggest time losses, explain:
   - What the driver is doing wrong
   - What the reference lap does differently
   - Specific technique to improve

3. **Input Technique**: Comment on:
   - Braking technique (timing, pressure, consistency)
   - Throttle application (smoothness, timing)
   - Steering inputs (smoothness, aggression)

4. **Practice Drill**: Create one specific drill for the next session

5. **Realistic Goal**: What lap time should be achievable after addressing these issues?

Keep the tone encouraging but direct. Be specific with numbers and reference points.`;
  }

  async generateTrackLearning(trackInfo, sessionData, lapHistory) {
    const prompt = `You are helping a driver learn ${trackInfo.track_name} for the first time.

SESSION: Practice Lap ${sessionData.current_lap}/${sessionData.total_laps}
Current best: ${sessionData.best_lap}s
Typical times for this skill level: ${trackInfo.expected_lap_range}

CONSISTENCY BY SECTOR:
- Sector 1: ±${sessionData.sector1_variance}s
- Sector 2: ±${sessionData.sector2_variance}s
- Sector 3: ±${sessionData.sector3_variance}s

LAP HISTORY:
${JSON.stringify(lapHistory, null, 2)}

Provide:
1. Which corners/sectors to prioritize learning next
2. Specific reference points to memorize for the most inconsistent area
3. A realistic time target for the next 5 laps
4. One key technique tip for the track`;
    return await this.generate(prompt);
  }
}

const llamaClient = new LlamaClient();
module.exports = llamaClient;
