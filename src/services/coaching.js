const llamaClient = require('../config/llama');
const comparisonEngine = require('./comparison');
const { query } = require('../config/database');

/**
 * AI Coaching Service
 * Generates coaching feedback using Llama 3.3
 */

class CoachingService {
  /**
   * Generate complete coaching analysis
   */
  async generateCoaching(driverLapId, referenceLapId, userId) {
    try {
      // Get lap data from database
      const driverLap = await this.getLapData(driverLapId);
      const referenceLap = await this.getReferenceLapData(referenceLapId);
      const userContext = await this.getUserContext(userId);

      // Perform comparison
      const comparison = await comparisonEngine.compareLaps(
        driverLap.file_path,
        referenceLap.file_path
      );

      // Prepare data for AI
      const analysisData = this.prepareAnalysisData(driverLap, referenceLap, comparison);

      // Generate coaching with Llama 3.3
      const coachingText = await llamaClient.generateCoaching(
        analysisData,
        {
          lap_time: referenceLap.lap_time,
          sector1_time: referenceLap.sector1_time,
          sector2_time: referenceLap.sector2_time,
          sector3_time: referenceLap.sector3_time
        },
        userContext
      );

      // Parse coaching into structured format
      const coachingSummary = this.parseCoachingText(coachingText);

      // Save coaching session to database
      const coachingSessionId = await this.saveCoachingSession({
        user_id: userId,
        lap_id: driverLapId,
        reference_lap_id: referenceLapId,
        time_delta: comparison.timeDelta,
        corner_analysis: comparison.cornerComparison,
        input_comparison: comparison.inputAnalysis,
        coaching_text: coachingText,
        coaching_summary: coachingSummary
      });

      return {
        id: coachingSessionId,
        comparison,
        coaching: coachingText,
        summary: coachingSummary,
        metadata: {
          driver_lap: driverLap,
          reference_lap: referenceLap,
          user: userContext
        }
      };
    } catch (error) {
      console.error('Coaching generation error:', error);
      throw new Error(`Failed to generate coaching: ${error.message}`);
    }
  }

  /**
   * Get lap data from database
   */
  async getLapData(lapId) {
    const result = await query(
      `SELECT l.*, s.track_name, s.car_name, u.username
       FROM laps l
       JOIN sessions s ON l.session_id = s.id
       JOIN users u ON l.user_id = u.id
       WHERE l.id = $1`,
      [lapId]
    );

    if (result.rows.length === 0) {
      throw new Error('Lap not found');
    }

    return {
      ...result.rows[0],
      file_path: result.rows[0].ibt_file_path || result.rows[0].blap_file_path
    };
  }

  /**
   * Get reference lap data
   */
  async getReferenceLapData(referenceLapId) {
    const result = await query(
      `SELECT * FROM reference_laps WHERE id = $1`,
      [referenceLapId]
    );

    if (result.rows.length === 0) {
      throw new Error('Reference lap not found');
    }

    return {
      ...result.rows[0],
      file_path: result.rows[0].blap_file_path || result.rows[0].ibt_file_path
    };
  }

  /**
   * Get user context for personalized coaching
   */
  async getUserContext(userId) {
    const result = await query(
      `SELECT u.username, u.iracing_rating, up.coaching_style, up.preferred_units
       FROM users u
       LEFT JOIN user_preferences up ON u.id = up.user_id
       WHERE u.id = $1`,
      [userId]
    );

    if (result.rows.length === 0) {
      return { username: 'Driver', skill_level: 'Intermediate' };
    }

    const user = result.rows[0];
    
    // Determine skill level from iRating
    let skillLevel = 'Intermediate';
    if (user.iracing_rating) {
      if (user.iracing_rating < 1500) skillLevel = 'Beginner';
      else if (user.iracing_rating < 2500) skillLevel = 'Intermediate';
      else if (user.iracing_rating < 4000) skillLevel = 'Advanced';
      else skillLevel = 'Alien';
    }

    return {
      username: user.username,
      skill_level: skillLevel,
      coaching_style: user.coaching_style || 'balanced',
      preferred_units: user.preferred_units || 'metric'
    };
  }

  /**
   * Prepare analysis data for AI
   */
  prepareAnalysisData(driverLap, referenceLap, comparison) {
    return {
      track_name: driverLap.track_name,
      car_name: driverLap.car_name,
      lap_time: driverLap.lap_time,
      sector1_time: driverLap.sector1_time,
      sector2_time: driverLap.sector2_time,
      sector3_time: driverLap.sector3_time,
      corner_comparison: comparison.cornerComparison,
      input_analysis: comparison.inputAnalysis,
      top_issues: comparison.topIssues
    };
  }

