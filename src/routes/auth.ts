import { Router } from 'express';
import axios from 'axios';
import { writeFile } from 'fs/promises';
import path from 'path';

export const authRouter = Router();

authRouter.get('/login', (req, res) => {
  const clientId = process.env.PINTEREST_CLIENT_ID;
  const redirectUri = process.env.PINTEREST_REDIRECT_URI;
  const scope = 'boards:read,boards:write,pins:read,pins:write';

  if (!clientId || !redirectUri) {
    return res
      .status(500)
      .send('Missing PINTEREST_CLIENT_ID or PINTEREST_REDIRECT_URI in environment');
  }

  const authUrl = `https://www.pinterest.com/oauth/?response_type=code&client_id=${clientId}&redirect_uri=${encodeURIComponent(
    redirectUri
  )}&scope=${scope}`;

  res.redirect(authUrl);
});

authRouter.get('/callback', async (req, res) => {
  const code = req.query.code as string | undefined;

  if (!code) {
    return res.send('No code provided');
  }

  const clientId = process.env.PINTEREST_CLIENT_ID;
  const clientSecret = process.env.PINTEREST_CLIENT_SECRET;
  const redirectUri = process.env.PINTEREST_REDIRECT_URI;

  if (!clientId || !clientSecret || !redirectUri) {
    return res
      .status(500)
      .send('Missing Pinterest OAuth env vars (PINTEREST_CLIENT_ID/SECRET/REDIRECT_URI)');
  }

  try {
    const tokenResponse = await axios.post(
      'https://api.pinterest.com/v5/oauth/token',
      new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
      }),
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        auth: {
          username: clientId,
          password: clientSecret,
        },
      }
    );

    const tokens = {
      ...tokenResponse.data,
      obtained_at: new Date().toISOString(),
    };

    const tokensPath = path.join(process.cwd(), 'tokens.json');
    await writeFile(tokensPath, JSON.stringify(tokens, null, 2), 'utf-8');

    return res.send('Token saved to tokens.json');
  } catch (error: any) {
    const message = error?.response?.data ?? error?.message ?? 'Unknown error';
    console.error('Error exchanging Pinterest token', message);
    return res
      .status(500)
      .send(`Failed to exchange token with Pinterest: ${JSON.stringify(message)}`);
  }
});