import axios, { AxiosInstance } from 'axios';

const API_BASE = 'https://api.pinterest.com/v5';
const API_SANDBOX_BASE = 'https://api-sandbox.pinterest.com/v5';

/** 试用应用需用 Sandbox，在 .env 中设 PINTEREST_USE_SANDBOX=true */
function getApiBase(): string {
  return process.env.PINTEREST_USE_SANDBOX === 'true' ? API_SANDBOX_BASE : API_BASE;
}

/** 创建带 Bearer token 的 HTTP 客户端，后续所有请求都会带这个 token */
export function createPinterestClient(accessToken: string): AxiosInstance {
  return axios.create({
    baseURL: getApiBase(),
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
  });
}

/** 你的一个画板（board） */
export interface Board {
  id: string;
  name: string;
  description?: string;
}

/** 分页结果（Pinterest API 常用 cursor 分页） */
export interface BoardsResponse {
  items: Board[];
  bookmark?: string;
}

/**
 * 获取当前账号下的画板列表（发 Pin 时必须指定发到哪个 board_id）
 * 使用 API: GET /boards
 */
export async function getBoards(
  client: AxiosInstance,
  pageSize = 25
): Promise<BoardsResponse> {
  const { data } = await client.get<BoardsResponse>('/boards', {
    params: { page_size: pageSize },
  });
  return data;
}

/**
 * 根据「画板名称关键词」自动选画板（不区分中英文、大小写）
 * 例如 hint="旅行" 或 "travel" 会匹配名称里包含该词的画板
 */
export async function findBoardIdByHint(
  client: AxiosInstance,
  hint: string
): Promise<string | null> {
  const res = await getBoards(client, 100);
  const list = res.items ?? [];
  const lower = hint.trim().toLowerCase();
  if (!lower) return null;
  const found = list.find(
    (b) =>
      b.name.toLowerCase().includes(lower) ||
      (b.description ?? '').toLowerCase().includes(lower)
  );
  return found ? found.id : null;
}

/** 画板下的一个 section（分区） */
export interface BoardSection {
  id: string;
  name: string;
}

/** 画板 sections 列表 */
export interface BoardSectionsResponse {
  items: BoardSection[];
  bookmark?: string;
}

/**
 * 获取某画板下的所有 section（分区）
 * 使用 API: GET /boards/{board_id}/sections
 */
export async function getBoardSections(
  client: AxiosInstance,
  boardId: string,
  pageSize = 25
): Promise<BoardSectionsResponse> {
  const { data } = await client.get<BoardSectionsResponse>(
    `/boards/${boardId}/sections`,
    { params: { page_size: pageSize } }
  );
  return data;
}

/**
 * 根据 section 名称关键词匹配该画板下的某个 section
 */
export async function findSectionIdByHint(
  client: AxiosInstance,
  boardId: string,
  hint: string
): Promise<string | null> {
  const res = await getBoardSections(client, boardId, 100);
  const list = res.items ?? [];
  const lower = hint.trim().toLowerCase();
  if (!lower) return null;
  const found = list.find((s) => s.name.toLowerCase().includes(lower));
  return found ? found.id : null;
}

/** 创建 Pin 时用的媒体：二选一 —— 公网图片 URL，或 base64 */
export type PinMedia =
  | { source_type: 'image_url'; url: string }
  | { source_type: 'image_base64'; content_type: 'image/jpeg' | 'image/png'; data: string };

export interface CreatePinParams {
  board_id: string;
  /** 可选：发到该画板下的某个 section（分区） */
  board_section_id?: string;
  title: string;
  description?: string;
  /** 无障碍描述，Pinterest 限制 500 字符 */
  alt_text?: string;
  link?: string;
  media: PinMedia;
}

/** 创建 Pin 后 API 返回的 Pin 信息 */
export interface Pin {
  id: string;
  link?: string;
  title?: string;
  description?: string;
  board_id: string;
}

/**
 * 发一张 Pin 到指定画板
 * 使用 API: POST /pins
 * media 可以是公网 image_url，或本地图片转成的 image_base64（无需图床）
 */
export async function createPin(
  client: AxiosInstance,
  params: CreatePinParams
): Promise<Pin> {
  const body = {
    board_id: params.board_id,
    ...(params.board_section_id != null && params.board_section_id !== '' && { board_section_id: params.board_section_id }),
    title: params.title,
    description: params.description ?? '',
    ...(params.alt_text != null && params.alt_text !== '' && { alt_text: params.alt_text }),
    link: params.link ?? '',
    media_source: params.media,
  };

  const { data } = await client.post<Pin>('/pins', body);
  return data;
}
