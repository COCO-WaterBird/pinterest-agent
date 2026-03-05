/**
 * 自动化发 Pinterest Pin 的入口脚本
 *
 * 用法：
 *   1. 列出画板：npm run boards
 *   2. 发 Pin：  npm run post-pins -- --board=BOARD_ID --dir=./images
 *   3. 预览后发布（人工参与）：--preview 生成预览文件 → 编辑 → --from-preview 发布
 *
 * 环境：需先完成 OAuth（访问 /pinterest/login），保证项目根目录有 tokens.json
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

/** 预览文件中的一条：人工可编辑文案，或设 skip: true 不发布该项 */
export interface PinPreviewItem {
  imagePath: string;
  boardId: string;
  /** 可选：发到该画板下的 section（分区）ID */
  boardSectionId?: string;
  title: string;
  description: string;
  alt: string;
  tags: string[];
  skip?: boolean;
}

/** Pinterest 字段长度限制 */
const MAX_TITLE = 100;
const MAX_DESCRIPTION = 800;
const MAX_ALT = 400;

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1).trim();
}

/** 把 AI 返回的 tags 转成 description 末尾的 hashtag 串 */
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

/** 从错误中取出可读信息（含 Pinterest API 返回的 message） */
function getErrorMessage(err: unknown): string {
  if (isAxiosError(err) && err.response?.data) {
    const d = err.response.data as Record<string, unknown>;
    const msg = d.message ?? d.error_description ?? d.error;
    if (msg) return `HTTP ${err.response.status}: ${typeof msg === 'string' ? msg : JSON.stringify(msg)}`;
  }
  return err instanceof Error ? err.message : String(err);
}

/** 把本地图片读成 base64，并判断 content_type */
async function imagePathToMedia(filePath: string): Promise<PinMedia> {
  const ext = path.extname(filePath).toLowerCase();
  const contentType =
    ext === '.png' ? ('image/png' as const) : ('image/jpeg' as const);
  const data = await readFile(filePath, { encoding: 'base64' });
  return { source_type: 'image_base64', content_type: contentType, data };
}

/** 发成功后移到 assets/posted，失败移到 assets/failed；目标目录不存在会先创建 */
async function moveToAssets(srcPath: string, kind: 'posted' | 'failed'): Promise<void> {
  const dir = kind === 'posted' ? ASSETS_POSTED : ASSETS_FAILED;
  await mkdir(dir, { recursive: true });
  const dest = path.join(dir, path.basename(srcPath));
  await rename(srcPath, dest);
}