  /**
   * Parse coaching text into structured format
   */
  parseCoachingText(coachingText) {
    const summary = {
      priorities: [],
      focus_areas: [],
      practice_drill: '',
      target_time: ''
    };

    // Extract priorities (look for numbered list)
    const priorityRegex = /\*\*Top \d+ Priorities.*?\*\*[:\n]+([\s\S]*?)(?=\n\n|\*\*)/i;
    const priorityMatch = coachingText.match(priorityRegex);
    if (priorityMatch) {
      const priorities = priorityMatch[1]
        .split(/\n/)
        .filter(line => line.trim().match(/^\d+\.|^-/))
        .map(line => line.replace(/^\d+\.\s*|^-\s*/, '').trim());
      summary.priorities = priorities.slice(0, 3);
    }

    // Extract practice drill
    const drillRegex = /\*\*Practice Drill.*?\*\*[:\n]+([\s\S]*?)(?=\n\n|\*\*|$)/i;
    const drillMatch = coachingText.match(drillRegex);
    if (drillMatch) {
      summary.practice_drill = drillMatch[1].trim();
    }

    // Extract target time
    const targetRegex = /target.*?time.*?(\d+:\d+\.\d+|\d+\.\d+)/i;
    const targetMatch = coachingText.match(targetRegex);
    if (targetMatch) {
      summary.target_time = targetMatch[1];
    }

    return summary;
  }

  /**
   * Save coaching session to database
   */
  async saveCoachingSession(data) {
    const result = await query(
      `INSERT INTO coaching_sessions 
       (user_id, lap_id, reference_lap_id, time_delta, corner_analysis, 
        input_comparison, coaching_text, coaching_summary, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
       RETURNING id`,
      [
        data.user_id,
        data.lap_id,
        data.reference_lap_id,
        data.time_delta,
        JSON.stringify(data.corner_analysis),
        JSON.stringify(data.input_comparison),
        data.coaching_text,
        JSON.stringify(data.coaching_summary)
      ]
    );

    return result.rows[0].id;
  }

  /**
   * Generate track learning coaching
   */
  async generateTrackLearning(sessionId, userId) {
    try {
      // Get session data
      const session = await query(
        `SELECT s.*, COUNT(l.id) as total_laps, MIN(l.lap_time) as best_lap,
         AVG(l.lap_time) as avg_lap
         FROM sessions s
         LEFT JOIN laps l ON s.id = l.session_id
         WHERE s.id = $1
         GROUP BY s.id`,
        [sessionId]
      );

      if (session.rows.length === 0) {
        throw new Error('Session not found');
      }

      const sessionData = session.rows[0];

      // Get lap history
      const laps = await query(
        `SELECT lap_number, lap_time, sector1_time, sector2_time, sector3_time
         FROM laps
         WHERE session_id = $1
         ORDER BY lap_number ASC`,
        [sessionId]
      );

      // Generate learning coaching
      const trackInfo = {
        track_name: sessionData.track_name,
        expected_lap_range: '2:18-2:21' // TODO: Get from track database
      };

      const coachingText = await llamaClient.generateTrackLearning(
        trackInfo,
        {
          current_lap: sessionData.total_laps,
          total_laps: 20,
          best_lap: sessionData.best_lap,
          sector1_variance: this.calculateVariance(laps.rows, 'sector1_time'),
          sector2_variance: this.calculateVariance(laps.rows, 'sector2_time'),
          sector3_variance: this.calculateVariance(laps.rows, 'sector3_time')
        },
        laps.rows
      );

      return {
        coaching: coachingText,
        session: sessionData,
        lapHistory: laps.rows
      };
    } catch (error) {
      console.error('Track learning error:', error);
      throw new Error(`Failed to generate track learning coaching: ${error.message}`);
    }
  }

  /**
   * Calculate variance for a metric
   */
  calculateVariance(data, field) {
    const values = data.map(d => d[field]).filter(v => v);
    if (values.length === 0) return 0;

    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const variance = values.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / values.length;
    return Math.sqrt(variance).toFixed(2);
  }

  /**
   * Chat with AI coach
   */
  async chat(userId, message, context = {}) {
    try {
      const userContext = await this.getUserContext(userId);

      const messages = [
        {
          role: 'system',
          content: `You are a professional sim racing coach. The driver's name is ${userContext.username} and their skill level is ${userContext.skill_level}. Provide concise, actionable coaching advice.`
        },
        {
          role: 'user',
          content: message
        }
      ];

      // Add context if available
      if (context.lastCoaching) {
        messages.splice(1, 0, {
          role: 'assistant',
          content: `Previous coaching: ${context.lastCoaching}`
        });
      }

      const response = await llamaClient.chat(messages);

      return {
        message: response,
        user: userContext
      };
    } catch (error) {
      console.error('Chat error:', error);
      throw new Error(`Failed to chat with coach: ${error.message}`);
    }
  }
}

module.exports = new CoachingService();
