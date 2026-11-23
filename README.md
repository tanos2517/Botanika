# Botanika AI Pro

The interface is in `Botanika-AI (1).html`. The AI features require a server-side API; do not put provider keys in the HTML.

## Run locally on Windows

1. Copy `.env.example` to `.env` and set `OPENROUTER_API_KEY` to a new OpenRouter key. `OPENROUTER_MODEL` defaults to a vision-capable Gemma model and can be changed if OpenRouter changes availability.
2. In PowerShell, run:

   ```powershell
   .\server.ps1
   ```

3. Open `http://localhost:8080/`.

The local server implements `/api/chat` and `/api/encyclopedia`. The encyclopedia combines an AI-written plant profile with public image search from Wikimedia Commons.

## Deploy publicly with Vercel

1. Import this folder as a Vercel project. If the repository contains other projects, set the project Root Directory to `Botanika`.
2. Add `OPENROUTER_API_KEY` and `OPENROUTER_MODEL` in the Vercel project's Environment Variables. Use an OpenRouter model that supports image input for photo analysis. Optionally set `APP_URL` to the public site URL.
3. Deploy. The root `index.html` opens the app, and the `api` folder provides `/api/chat` and `/api/encyclopedia`.
4. Open the public HTTPS URL and test the plant photo analysis and encyclopedia.

Never commit `.env` or paste a key into the HTML. Revoke any key that was previously published. Static-only hosting (for example, GitHub Pages) cannot run the AI API endpoints; use a host that supports serverless functions or a backend.

## Notes

- User profile, history, and greenhouse data are stored in that browser's local storage and IndexedDB; they are not synced between devices.
- Encyclopedia text is AI-generated and should be checked against the linked references. Images are served by Wikimedia Commons and link back to their file pages.
- Public AI endpoints can incur provider usage. Set account limits with OpenRouter and monitor usage.
