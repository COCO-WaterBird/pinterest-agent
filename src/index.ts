import express from 'express';
import * as dotenv from 'dotenv';
import { spawn } from 'child_process';
import { authRouter } from './routes/auth';

dotenv.config();

//verify env variables

console.log("PORT=", process.env.PORT);
console.log("REDIRECT=", process.env.PINTEREST_REDIRECT_URI);

const app = express();
app.use(express.json());

let isRunInProgress = false;

function getBearerToken(headerValue: string | undefined): string | null {
  if (!headerValue) return null;
  const [scheme, token] = headerValue.split(' ');
  if (scheme !== 'Bearer' || !token) return null;
  return token;
}

app.get('/', (req, res) => {
  res.send('Pinterest Agent Running');
});

app.use('/pinterest', authRouter);

app.post('/run', (req, res) => {
  const expectedToken = process.env.RUN_BEARER_TOKEN;
  if (!expectedToken) {
    return res.status(500).json({
      ok: false,
      error: 'RUN_BEARER_TOKEN is not set',
    });
  }

  const token = getBearerToken(req.header('authorization'));
  if (!token || token !== expectedToken) {
    return res.status(401).json({
      ok: false,
      error: 'Unauthorized',
    });
  }

  if (isRunInProgress) {
    return res.status(409).json({
      ok: false,
      error: 'A run is already in progress',
    });
  }

  const boardId = process.env.PIN_BOARD_ID;
  if (!boardId) {
    return res.status(500).json({
      ok: false,
      error: 'PIN_BOARD_ID is not set',
    });
  }

  const imageDir = process.env.PIN_RUN_DIR ?? './schedule-images';
  const maxPerRun = process.env.PIN_RUN_MAX ?? '1';
  const timeoutSec = Math.max(30, Number(process.env.PIN_RUN_TIMEOUT_SEC ?? '600') || 600);
  const timeoutMs = timeoutSec * 1000;

  const cmdArgs = [
    'dist/agent/post-pins.js',
    'post',
    `--board=${boardId}`,
    '--ai-fields',
    `--dir=${imageDir}`,
    `--max=${maxPerRun}`,
    '--shuffle',
  ];

  isRunInProgress = true;
  const child = spawn('node', cmdArgs, {
    cwd: process.cwd(),
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let stdout = '';
  let stderr = '';

  child.stdout.on('data', (chunk: Buffer) => {
    stdout += chunk.toString();
  });
  child.stderr.on('data', (chunk: Buffer) => {
    stderr += chunk.toString();
  });

  const timeout = setTimeout(() => {
    child.kill('SIGTERM');
  }, timeoutMs);

  child.on('close', (code) => {
    clearTimeout(timeout);
    isRunInProgress = false;

    if (code !== 0) {
      return res.status(500).json({
        ok: false,
        code,
        stdout,
        stderr,
      });
    }

    return res.json({
      ok: true,
      code,
      stdout,
      stderr,
    });
  });
});

const PORT = Number(process.env.PORT) || 3000;

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});