## Pinterest Agent – Auto post Pins

This project is a small agent that **automatically publishes Pins to Pinterest** from local images.
It is designed for workflows where you already have product / lifestyle images on disk and want to:

- Generate SEO‑friendly titles, descriptions, tags, and alt text with OpenAI
- Choose the right board (and board section) automatically
- Post in bulk or on a schedule

> **Note**: All API keys and tokens must be stored only in `.env` (ignored by git).  
> Do **not** commit secrets to GitHub.
>
> This project only provides tooling code. When using the Pinterest API, OpenAI API, or any other third‑party services, you must comply with their official terms of service and usage policies.

---

## 1. Prerequisites

- Node.js 18+ and npm
- A Pinterest app (v5 API) with scopes:
  - `boards:read`, `boards:write`, `pins:read`, `pins:write`
- A Pinterest account that has at least one board (and optional sections)
- An OpenAI API key (for AI‑generated copy)

### 1.1 Environment variables (`.env`)

Create a `.env` file in the project root:

```bash
PINTEREST_CLIENT_ID=...
PINTEREST_CLIENT_SECRET=...
PINTEREST_REDIRECT_URI=http://localhost:3000/pinterest/callback
PORT=3000

# Trial apps must use sandbox; once your app is approved you can set this to false or remove it.
PINTEREST_USE_SANDBOX=true

OPENAI_API_KEY=sk-...

# Optional – used by the scheduler (see below)
# PIN_BOARD_ID=BoardID
# PIN_SCHEDULE_CRON=0 9 * * *
# PIN_SCHEDULE_AI_FIELDS=true
# PIN_SCHEDULE_RUN_NOW=true
```

`.gitignore` already excludes `.env`, `tokens.json`, and `assets/*`, so secrets will not be pushed to GitHub.

---

## 2. Project setup

### 2.1 Install dependencies

```bash
npm install
```

This installs runtime deps (`axios`, `express`, `dotenv`, `node-cron`) and TypeScript tooling.

### 2.2 Run the OAuth flow (one‑time, or when tokens expire)

1. **Start the local server**:

   ```bash
   npm run dev
   ```

2. In your browser, open:

   ```text
   http://localhost:3000/pinterest/login
   ```

   You will be redirected to Pinterest to grant access, and then back to
   `PINTEREST_REDIRECT_URI` (e.g. `http://localhost:3000/pinterest/callback`).

3. If everything is correct you will see:

   > `Token saved to tokens.json (Sandbox)...`

   A `tokens.json` file will be created in the project root and used by the agent
   for authenticated Pinterest API calls.

You can now stop `npm run dev` or leave it running while you experiment.

---

## 3. Basic workflow – post Pins from local images

### 3.1 List your boards (get `board_id`)

```bash
npm run boards
```

This calls Pinterest `GET /v5/boards` and prints:

```text
----------------------------------------
  BoardID  Modern Kitchen Cabinets
  ...
----------------------------------------
```

Copy the ID of the board you want to post to.

### 3.2 Prepare images

Place images you want to post into:

```text
assets/to-post
```

Supported formats: `.jpg`, `.jpeg`, `.png`.

When the agent runs:

- **Success** → image is moved to `assets/posted`
- **Failure** → image is moved to `assets/failed`

You can also override the directory per run with `--dir=...`.

### 3.3 Post Pins to a board

```bash
npm run post-pins -- --board=BOARD_ID
```

Default behaviour:

- Reads all images from `assets/to-post`
- Posts each as a new Pin on the given board
- Uses a simple default title/description if AI is not enabled

Optional arguments (after `--`):

- `--dir=PATH` – image directory (default `assets/to-post`)
- `--image=PATH` – post a single image instead of a directory
- `--title=TEXT` – default title when not using AI
- `--description=TEXT` – default description when not using AI

Example:

```bash
npm run post-pins -- --board=BoardID --dir=./my-photos --title="My photo" --description="The Cabination"
```

---

## 4. Smarter board + section selection

### 4.1 Choose board by name

Instead of hard‑coding `--board=ID`, you can let the agent match by board name:

```bash
npm run post-pins -- --board-hint="Kitchen" --dir=./assets/to-post
```

