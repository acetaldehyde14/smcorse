const axios = require('axios');
require('dotenv').config();

const OLLAMA_HOST = process.env.OLLAMA_HOST || 'http://localhost:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'llama3.3:70b';

class LlamaClient {
  constructor() {
    this.host = OLLAMA_HOST;
    this.model = OLLAMA_MODEL;
    this.timeout = 120000; // 2 minutes for complex analysis
  }

  async isAvailable() {
    try {
      const response = await axios.get(`${this.host}/api/tags`, {
        timeout: 5000
      });
      return response.data.models.some(m => m.name === this.model);
    } catch (error) {
      console.error('Ollama not available:', error.message);
      return false;
    }
  }

  async generate(prompt, options = {}) {
    try {
      const response = await axios.post(
        `${this.host}/api/generate`,
        {
          model: this.model,
          prompt: prompt,
          stream: false,
          options: {
            temperature: options.temperature || 0.7,
            top_p: options.top_p || 0.9,
            num_predict: options.max_tokens || 2000,
          }
        },
        {
          timeout: this.timeout
        }
      );

      return response.data.response;
    } catch (error) {
      console.error('Llama generation error:', error.message);
      throw new Error('Failed to generate coaching response');
    }
  }

  async chat(messages, options = {}) {
    try {
      const response = await axios.post(
        `${this.host}/api/chat`,
        {
          model: this.model,
          messages: messages,
          stream: false,
          options: {
            temperature: options.temperature || 0.7,
            top_p: options.top_p || 0.9,
          }
        },
        {
          timeout: this.timeout
        }
      );

      return response.data.message.content;
    } catch (error) {
      console.error('Llama chat error:', error.message);
      throw new Error('Failed to generate chat response');
    }
  }

  // Specific coaching prompt
  async generateCoaching(lapAnalysis, referenceData, userContext = {}) {
    const prompt = this.buildCoachingPrompt(lapAnalysis, referenceData, userContext);
    return await this.generate(prompt, { temperature: 0.7, max_tokens: 2500 });
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

4. **Practice Drill**: Create one specific drill for the next session (e.g., "Focus on Turn 3-5 complex, practice carrying 5 km/h more through Turn 4")

5. **Realistic Goal**: What lap time should be achievable after addressing these issues?

Keep the tone encouraging but direct. Be specific with numbers and reference points. Make it actionable.`;
  }

  // Track learning assistant
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

// Singleton instance
const llamaClient = new LlamaClient();

module.exports = llamaClient;
