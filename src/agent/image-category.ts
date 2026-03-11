/**
 * Use OpenAI Vision to generate: category (board), title, description, tags, alt from image.
 * Set OPENAI_API_KEY in .env. Optional: keywords.txt or PIN_KEYWORDS in .env for SEO.
 */
import { readFile } from 'fs/promises';
import path from 'path';

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

const BRAND = 'The Cabination';

function getDataUrl(filePath: string, base64: string): string {
  const ext = path.extname(filePath).toLowerCase();
  const mime = ext === '.png' ? 'image/png' : 'image/jpeg';
  return `data:${mime};base64,${base64}`;
}

/** Pin metadata for one image (AI-generated) */
export interface PinMeta {
  /** English category word for board matching, e.g. travel, food, fashion */
  category: string;
  /** Pin title, under 100 chars */
  title: string;
  /** Pin description, under 500 chars, may include hashtags */
  description: string;
  /** Tags; appended as #tag in description */
  tags: string[];
  /** Alt text, under 500 chars */
  alt: string;
}

/** Writing angles for variety; one chosen per image (random or passed) */
export const PIN_ANGLES = [
  'lifestyle & mood',
  'features & specs',
  'problem-solution',
  'scene & setting',
  'before-after or transformation',
  'tips & how-to',
] as const;

export interface GetPinMetaOptions {
  /** Long-tail keywords to weave into title/description/alt (SEO) */
  keywordList?: string[];
  /** Angle for this image; if omitted, one is chosen at random */
  angle?: (typeof PIN_ANGLES)[number];
}

/**
 * Analyze image and return category + title, description, tags, alt (one OpenAI call).
 * Title varies by angle; description must mention brand and use long-tail keywords.
 */
export async function getPinMeta(
  imagePath: string,
  options: GetPinMetaOptions = {}
): Promise<PinMeta> {
  if (!OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY not set; add it to .env');
  }

  const buf = await readFile(imagePath);
  const base64 = buf.toString('base64');
  const dataUrl = getDataUrl(imagePath, base64);

  const keywordHint =
    (options.keywordList?.length ?? 0) > 0
      ? `\nLong-tail keyword list to incorporate where relevant (use naturally in title, description, and alt): ${(options.keywordList ?? []).join(', ')}`
      : '';

  const angle =
    options.angle ??
    PIN_ANGLES[Math.floor(Math.random() * PIN_ANGLES.length)];

  const prompt = `You are creating a Pinterest pin for this image. Brand: ${BRAND}.

Reply with a JSON object only, no other text. Use this exact structure:
{
  "category": "one English word for board matching, e.g. travel, food, fashion, nature, home, furniture, storage",
  "title": "string",
  "description": "string",
  "tags": ["keyword1", "keyword2", ...],
  "alt": "string"
}

Rules:
1. Title: VARY your approach. This pin's angle is "${angle}". So write the title in a way that fits that angle—e.g. for "lifestyle & mood" use feeling/atmosphere; for "problem-solution" lead with a problem or benefit; for "tips & how-to" use a how-to or tip; for "features & specs" use [Style]+[Layout]+[Function]+[Use]. Keep under 100 chars, use long-tail phrases, and make it distinct from a generic product title.
2. Description MUST mention the brand "${BRAND}" and describe the image. Vary sentence structure and opening (sometimes start with a question, sometimes a benefit, sometimes the scene). Use long-tail keywords naturally. Under 500 chars. Can include hashtags at the end.
3. Alt: accessibility description, use long-tail keywords where natural. Under 400 chars.
4. Tags: 4-8 long-tail or specific keywords, no # in strings. Vary tags (mix product, scene, and lifestyle terms) so not every pin has the same tag set.
5. Prefer English for SEO. Use long-tail keywords in title, description, and alt whenever they fit the image.${keywordHint}`;

  const body = {
    model: 'gpt-4o-mini',
    max_tokens: 400,
    temperature: 0.85,
    response_format: { type: 'json_object' as const },
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text' as const, text: prompt },
          { type: 'image_url' as const, image_url: { url: dataUrl } },
        ],
      },
    ],
  };

  const maxAttempts = 3;
  let lastRes: Response | null = null;
  let lastErr: string = '';

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify(body),
    });
    lastRes = res;

    if (res.ok) {
      const data = (await res.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      const raw = data.choices?.[0]?.message?.content?.trim() ?? '{}';
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        throw new Error(`OpenAI response is not valid JSON: ${raw.slice(0, 200)}`);
      }

      const o = parsed as Record<string, unknown>;
      const category = typeof o.category === 'string' ? o.category : 'general';
      const title = typeof o.title === 'string' ? o.title : 'Pin';
      const description = typeof o.description === 'string' ? o.description : '';
      const tags = Array.isArray(o.tags)
        ? (o.tags as unknown[]).filter((t): t is string => typeof t === 'string').slice(0, 8)
        : [];
      const alt = typeof o.alt === 'string' ? o.alt : description || 'Image';

      return { category, title, description, tags, alt };
    }

    lastErr = await res.text();
    if (res.status >= 500 && attempt < maxAttempts) {
      await new Promise((r) => setTimeout(r, 2000 * attempt));
      continue;
    }
    break;
  }

  throw new Error(`OpenAI API error: ${lastRes?.status ?? 'unknown'} ${lastErr}`);
}

/**
 * Return only category (for board matching without full copy; still calls getPinMeta for category).
 */
export async function getImageCategory(imagePath: string): Promise<string> {
  const meta = await getPinMeta(imagePath);
  return meta.category;
}
