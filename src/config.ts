import * as dotenv from 'dotenv';
import { readFile } from 'fs/promises';
import path from 'path';

dotenv.config();

/** Environment variables read from .env */
export function getEnv() {
  const clientId = process.env.PINTEREST_CLIENT_ID;
  const clientSecret = process.env.PINTEREST_CLIENT_SECRET;
  const redirectUri = process.env.PINTEREST_REDIRECT_URI;
  const port = process.env.PORT ?? '3000';

  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error(
      'Missing env vars: set PINTEREST_CLIENT_ID, PINTEREST_CLIENT_SECRET, PINTEREST_REDIRECT_URI in .env'
    );
  }

  return {
    clientId,
    clientSecret,
    redirectUri,
    port: Number(port),
  };
}

/** OAuth token shape (matches what routes/auth writes) */
export interface PinterestTokens {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  obtained_at?: string;
}

/** Read access_token from tokens.json (required for API calls) */
export async function getAccessToken(): Promise<string> {
  const tokensPath = path.join(process.cwd(), 'tokens.json');
  try {
    const raw = await readFile(tokensPath, 'utf-8');
    const tokens = JSON.parse(raw) as PinterestTokens;
    if (!tokens.access_token) {
      throw new Error('tokens.json has no access_token');
    }
    return tokens.access_token;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(
      `Could not read token; complete OAuth first (visit /pinterest/login). Error: ${msg}`
    );
  }
}
