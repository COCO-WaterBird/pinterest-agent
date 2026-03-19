/**
 * Entry script for posting Pinterest Pins.
 *
 * Usage:
 *   1. List boards: npm run boards
 *   2. Post Pins:  npm run post-pins -- --board=BOARD_ID --dir=./images
 *   3. Preview then publish: --preview → edit file → --from-preview
 *
 * Requires OAuth first (visit /pinterest/login); tokens.json in project root.
 */
import { readFile, readdir, writeFile, rename, mkdir } from 'fs/promises';
import path from 'path';
import { getAccessToken } from '../config';
import {
  createPinterestClient,
  getBoards,
  getBoardSections,
  createPin,
  findBoardIdByHint,
  findSectionIdByHint,
  type PinMedia,
} from '../pinterest';
import { getPinMeta } from './image-category';

const IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png']);
const ASSETS_DIR = path.join(process.cwd(), 'assets');
const DEFAULT_IMAGE_DIR = path.join(ASSETS_DIR, 'to-post');
const ASSETS_POSTED = path.join(ASSETS_DIR, 'posted');
const ASSETS_FAILED = path.join(ASSETS_DIR, 'failed');
const DEFAULT_PREVIEW_FILE = path.join(process.cwd(), 'pin-preview.json');

/** One item in preview file; edit copy or set skip: true to skip publishing */
export interface PinPreviewItem {
  imagePath: string;
  boardId: string;
  /** Optional: section ID under the board */
  boardSectionId?: string;
  title: string;
  description: string;
  alt: string;
  tags: string[];
  /** Optional: website/pin link shown as "Website" on Pinterest */
  link?: string;
  skip?: boolean;
}

/** Pinterest field length limits */
const MAX_TITLE = 100;
const MAX_DESCRIPTION = 800;
const MAX_ALT = 400;

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1).trim();
}

/** Append AI tags as hashtags to description */
function descriptionWithHashtags(description: string, tags: string[]): string {
  const clean = description.trim();
  const hashPart = tags
    .filter((t) => t.length > 0)
    .map((t) => '#' + t.replace(/\s+/g, ''))
    .join(' ');
  if (!hashPart) return clean;
  return clean ? `${clean} ${hashPart}` : hashPart;
}

function isImageFile(filename: string): boolean {
  return IMAGE_EXT.has(path.extname(filename).toLowerCase());
}

function isAxiosError(e: unknown): e is { response?: { status?: number; data?: unknown } } {
  return typeof e === 'object' && e !== null && 'response' in e;
}

/** Extract readable message from error (including Pinterest API message) */
function getErrorMessage(err: unknown): string {
  if (isAxiosError(err) && err.response?.data) {
    const d = err.response.data as Record<string, unknown>;
    const msg = d.message ?? d.error_description ?? d.error;
    if (msg) return `HTTP ${err.response.status}: ${typeof msg === 'string' ? msg : JSON.stringify(msg)}`;
  }
  return err instanceof Error ? err.message : String(err);
}

/** Read local image as base64 and set content_type */
async function imagePathToMedia(filePath: string): Promise<PinMedia> {
  const ext = path.extname(filePath).toLowerCase();
  const contentType =
    ext === '.png' ? ('image/png' as const) : ('image/jpeg' as const);
  const data = await readFile(filePath, { encoding: 'base64' });
  return { source_type: 'image_base64', content_type: contentType, data };
}

/** Target dir: assets/posted|failed if from assets/to-post, else <image-dir>/posted|failed */
function getMoveTargetDir(srcPath: string, kind: 'posted' | 'failed'): string {
  const imageDir = path.dirname(srcPath);
  const isDefaultToPost = path.normalize(imageDir) === path.normalize(DEFAULT_IMAGE_DIR);
  if (isDefaultToPost) return kind === 'posted' ? ASSETS_POSTED : ASSETS_FAILED;
  return path.join(imageDir, kind);
}

/** Move file to posted or failed dir; create dir if needed */
async function moveToAssets(srcPath: string, kind: 'posted' | 'failed'): Promise<string> {
  const dir = getMoveTargetDir(srcPath, kind);
  await mkdir(dir, { recursive: true });
  const dest = path.join(dir, path.basename(srcPath));
  await rename(srcPath, dest);
  return dest;
}

/** Load keyword list: keywords.txt (one per line) or .env PIN_KEYWORDS (comma-separated) */
async function loadKeywordList(): Promise<string[]> {
  const fromEnv = process.env.PIN_KEYWORDS?.trim();
  if (fromEnv) {
    return fromEnv.split(',').map((s) => s.trim()).filter(Boolean);
  }
  const keywordsPath = path.join(process.cwd(), 'keywords.txt');
  try {
    const raw = await readFile(keywordsPath, 'utf-8');
    return raw
      .split(/\n/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0 && !s.startsWith('#'));
  } catch {
    return [];
  }
}