This searches your boards for one whose **name or description contains** “Kitchen”
and uses the first match.

You can also let the directory name act as the hint:

```bash
mkdir -p assets/to-post/Modern
# put images into assets/to-post/Modern
npm run post-pins -- --dir=./assets/to-post/Modern
```

The folder name `Modern` is used as the board hint.

### 4.2 Choose board by image content (AI – `--auto-board`)

If you want the agent to pick a board based on the image content:

```bash
OPENAI_API_KEY=sk-...   # in .env

npm run post-pins -- --auto-board --dir=./assets/to-post
```

For each image, the agent:

1. Calls OpenAI Vision (`gpt-4o-mini`) with the image
2. Gets a category word (`travel`, `food`, `kitchen`, …)
3. Matches that category against your board names/descriptions
4. Posts the Pin to the first matching board (or a fallback board)

This costs one OpenAI API call **per image**.

---

## 5. AI‑generated copy (titles, descriptions, tags, alt)

When you pass `--auto-board` or `--ai-fields`, the agent uses OpenAI to generate:

- **Title** – in the format  
  **[Style] + [Layout] + [Function] + [Use]**  
  e.g. `Modern Minimalist Wall Mounted Cabinet with Soft-Close Doors for Kitchen Storage`
- **Description** – must include the brand name **“The Cabination”** and use
  long‑tail keywords where natural
- **Tags** – 4–8 long‑tail or specific keywords
- **Alt text** – accessibility description that also uses relevant long‑tail keywords

### 5.1 Use AI only for copy (board fixed)

```bash
npm run post-pins -- --board=BOARD_ID --ai-fields --dir=./assets/to-post
```

Board is fixed; AI generates title/description/tags/alt for each image.

### 5.2 Long‑tail keyword list (optional, for SEO)

You can give the model a list of preferred long‑tail keywords:

- Create `keywords.txt` in the project root (see `keywords.txt.example`), one keyword per line,
  lines starting with `#` are comments.
- Or set in `.env`:

  ```bash
  PIN_KEYWORDS=small space storage,apartment organization,modern kitchen cabinet
  ```

When present, the model will **prefer** to use these phrases naturally in title,
description, and alt text.

---

## 6. Boards with sections (sub‑boards)

Your board (e.g. **“Modern Kitchen Cabinets”**) can have multiple sections such as:

- Modern Oak Kitchen Ideas  
- Modern Gray Kitchen Cabinet Ideas  
- Kitchen Decor Ideas – White  
- Navy Blue Kitchen Cabinets  

### 6.1 List sections for a board

```bash
npm run sections -- --board=BoardID
```

This calls `GET /boards/{board_id}/sections` and prints each section’s ID and name.

### 6.2 Post Pins into a specific section

**By section name:**

```bash
# send to “Navy Blue Kitchen Cabinets”
npm run post-pins -- --board=BoardID --section-hint="Navy Blue" --ai-fields
```

**By section ID:**

```bash
npm run post-pins -- --board=BoardID --section=SectionID --ai-fields
```

If `--section` / `--section-hint` is omitted, Pins go to the board root.

---

## 7. Human‑in‑the‑loop review (recommended)

Pinterest’s policies prefer that users **actively review Pins** before publishing.
You can use a 2‑step flow:

1. **Generate preview only (no publishing)**:

   ```bash
   npm run post-pins -- --board=BOARD_ID --ai-fields --preview --dir=./assets/to-post
   ```

   This creates a `pin-preview.json` with all images and AI‑generated copy, but does
   **not** call the Pinterest API.

2. **Edit the preview file**:

   - Change `title`, `description`, `alt`, or `tags`
   - Set `"skip": true` on items you do not want to publish

3. **Publish from the preview**:

   ```bash
   npm run post-pins -- --from-preview
   # or specify a custom file:
   # npm run post-pins -- --from-preview=my-preview.json
   ```

Only non‑skipped items will be posted.

---

## 8. Scheduling Pins

You can run the agent on a schedule using **node-cron**.

### 8.1 Configure schedule in `.env`