/** 加载长尾关键词清单：优先 keywords.txt（每行一个），否则 .env 的 PIN_KEYWORDS（逗号分隔） */
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
    // 子命令：列出所有画板，方便用户复制 board_id
    console.log('正在获取你的画板列表...\n');
    const res = await getBoards(client);
    if (!res.items?.length) {
      console.log('当前没有画板，请先在 Pinterest 网页上创建至少一个画板。');
      return;
    }
    console.log('画板列表（发 Pin 时用 --board=ID）：');
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
      console.error('请指定画板 ID，例如: npm run post-pins -- sections --board=1119144644842396615');
      process.exit(1);
    }
    console.log(`正在获取画板 ${boardIdArg} 下的 sections...\n`);
    const res = await getBoardSections(client, boardIdArg, 100);
    const list = res.items ?? [];
    if (!list.length) {
      console.log('该画板下没有 section，或 API 未返回。');
      return;
    }
    console.log('Section 列表（发 Pin 时用 --section=ID 或 --section-hint=名称）：');
    console.log('----------------------------------------');
    for (const s of list) {
      console.log(`  ${s.id}  ${s.name}`);
    }
    console.log('----------------------------------------');
    return;
  }

  if (command === 'post') {
    // 子命令：从目录或单文件发 Pin（或从预览文件发布）
    const fromPreviewArg = args.find((a) => a.startsWith('--from-preview'))?.split('=')[1];
    const fromPreview = args.includes('--from-preview') || fromPreviewArg !== undefined;
    const previewFilePath = fromPreviewArg ?? DEFAULT_PREVIEW_FILE;

    if (fromPreview) {
      // 从预览文件发布：只读 JSON，不调 AI，逐条 createPin
      try {
        const raw = await readFile(previewFilePath, 'utf-8');
        const items = JSON.parse(raw) as PinPreviewItem[];
        if (!Array.isArray(items) || items.length === 0) {
          console.error('预览文件为空或格式错误，需为 JSON 数组。');
          process.exit(1);
        }
        const toPublish = items.filter((item) => !item.skip);
        console.log(`从 ${previewFilePath} 读取 ${items.length} 条，其中 ${toPublish.length} 条将发布。\n`);
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
              media,
            });
            await moveToAssets(absPath, 'posted');
            console.log(`[${i + 1}/${toPublish.length}] 已发布: ${pin.id}  → assets/posted`);
          } catch (err: unknown) {
            console.error(`[${i + 1}/${toPublish.length}] 失败 ${item.imagePath}: ${getErrorMessage(err)}`);
            try {
              await moveToAssets(absPath, 'failed');
              console.log(`  已移至 assets/failed`);
            } catch {
              // 移动失败不中断
            }
          }
        }
        console.log('\n完成。');
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error(`读取预览文件失败: ${msg}`);
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

    if (imagePaths.length === 0) {
      console.error('未找到图片。请把 .jpg/.jpeg/.png 放到 assets/to-post 或使用 --dir=目录 / --image=路径');
      process.exit(1);
    }

    // 解析要发到哪个画板：--board > --board-hint / 目录名 > --auto-board
    let resolvedBoardId: string | null = boardIdArg ?? null;

    if (!resolvedBoardId && !autoBoard) {
      const hint = boardHintArg ?? (dirArg ? path.basename(path.resolve(process.cwd(), dirArg)) : null);
      if (hint) {
        resolvedBoardId = await findBoardIdByHint(client, hint);
        if (resolvedBoardId) console.log(`根据关键词「${hint}」匹配到画板 ID: ${resolvedBoardId}\n`);
      }
    }

    if (!resolvedBoardId && !autoBoard) {
      console.error('请指定画板：--board=ID 或 --board-hint=画板名称关键词');
      console.error('也可把图片放在以画板名命名的目录下，如 images/旅行');
      console.error('或使用 --auto-board 根据图片内容自动选画板（需配置 OPENAI_API_KEY）');
      process.exit(1);
    }

    // 解析发到画板下的哪个 section（仅当未用 --auto-board 时有效）
    let resolvedSectionId: string | null = sectionArg ?? null;
    if (!resolvedSectionId && sectionHintArg && resolvedBoardId) {
      resolvedSectionId = await findSectionIdByHint(client, resolvedBoardId, sectionHintArg);
      if (resolvedSectionId) console.log(`根据 section 关键词「${sectionHintArg}」匹配到: ${resolvedSectionId}\n`);
    }

    if (previewMode && !autoBoard && !aiFields) {
      console.error('--preview 需与 --auto-board 或 --ai-fields 一起使用，才能生成可审核的文案。');
      process.exit(1);
    }

    const defaultTitle = titleArg ?? 'My Pin';
    const defaultDesc = descArg ?? '';
    const useAiForFields = autoBoard || aiFields;

    // 使用 AI 文案时加载长尾关键词清单（可选）
    const keywordList = useAiForFields ? await loadKeywordList() : [];
    if (useAiForFields && keywordList.length > 0) {
      console.log(`已加载 ${keywordList.length} 个长尾关键词，将融入标题/描述/alt。\n`);
    }

    // --auto-board 时没有默认画板，每张图单独匹配；否则用统一画板
    const boardsRes = autoBoard ? await getBoards(client, 100) : null;
    const fallbackBoardId = boardsRes?.items?.[0]?.id ?? null;

    const previewItems: PinPreviewItem[] = [];
    const outPath = previewOutArg ? path.resolve(process.cwd(), previewOutArg) : DEFAULT_PREVIEW_FILE;

    console.log(
      previewMode
        ? `已开启 --preview，将生成预览文件（不发布）。共 ${imagePaths.length} 张。\n`
        : autoBoard
          ? `已开启 --auto-board，将用 OpenAI 选画板并生成标题/描述/标签/alt。共 ${imagePaths.length} 张。\n`
          : useAiForFields
            ? `已开启 --ai-fields，将用 OpenAI 生成每张 Pin 的标题/描述/标签/alt。共 ${imagePaths.length} 张。\n`
            : `将向画板 ${resolvedBoardId} 发送 ${imagePaths.length} 张图片。\n`
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
          console.error(`[${i + 1}/${imagePaths.length}] OpenAI 分析失败，跳过 ${name}: ${msg}`);
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
            console.error(`[${i + 1}/${imagePaths.length}] 无法匹配画板且账号无画板，跳过: ${name}`);
            console.error('  请先运行 npm run boards 查看画板；若为空，请到 pinterest.com 创建至少一个画板后再试。');
            continue;
          }
          if (!found) console.log(`[${i + 1}] 类别: ${meta.category} → 使用默认画板`);
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
        });
        console.log(`[${i + 1}/${imagePaths.length}] 已生成预览: ${name}`);
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
          media,
        });
        await moveToAssets(filePath, 'posted');
        console.log(`[${i + 1}/${imagePaths.length}] 已发布: ${pin.id}  → assets/posted`);
      } catch (err: unknown) {
        console.error(`[${i + 1}/${imagePaths.length}] 失败 ${filePath}: ${getErrorMessage(err)}`);
        try {
          await moveToAssets(filePath, 'failed');
          console.log(`  已移至 assets/failed`);
        } catch {
          // 移动失败不中断
        }
      }
    }

    if (previewMode) {
      await writeFile(outPath, JSON.stringify(previewItems, null, 2), 'utf-8');
      console.log(`\n预览已写入: ${outPath}`);
      console.log('请编辑该文件：修改文案或对不需要发布的条目加上 "skip": true，然后执行：');
      console.log('  npm run post-pins -- --from-preview');
      console.log('  或指定文件：npm run post-pins -- --from-preview=你的预览文件.json');
      return;
    }

    console.log('\n完成。');
    return;
  }

  // 未识别的子命令，打印用法
  console.log(`
用法:
  boards                    列出画板，获取 board_id
  sections --board=ID       列出该画板下的 sections（分区），发 Pin 时可指定 --section=ID
                            示例: npm run sections -- --board=1119144644842396615
  post                      发 Pin（需指定画板方式见下）

  指定画板（三选一）:
    --board=ID               直接指定画板 ID
    --board-hint=关键词      按画板名称匹配（如 旅行、food）
    把图片放在 目录名=画板名 下，如 images/旅行 会自动匹配名称含「旅行」的画板
    --auto-board             用 OpenAI 根据图片选画板，并生成 title/description/tags/alt（需 OPENAI_API_KEY）

  指定 section（分区，可选）:
    --section=ID             发到该画板下的指定 section（先运行 sections --board=ID 查看 ID）
    --section-hint=名称      按 section 名称匹配（如 "Modern Gray"、"Navy Blue"）

  AI 生成文案（需 OPENAI_API_KEY）:
    --auto-board             选画板 + 生成标题、描述、标签、alt
    --ai-fields              画板仍用 --board/--board-hint，仅用 AI 生成标题、描述、标签、alt

  人工参与审核（符合 Pinterest 政策）:
    --preview                只生成预览文件，不发布（需与 --auto-board 或 --ai-fields 同用）
    --preview-out=文件路径   预览文件路径，默认 pin-preview.json
    --from-preview           按预览文件发布（可编辑文案、对条目加 "skip": true 不发布）
    --from-preview=文件路径  指定预览文件，默认 pin-preview.json

  长尾关键词（可选，用于 SEO）:
    项目根目录 keywords.txt   每行一个关键词，# 为注释
    或 .env 中 PIN_KEYWORDS=词1,词2,词3
    AI 会在标题/描述/alt 中自然融入这些词

  可选:
    --dir=目录路径           图片目录，默认 ./images
    --image=单张图片路径     只发这一张
    --title=标题            非 AI 时的默认标题
    --description=描述      非 AI 时的默认描述

示例:
  npm run boards
  npm run sections -- --board=1119144644842396615
  npm run post-pins -- --board=1119144644842396615 --section-hint="Navy Blue" --ai-fields
  npm run post-pins -- --board-hint=旅行 --dir=./images
  npm run post-pins -- --auto-board --dir=./photos
  npm run post-pins -- --board=ID --ai-fields --dir=./images
  # 先预览，编辑 pin-preview.json 后再发布
  npm run post-pins -- --auto-board --preview --dir=./images
  npm run post-pins -- --from-preview
`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