async function main() {
  const args = process.argv.slice(2);
  const command = args[0] ?? '';

  const accessToken = await getAccessToken();
  const client = createPinterestClient(accessToken);

  if (command === 'boards') {
    console.log('Fetching your boards...\n');
    const res = await getBoards(client);
    if (!res.items?.length) {
      console.log('No boards found. Create at least one board on pinterest.com first.');
      return;
    }
    console.log('Boards (use --board=ID when posting):');
    console.log('----------------------------------------');
    for (const b of res.items) {
      console.log(`  ${b.id}  ${b.name}`);
    }
    console.log('----------------------------------------');
    return;
  }

  if (command === 'sections') {
    const boardIdArg = args.find((a) => a.startsWith('--board='))?.slice(8);
    if (!boardIdArg) {
      console.error('Specify board ID, e.g. npm run post-pins -- sections --board=1119144644842396615');
      process.exit(1);
    }
    console.log(`Fetching sections for board ${boardIdArg}...\n`);
    const res = await getBoardSections(client, boardIdArg, 100);
    const list = res.items ?? [];
    if (!list.length) {
      console.log('No sections for this board, or API returned none.');
      return;
    }
    console.log('Sections (use --section=ID or --section-hint=name when posting):');
    console.log('----------------------------------------');
    for (const s of list) {
      console.log(`  ${s.id}  ${s.name}`);
    }
    console.log('----------------------------------------');
    return;
  }

  if (command === 'post') {
    const fromPreviewArg = args.find((a) => a.startsWith('--from-preview'))?.split('=')[1];
    const fromPreview = args.includes('--from-preview') || fromPreviewArg !== undefined;
    const previewFilePath = fromPreviewArg ?? DEFAULT_PREVIEW_FILE;

    if (fromPreview) {
      try {
        const raw = await readFile(previewFilePath, 'utf-8');
        const items = JSON.parse(raw) as PinPreviewItem[];
        if (!Array.isArray(items) || items.length === 0) {
          console.error('Preview file empty or invalid; must be a JSON array.');
          process.exit(1);
        }
        const toPublish = items.filter((item) => !item.skip);
        console.log(`Read ${items.length} items from ${previewFilePath}, ${toPublish.length} to publish.\n`);
        for (const [i, item] of toPublish.entries()) {
          const absPath = path.resolve(process.cwd(), item.imagePath);
          try {
            const media = await imagePathToMedia(absPath);
            const pin = await createPin(client, {
              board_id: item.boardId,
              ...(item.boardSectionId ? { board_section_id: item.boardSectionId } : {}),
              title: truncate(item.title, MAX_TITLE),
              description: truncate(item.description, MAX_DESCRIPTION),
              ...(item.alt ? { alt_text: truncate(item.alt, MAX_ALT) } : {}),
              link: item.link ?? process.env.PIN_WEBSITE_LINK ?? '',
              media,
            });
            const postedDest = await moveToAssets(absPath, 'posted');
            console.log(`[${i + 1}/${toPublish.length}] Published: ${pin.id}  → ${path.relative(process.cwd(), postedDest)}`);
          } catch (err: unknown) {
            console.error(`[${i + 1}/${toPublish.length}] Failed ${item.imagePath}: ${getErrorMessage(err)}`);
            try {
              const failedDest = await moveToAssets(absPath, 'failed');
              console.log(`  Moved to ${path.relative(process.cwd(), failedDest)}`);
            } catch {
              // ignore move failure
            }
          }
        }
        console.log('\nDone.');
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error(`Failed to read preview file: ${msg}`);
        process.exit(1);
      }
      return;
    }

    const boardIdArg = args.find((a) => a.startsWith('--board='))?.slice(8);
    const boardHintArg = args.find((a) => a.startsWith('--board-hint='))?.slice(13);
    const sectionArg = args.find((a) => a.startsWith('--section='))?.slice(10);
    const sectionHintArg = args.find((a) => a.startsWith('--section-hint='))?.slice(15);
    const autoBoard = args.includes('--auto-board');
    const aiFields = args.includes('--ai-fields');
    const previewMode = args.includes('--preview');
    const dirArg = args.find((a) => a.startsWith('--dir='))?.slice(6);
    const fileArg = args.find((a) => a.startsWith('--image='))?.slice(8);
    const maxArg = args.find((a) => a.startsWith('--max='))?.slice(6);
    const titleArg = args.find((a) => a.startsWith('--title='))?.slice(8);
    const descArg = args.find((a) => a.startsWith('--description='))?.slice(14);
    const previewOutArg = args.find((a) => a.startsWith('--preview-out='))?.slice(14);

    let imagePaths: string[] = [];

    if (fileArg) {
      const resolved = path.resolve(process.cwd(), fileArg);
      imagePaths = [resolved];
    } else {
      const dir = dirArg ? path.resolve(process.cwd(), dirArg) : DEFAULT_IMAGE_DIR;
      const entries = await readdir(dir, { withFileTypes: true });
      imagePaths = entries
        .filter((e) => e.isFile() && isImageFile(e.name))
        .map((e) => path.join(dir, e.name));
    }
    const maxCount = maxArg ? Math.max(1, parseInt(maxArg, 10) || 1) : undefined;
    if (maxCount !== undefined) imagePaths = imagePaths.slice(0, maxCount);

    if (imagePaths.length === 0) {
      console.error('No images found. Put .jpg/.jpeg/.png in assets/to-post or use --dir=path / --image=path');
      process.exit(1);
    }

    let resolvedBoardId: string | null = boardIdArg ?? null;

    if (!resolvedBoardId && !autoBoard) {
      const hint = boardHintArg ?? (dirArg ? path.basename(path.resolve(process.cwd(), dirArg)) : null);
      if (hint) {
        resolvedBoardId = await findBoardIdByHint(client, hint);
        if (resolvedBoardId) console.log(`Matched board ID for "${hint}": ${resolvedBoardId}\n`);
      }
    }

    if (!resolvedBoardId && !autoBoard) {
      console.error('Specify board: --board=ID or --board-hint=keyword');
      console.error('Or put images in a folder named after the board (e.g. images/travel)');
      console.error('Or use --auto-board to pick board by image content (requires OPENAI_API_KEY)');
      process.exit(1);
    }

    let resolvedSectionId: string | null = sectionArg ?? null;
    if (!resolvedSectionId && sectionHintArg && resolvedBoardId) {
      resolvedSectionId = await findSectionIdByHint(client, resolvedBoardId, sectionHintArg);
      if (resolvedSectionId) console.log(`Matched section for "${sectionHintArg}": ${resolvedSectionId}\n`);
    }

    if (previewMode && !autoBoard && !aiFields) {
      console.error('--preview must be used with --auto-board or --ai-fields to generate copy.');
      process.exit(1);
    }

    const defaultTitle = titleArg ?? 'My Pin';
    const defaultDesc = descArg ?? '';
    const useAiForFields = autoBoard || aiFields;

    const keywordList = useAiForFields ? await loadKeywordList() : [];
    if (useAiForFields && keywordList.length > 0) {
      console.log(`Loaded ${keywordList.length} long-tail keywords for title/description/alt.\n`);
    }

    const boardsRes = autoBoard ? await getBoards(client, 100) : null;
    const fallbackBoardId = boardsRes?.items?.[0]?.id ?? null;

    const previewItems: PinPreviewItem[] = [];
    const outPath = previewOutArg ? path.resolve(process.cwd(), previewOutArg) : DEFAULT_PREVIEW_FILE;

    console.log(
      previewMode
        ? `--preview on: generating preview file (no publish). ${imagePaths.length} image(s).\n`
        : autoBoard
          ? `--auto-board on: OpenAI picks board and generates title/description/tags/alt. ${imagePaths.length} image(s).\n`
          : useAiForFields
            ? `--ai-fields on: OpenAI generates title/description/tags/alt per Pin. ${imagePaths.length} image(s).\n`
            : `Posting ${imagePaths.length} image(s) to board ${resolvedBoardId}.\n`
    );

    let currentTags: string[] = [];

    for (const [i, filePath] of imagePaths.entries()) {
      const name = path.basename(filePath, path.extname(filePath));
      currentTags = [];

      let boardId: string;
      let title: string;
      let description: string;
      let altText: string | undefined;

      if (useAiForFields) {
        let meta: Awaited<ReturnType<typeof getPinMeta>>;
        try {
          meta = await getPinMeta(filePath, { keywordList });
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error(`[${i + 1}/${imagePaths.length}] OpenAI analysis failed, skipping ${name}: ${msg}`);
          continue;
        }
        title = truncate(meta.title, MAX_TITLE);
        description = truncate(descriptionWithHashtags(meta.description, meta.tags), MAX_DESCRIPTION);
        altText = truncate(meta.alt, MAX_ALT) || undefined;
        currentTags = meta.tags;

        if (autoBoard) {
          const found = await findBoardIdByHint(client, meta.category);
          boardId = found ?? fallbackBoardId ?? '';
          if (!boardId) {
            console.error(`[${i + 1}/${imagePaths.length}] No matching board and account has no boards, skipping: ${name}`);
            console.error('  Run npm run boards to list boards; create at least one on pinterest.com if empty.');
            continue;
          }
          if (!found) console.log(`[${i + 1}] Category: ${meta.category} → using default board`);
        } else {
          boardId = resolvedBoardId as string;
        }
      } else {
        boardId = resolvedBoardId as string;
        title = imagePaths.length > 1 ? `${defaultTitle} - ${name}` : defaultTitle;
        description = defaultDesc;
      }

      if (previewMode) {
        previewItems.push({
          imagePath: path.relative(process.cwd(), filePath),
          boardId,
          ...(resolvedSectionId ? { boardSectionId: resolvedSectionId } : {}),
          title,
          description,
          alt: altText ?? '',
          tags: currentTags,
          link: '',
        });
        console.log(`[${i + 1}/${imagePaths.length}] Preview generated: ${name}`);
        continue;
      }

      try {
        const media = await imagePathToMedia(filePath);
        const pin = await createPin(client, {
          board_id: boardId,
          ...(resolvedSectionId ? { board_section_id: resolvedSectionId } : {}),
          title,
          description,
          ...(altText ? { alt_text: altText } : {}),
          link: process.env.PIN_WEBSITE_LINK ?? '',
          media,
        });
        const postedDest = await moveToAssets(filePath, 'posted');
        console.log(`[${i + 1}/${imagePaths.length}] Published: ${pin.id}  → ${path.relative(process.cwd(), postedDest)}`);
      } catch (err: unknown) {
        console.error(`[${i + 1}/${imagePaths.length}] Failed ${filePath}: ${getErrorMessage(err)}`);
        try {
          const failedDest = await moveToAssets(filePath, 'failed');
          console.log(`  Moved to ${path.relative(process.cwd(), failedDest)}`);
        } catch {
          // ignore move failure
        }
      }
    }

    if (previewMode) {
      await writeFile(outPath, JSON.stringify(previewItems, null, 2), 'utf-8');
      console.log(`\nPreview written to ${outPath}`);
      console.log('Edit the file (change copy or add "skip": true), then run:');
      console.log('  npm run post-pins -- --from-preview');
      console.log('  or: npm run post-pins -- --from-preview=your-preview.json');
      return;
    }

    console.log('\nDone.');
    return;
  }

  console.log(`
Usage:
  boards                     List boards, get board_id
  sections --board=ID        List sections for board; use --section=ID or --section-hint=name when posting
                            e.g. npm run sections -- --board=1119144644842396615
  post                       Post Pins (specify board as below)

  Board (pick one):
    --board=ID               Board ID
    --board-hint=keyword     Match board by name (e.g. travel, food). Or put images in folder named after board (e.g. images/travel)
    --auto-board             OpenAI picks board and generates title/description/tags/alt (requires OPENAI_API_KEY)

  Section (optional):
    --section=ID             Post to this section (run sections --board=ID to see IDs)
    --section-hint=name      Match section by name (e.g. "Modern Gray", "Navy Blue")

  AI copy (requires OPENAI_API_KEY):
    --auto-board             Pick board + generate title, description, tags, alt
    --ai-fields              Board from --board/--board-hint; AI generates title, description, tags, alt only

  Human review (Pinterest-friendly):
    --preview                Generate preview file only (use with --auto-board or --ai-fields)
    --preview-out=path       Preview file path, default pin-preview.json
    --from-preview           Publish from preview (edit copy or add "skip": true)
    --from-preview=path      Custom preview file

  Long-tail keywords (optional, SEO):
    keywords.txt in project root, one per line (# = comment), or .env PIN_KEYWORDS=word1,word2,word3

  Options:
    --dir=path               Image directory, default assets/to-post
    --image=path             Single image
    --max=N                  Max images this run (e.g. --max=1 for cron)
    --title=text             Default title when not using AI
    --description=text       Default description when not using AI

Examples:
  npm run boards
  npm run sections -- --board=1119144644842396615
  npm run post-pins -- --board=ID --section-hint="Navy Blue" --ai-fields
  npm run post-pins -- --board-hint=travel --dir=./images
  npm run post-pins -- --auto-board --dir=./photos
  npm run post-pins -- --board=ID --ai-fields --dir=./images
  npm run post-pins -- --auto-board --preview --dir=./images
  npm run post-pins -- --from-preview
`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