```bash
PIN_BOARD_ID=BoardID                  # board to post to
PIN_SCHEDULE_CRON=0 9 * * *          # default: every day at 09:00 (min hour day month weekday)
PIN_SCHEDULE_AI_FIELDS=true          # use AI-generated copy
# PIN_SCHEDULE_RUN_NOW=true          # optional: run once immediately at startup (for testing)
```

Common cron examples:

- `0 9 * * *` – every day at 09:00
- `0 9,15 * * *` – every day at 09:00 and 15:00
- `30 8 * * 1-5` – weekdays at 08:30

### 8.2 Start the scheduler

```bash
npm install         # if not already
npm run schedule
```

This starts `src/agent/schedule.ts`, which:

- Reads the cron expression and board ID from `.env`
- At each scheduled time, runs:

  ```bash
  npm run post-pins -- --board=$PIN_BOARD_ID [--ai-fields]
  ```

You can keep this running in a terminal, or daemonize it:

```bash
nohup npm run schedule > schedule.log 2>&1 &
```

### 8.3 System crontab (alternative)

If you prefer OS‑level cron instead of `npm run schedule`:

```bash
crontab -e
# Add a line (change the path to your project):
# 0 9 * * * cd /path/to/Pinterest-agent && npm run post-pins -- --board=BoardID --ai-fields
```

### 8.4 Scheduling with GitHub Actions (production-style, free)

You can run scheduled Pin posting **without a server** using GitHub Actions. The workflow runs on GitHub’s runners and uses **Secrets** for credentials.

1. **Add repository Secrets** (Settings → Secrets and variables → Actions):

   | Secret name | Description |
   |-------------|-------------|
   | `PINTEREST_CLIENT_ID` | Same as in `.env` |
   | `PINTEREST_CLIENT_SECRET` | Same as in `.env` |
   | `PINTEREST_REDIRECT_URI` | e.g. `http://localhost:3000/pinterest/callback` (can be dummy in CI) |
   | `PINTEREST_USE_SANDBOX` | `true` or leave empty for production |
   | `OPENAI_API_KEY` | Your OpenAI API key |
   | `PIN_BOARD_ID` | Board ID to post to |
   | `PINTEREST_TOKENS_JSON` | **Full contents** of your local `tokens.json` (copy-paste the whole JSON) |

2. **Images for the scheduled run**: put images in the `schedule-images/` folder and **commit** them. The workflow uses `--dir=./schedule-images`. Supported: `.jpg`, `.jpeg`, `.png`. (The workflow does not move files in CI; add or rotate images as needed.)

3. **Schedule**: the workflow runs **daily at 09:00 UTC** by default. You can change the cron in `.github/workflows/schedule-pins.yml` (e.g. `0 1 * * *` for 09:00 CST). You can also trigger a run manually: Actions → “Schedule Pinterest Pins” → “Run workflow”.

4. **First run**: ensure you have at least one image in `schedule-images/` and that `PINTEREST_TOKENS_JSON` is the exact JSON from your working `tokens.json` (from the OAuth flow). If the token expires, re-run OAuth locally and update the secret.

---

## 9. Commands reference

| Command | Description |
|--------|-------------|
| `npm install` | Install project dependencies |
| `npm run dev` | Start the Express server for OAuth (`/pinterest/login`) |
| `npm run boards` | List boards and their `board_id` |
| `npm run sections -- --board=ID` | List sections for a board (use with `--section` / `--section-hint`) |
| `npm run post-pins -- --board=ID [--dir=...]` | Post local images to a specific board |
| `npm run post-pins -- --board-hint=keyword` | Auto‑select board by name/description |
| `npm run post-pins -- --auto-board` | Select board based on image content (OpenAI Vision) |
| `npm run post-pins -- --board=ID --ai-fields` | Fixed board, AI‑generated title/description/tags/alt |
| `npm run post-pins -- --preview` / `--from-preview` | Two‑step human review flow |
| `npm run schedule` | Run scheduled posting based on `PIN_SCHEDULE_CRON` |

With the pieces above you can go from **raw local images** to **SEO‑optimized Pinterest Pins**
on the right boards and sections, manually, in bulk, or on a schedule.

