import * as dotenv from 'dotenv';
import { readFile } from 'fs/promises';
import path from 'path';

dotenv.config();

/** 从 .env 读到的环境变量 */
export function getEnv() {
  const clientId = process.env.PINTEREST_CLIENT_ID;
  const clientSecret = process.env.PINTEREST_CLIENT_SECRET;
  const redirectUri = process.env.PINTEREST_REDIRECT_URI;
  const port = process.env.PORT ?? '3000';

  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error(
      '缺少环境变量：请在 .env 中配置 PINTEREST_CLIENT_ID, PINTEREST_CLIENT_SECRET, PINTEREST_REDIRECT_URI'
    );
  }

  return {
    clientId,
    clientSecret,
    redirectUri,
    port: Number(port),
  };
}

/** 存 OAuth 后拿到的 token 的结构（与 routes/auth 写入的格式一致） */
export interface PinterestTokens {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  obtained_at?: string;
}

/** 从 tokens.json 读取 access_token（发 API 请求时必须） */
export async function getAccessToken(): Promise<string> {
  const tokensPath = path.join(process.cwd(), 'tokens.json');
  try {
    const raw = await readFile(tokensPath, 'utf-8');
    const tokens = JSON.parse(raw) as PinterestTokens;
    if (!tokens.access_token) {
      throw new Error('tokens.json 中没有 access_token');
    }
    return tokens.access_token;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(
      `无法读取 token，请先完成 OAuth 登录（访问 /pinterest/login）。错误: ${msg}`
    );
  }
}
