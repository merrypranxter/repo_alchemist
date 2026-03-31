# Repo Alchemist

Transform GitHub repositories into unique AI-generated art. Feed it your repos, write an art direction prompt, and watch it fuse your codebase's vibe into a maximalist image via Gemini.

## Features

- **Repo Vibe Fusion** - Gemini reads your repo structure, README, and metadata, then fuses it with your art direction into a rich image prompt.
- **Multi-repo mixing** - Combine vibes from multiple repos into one image.
- **Image generation** - Three Gemini image models to choose from (Nano Banana series).
- **Local render history** - Every generation is saved to your browser's localStorage so images survive page refreshes and restarts (up to 20 items; gracefully prunes when storage fills).
- **BYOK (Bring Your Own Key)** - Enter your Gemini API key via the UI; stored only in your browser's localStorage.

---

## Running Locally

**Prerequisites:** Node.js 18+

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment

Copy `.env.example` to `.env.local` and fill in your keys:

```bash
cp .env.example .env.local
```

Edit `.env.local`:

```
# Required for Gemini AI calls
VITE_GEMINI_API_KEY=your_gemini_api_key_here

# Optional - for loading your own GitHub repos
VITE_GITHUB_TOKEN=your_github_pat_here
```

> **Tip:** You can also skip `.env.local` entirely and enter your Gemini key via the **Set Key** button in the app UI. It will be saved to `localStorage` in your browser.

### 3. Start the dev server

```bash
npm run dev
```

Open http://localhost:3000.

---

## API Key Security

- The Gemini API key is stored **only in your browser's `localStorage`** - it is never sent to any server other than the Gemini API directly.
- If you set `VITE_GEMINI_API_KEY` in `.env.local`, that value takes precedence over the UI-entered key.
- Do not commit `.env.local` to version control (it is already listed in `.gitignore`).

---

## Render History

All generations are automatically saved locally. Click the **History** button (clock icon) in the header to browse past renders. You can:

- **Restore** a past render back into the current state (all settings + images).
- **Clear** all history via the trash icon.

History is stored in `localStorage` under the key `repo-alchemist-history` (max 20 items). If your browser's storage fills up, older images are pruned automatically with a warning.

---

## Deployment

This is a static Vite app - just build and deploy the `dist/` folder to any static host (Netlify, Vercel, GitHub Pages, etc.):

```bash
npm run build
```

When deployed, users set their own Gemini key via the UI (BYOK), so no server-side secrets are needed.
