import axios, { AxiosInstance } from 'axios';

const API_BASE = 'https://api.pinterest.com/v5';
const API_SANDBOX_BASE = 'https://api-sandbox.pinterest.com/v5';

/** Trial apps use Sandbox; set PINTEREST_USE_SANDBOX=true in .env */
function getApiBase(): string {
  return process.env.PINTEREST_USE_SANDBOX === 'true' ? API_SANDBOX_BASE : API_BASE;
}

/** Create HTTP client with Bearer token for all requests */
export function createPinterestClient(accessToken: string): AxiosInstance {
  return axios.create({
    baseURL: getApiBase(),
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
  });
}

/** A board */
export interface Board {
  id: string;
  name: string;
  description?: string;
}

/** Paginated boards response (Pinterest API uses cursor pagination) */
export interface BoardsResponse {
  items: Board[];
  bookmark?: string;
}

/**
 * List boards for the current account (required to choose board_id when posting)
 * API: GET /boards
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
 * Create a board (Sandbox has none by default — create one before posting)
 * API: POST /boards
 */
export async function createBoard(
  client: AxiosInstance,
  params: { name: string; description?: string }
): Promise<Board> {
  const { data } = await client.post<Board>('/boards', {
    name: params.name,
    ...(params.description != null && params.description !== ''
      ? { description: params.description }
      : {}),
  });
  return data;
}

/**
 * Find a board by name/description hint (case-insensitive)
 * e.g. hint="travel" matches a board whose name or description contains "travel"
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

/** A section under a board */
export interface BoardSection {
  id: string;
  name: string;
}

/** Paginated board sections response */
export interface BoardSectionsResponse {
  items: BoardSection[];
  bookmark?: string;
}

/**
 * List sections for a board
 * API: GET /boards/{board_id}/sections
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
 * Find a section by name hint within a board
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

/** Pin media: either image URL or base64 */
export type PinMedia =
  | { source_type: 'image_url'; url: string }
  | { source_type: 'image_base64'; content_type: 'image/jpeg' | 'image/png'; data: string };

export interface CreatePinParams {
  board_id: string;
  /** Optional: post to this section under the board */
  board_section_id?: string;
  title: string;
  description?: string;
  /** Alt text; Pinterest limit 500 chars */
  alt_text?: string;
  link?: string;
  media: PinMedia;
}

/** Pin returned by API after create */
export interface Pin {
  id: string;
  link?: string;
  title?: string;
  description?: string;
  board_id: string;
}

/**
 * Create a Pin on the given board
 * API: POST /pins
 * media can be image_url or image_base64 (no external host needed)
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
