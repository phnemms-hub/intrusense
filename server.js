// ═══════════════════════════════════════════════════════
//  InstruSense — Backend Server (Google Gemini FREE API)
//  This tiny server sits between your browser and the AI.
//  Browser → This server → Google Gemini API → back to browser
//
//  WHY GEMINI? It's completely free — no credit card needed.
//  Free tier: 1,500 requests/day (more than enough!)
// ═══════════════════════════════════════════════════════

const http = require('http');
const https = require('https');
const fs   = require('fs');
const path = require('path');

// ── YOUR FREE API KEY ─────────────────────────────────
// HOW TO GET IT (free, no credit card):
//   1. Go to https://aistudio.google.com
//   2. Sign in with your Google account
//   3. Click "Get API Key" in the top left
//   4. Click "Create API key"
//   5. Copy it and paste it below
// ─────────────────────────────────────────────────────
const GEMINI_API_KEY = 'PASTE_YOUR_GEMINI_KEY_HERE';

const PORT = 3000;

// ── CREATE THE SERVER ──
const server = http.createServer(async (req, res) => {

  // Allow browser to talk to this server (CORS)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // ── ROUTE 1: Serve the main HTML page ──
  if (req.method === 'GET' && (req.url === '/' || req.url === '/index.html')) {
    const filePath = path.join(__dirname, 'index.html');
    fs.readFile(filePath, (err, data) => {
      if (err) { res.writeHead(404); res.end('index.html not found'); return; }
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(data);
    });
    return;
  }

  // ── ROUTE 2: Forward image to Google Gemini AI ──
  if (req.method === 'POST' && req.url === '/analyze') {

    let body = '';
    req.on('data', chunk => { body += chunk.toString(); });

    req.on('end', async () => {
      try {
        const { imageBase64, imageMimeType } = JSON.parse(body);

        // ── BUILD THE GEMINI REQUEST ──
        // Gemini uses a different format than Anthropic but works the same way:
        // we send the image + instructions and get text back.
        const requestBody = JSON.stringify({
          contents: [
            {
              parts: [
                {
                  // The image — sent as base64 just like before
                  inline_data: {
                    mime_type: imageMimeType,
                    data: imageBase64
                  }
                },
                {
                  // Our instruction to the AI
                  text: `You are an expert ethnomusicologist and music historian. Analyze this image and identify the musical instrument shown.

Return ONLY a JSON object with NO markdown, NO backticks, NO extra text. Just raw JSON like this:
{
  "name": "Full instrument name",
  "family": "e.g. String / Wind / Percussion / Keyboard / Electronic",
  "origin": "Country or region of origin",
  "era": "e.g. Ancient / Medieval / 18th century / Modern",
  "genres": "e.g. Classical, Jazz, Folk",
  "confidence": "High / Medium / Low",
  "about": "2-3 sentence description of the instrument: what it is, where it comes from, why it matters",
  "sound_description": "One sentence describing what this instrument sounds like",
  "play_steps": [
    "Beginner step 1",
    "Beginner step 2",
    "Beginner step 3",
    "Beginner step 4",
    "Beginner step 5"
  ],
  "fun_facts": [
    "Interesting fact 1",
    "Interesting fact 2",
    "Interesting fact 3"
  ],
  "famous_players": ["Name1", "Name2", "Name3"],
  "related_instruments": ["Instrument1", "Instrument2", "Instrument3"],
  "sound_type": "one of: string, wind, percussion, keyboard, electronic, brass, woodwind"
}

If the image does not contain a musical instrument, return: {"error": "No instrument found in this image."}`
                }
              ]
            }
          ],
          generationConfig: {
            temperature: 0.2,    // lower = more focused, less random
            maxOutputTokens: 1000
          }
        });

        // ── SEND REQUEST TO GOOGLE GEMINI ──
        // The URL includes your API key as a query parameter
        const geminiPath = `/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`;

        const options = {
          hostname: 'generativelanguage.googleapis.com',
          path: geminiPath,
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(requestBody)
          }
        };

        const apiReq = https.request(options, (apiRes) => {
          let responseData = '';
          apiRes.on('data', chunk => { responseData += chunk; });
          apiRes.on('end', () => {
            try {
              // Gemini wraps the response differently than Anthropic.
              // We need to extract the text from inside the Gemini response structure.
              const geminiResponse = JSON.parse(responseData);

              // Check for Gemini API errors
              if (geminiResponse.error) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: geminiResponse.error.message }));
                return;
              }

              // Extract the text from Gemini's response structure:
              // geminiResponse.candidates[0].content.parts[0].text
              const text = geminiResponse.candidates?.[0]?.content?.parts?.[0]?.text || '';

              // Clean and parse the JSON that the AI returned
              const clean = text.replace(/```json|```/g, '').trim();
              const parsed = JSON.parse(clean);

              // Send back in the same format the frontend expects
              // (we mimic the Anthropic format so index.html doesn't need to change)
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({
                content: [{ type: 'text', text: JSON.stringify(parsed) }]
              }));

            } catch (parseErr) {
              console.error('Parse error:', parseErr, responseData);
              res.writeHead(500, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: 'Failed to parse AI response. Try again.' }));
            }
          });
        });

        apiReq.on('error', (err) => {
          console.error('Gemini API error:', err);
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Failed to reach Gemini API: ' + err.message }));
        });

        apiReq.write(requestBody);
        apiReq.end();

      } catch (err) {
        console.error('Server error:', err);
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Bad request: ' + err.message }));
      }
    });

    return;
  }

  // ── Anything else → 404 ──
  res.writeHead(404);
  res.end('Not found');
});

server.listen(PORT, () => {
  console.log('');
  console.log('✅  InstruSense server is running! (Powered by Google Gemini - FREE)');
  console.log(`🌐  Open this in your browser: http://localhost:${PORT}`);
  console.log('');
  console.log('Press Ctrl+C to stop the server.');
});
