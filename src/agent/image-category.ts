/**
 * 用 OpenAI Vision 根据图片内容生成：发到哪个画板(category)、标题、描述、标签、alt
 * 需在 .env 中配置 OPENAI_API_KEY
 * 可选：长尾关键词清单 keywords.txt 或 .env PIN_KEYWORDS，用于 SEO
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

/** 一张图对应的一条 Pin 的完整元数据（由 AI 生成） */
export interface PinMeta {
  /** 英文类别词，用于匹配画板名，如 travel, food, fashion */
  category: string;
  /** Pin 标题，建议 100 字以内 */
  title: string;
  /** Pin 描述，建议 500 字以内，可含 hashtag */
  description: string;
  /** 标签关键词，发 Pin 时会转成 #tag 拼进 description */
  tags: string[];
  /** 无障碍描述，建议 500 字以内 */
  alt: string;
}

/** 调用 getPinMeta 时的可选配置 */
export interface GetPinMetaOptions {
  /** 长尾关键词清单：AI 会优先在 title/description/alt 中自然融入这些词（用于 SEO） */
  keywordList?: string[];
}

/**
 * 分析图片内容，返回发到哪个画板 + 标题、描述、标签、alt（一条 OpenAI 调用）
 * 标题格式：[风格] + [布局] + [功能] + [用途]；描述必须含品牌 The Cabination；尽量用长尾关键词
 */
export async function getPinMeta(
  imagePath: string,
  options: GetPinMetaOptions = {}
): Promise<PinMeta> {
  if (!OPENAI_API_KEY) {
    throw new Error(
      '未配置 OPENAI_API_KEY。请在 .env 中添加 OPENAI_API_KEY'
    );
  }

  const buf = await readFile(imagePath);
  const base64 = buf.toString('base64');
  const dataUrl = getDataUrl(imagePath, base64);

  const keywordHint =
    (options.keywordList?.length ?? 0) > 0
      ? `\nLong-tail keyword list to incorporate where relevant (use naturally in title, description, and alt): ${(options.keywordList ?? []).join(', ')}`
      : '';

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
1. Title MUST follow this format: [风格 Style] + [布局 Layout] + [功能 Function] + [用途 Use]. Example: "Modern Minimalist Wall Mounted Cabinet with Soft-Close Doors for Kitchen Storage". Use long-tail phrases, under 100 chars.
2. Description MUST mention the brand "${BRAND}" and describe the image. Use long-tail keywords naturally (e.g. "small space storage solutions", "best cabinet for narrow hallway"). Under 500 chars. Can include hashtags at the end.
3. Alt: accessibility description, also use long-tail keywords where natural. Under 400 chars.
4. Tags: 4-8 long-tail or specific keywords, no # in strings (e.g. "compact storage cabinet", "apartment organization").
5. Prefer English for SEO. Use long-tail keywords in title, description, and alt whenever they fit the image.${keywordHint}`;

  const body = {
    model: 'gpt-4o-mini',
    max_tokens: 400,
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
        throw new Error(`OpenAI 返回的不是合法 JSON: ${raw.slice(0, 200)}`);
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

  throw new Error(`OpenAI API 错误: ${lastRes?.status ?? 'unknown'} ${lastErr}`);
}

/**
 * 仅返回类别词（用于只做画板匹配、不生成标题描述时；内部仍调 getPinMeta 取 category）
 */
export async function getImageCategory(imagePath: string): Promise<string> {
  const meta = await getPinMeta(imagePath);
  return meta.category;
}
