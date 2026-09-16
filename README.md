# RAJUVAS AI Backend

## Local test
1. Install Node.js LTS.
2. `npm install`
3. Copy `.env.example` to `.env`.
4. Put your OpenAI API key in `.env`.
5. `npm start`
6. Test `http://localhost:3000/api/health`.

## Website
Open the AI-connected HTML → Add Files & Ingest → enter the backend URL → Save AI URL → select papers → AI Analyze Papers.

## Public deployment
Deploy this Node project to a Node-compatible hosting service. Add `OPENAI_API_KEY` as a server environment variable. Never put the key in the HTML.

The static PageShare frontend and this backend are separate: PageShare serves the HTML, while the backend performs the AI calls.
