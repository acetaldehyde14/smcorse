const express = require('express');
const { authenticateToken } = require('../middleware/auth');
const axios = require('axios');

const router = express.Router();

const OLLAMA_HOST = process.env.OLLAMA_HOST || 'http://23.141.136.111:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'llama3.3:70b-instruct-q4_K_M';

// System prompt for the AI assistant
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

// Chat endpoint
router.post('/chat', authenticateToken, async (req, res) => {
  try {
    const { message, conversation_history } = req.body;

    if (!message) {
      return res.status(400).json({ error: 'Message is required' });
    }

    // Build messages array for Llama
    const messages = [
      {
        role: 'system',
        content: SYSTEM_PROMPT
      }
    ];

    // Add conversation history if provided
    if (conversation_history && Array.isArray(conversation_history)) {
      messages.push(...conversation_history);
    }

    // Add current user message
    messages.push({
      role: 'user',
      content: message
    });

    console.log(`AI Assistant request from user ${req.user.id}: ${message}`);

    // Call Ollama API
    const response = await axios.post(
      `${OLLAMA_HOST}/api/chat`,
      {
        model: OLLAMA_MODEL,
        messages: messages,
        stream: false,
        options: {
          temperature: 0.7,
          top_p: 0.9
        }
      },
      {
        timeout: 300000 // 5 minute timeout
      }
    );

    const assistantMessage = response.data.message.content;

    res.json({
      response: assistantMessage,
      model: OLLAMA_MODEL
    });

  } catch (error) {
    console.error('AI Assistant error:', error);

    if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') {
      return res.status(504).json({
        error: 'Request timed out. The AI server may be busy. Please try again.'
      });
    }

    if (error.response) {
      return res.status(error.response.status).json({
        error: `AI server error: ${error.response.statusText}`
      });
    }

    res.status(500).json({
      error: 'Failed to get AI response. Please try again later.'
    });
  }
});

// Web search endpoint (for AI to use)
router.post('/search', authenticateToken, async (req, res) => {
  try {
    const { query } = req.body;

    if (!query) {
      return res.status(400).json({ error: 'Search query is required' });
    }

    console.log(`Web search request: ${query}`);

    // Use DuckDuckGo instant answer API (free, no key required)
    const searchResponse = await axios.get('https://api.duckduckgo.com/', {
      params: {
        q: query,
        format: 'json',
        no_html: 1,
        skip_disambig: 1
      },
      timeout: 10000
    });

    const data = searchResponse.data;
    let results = [];

    // Extract relevant information
    if (data.AbstractText) {
      results.push({
        title: data.Heading || 'Search Result',
        snippet: data.AbstractText,
        url: data.AbstractURL
      });
    }

    // Add related topics
    if (data.RelatedTopics && data.RelatedTopics.length > 0) {
      data.RelatedTopics.slice(0, 5).forEach(topic => {
        if (topic.Text && topic.FirstURL) {
          results.push({
            title: topic.Text.substring(0, 100),
            snippet: topic.Text,
            url: topic.FirstURL
          });
        }
      });
    }

    res.json({
      query: query,
      results: results
    });

  } catch (error) {
    console.error('Search error:', error);
    res.status(500).json({ error: 'Search failed' });
  }
});

// Health check
router.get('/health', async (req, res) => {
  try {
    const response = await axios.get(`${OLLAMA_HOST}/api/tags`, {
      timeout: 5000
    });

    const models = response.data.models || [];
    const modelAvailable = models.some(m => m.name.includes('llama3.3'));

    res.json({
      status: 'ok',
      ollama_host: OLLAMA_HOST,
      model: OLLAMA_MODEL,
      model_available: modelAvailable
    });
  } catch (error) {
    res.status(503).json({
      status: 'error',
      error: 'Cannot connect to AI server'
    });
  }
});

module.exports = router;
