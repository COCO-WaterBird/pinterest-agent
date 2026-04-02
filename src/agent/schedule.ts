/**
 * Scheduled Pin posting: runs npm run post-pins at cron times.
 *
 * .env config:
 *   PIN_BOARD_ID=board_id          Required, target board to post to
 *   PIN_SCHEDULE_CRON=...          Optional; default = every 30 min, 09:00–21:00 America/Los_Angeles
 *   PIN_SCHEDULE_TZ=America/Los_Angeles  Optional IANA tz for cron (default US Pacific)
 *   PIN_SCHEDULE_AI_FIELDS=true   Optional, add --ai-fields when true
 *   PIN_SCHEDULE_CRON_21=0 21 * * *  Optional second cron when using defaults (21:00 slot only)
 *   PIN_SCHEDULE_JITTER_MINUTES=5 Optional, random delay 0–N min before posting, default 5; set 0 to disable
 *   PIN_SHUFFLE=true            Optional; pass --shuffle to post-pins (random order before --max)
 *
 * Run: npm run schedule (keep running; use pm2 or nohup in production)
 */
import 'dotenv/config';
import cron from 'node-cron';
import { exec } from 'child_process';

const BOARD_ID = process.env.PIN_BOARD_ID;
/** Every 30 min from 09:00–20:30 PT, plus 21:00 (no 21:30). */
const DEFAULT_CRON_MAIN = '*/30 9-20 * * *';
const DEFAULT_CRON_21 = '0 21 * * *';
const CRON_EXPR = process.env.PIN_SCHEDULE_CRON?.trim();
const CRON_EXPR_21 = process.env.PIN_SCHEDULE_CRON_21?.trim();
const SCHEDULE_TZ = process.env.PIN_SCHEDULE_TZ ?? 'America/Los_Angeles';
const USE_AI = process.env.PIN_SCHEDULE_AI_FIELDS === 'true';

if (!BOARD_ID) {
  console.error('Missing PIN_BOARD_ID in .env (target board ID to post to)');
  process.exit(1);
}

const rootDir = process.cwd();
const args = ['run', 'post-pins', '--', '--board=' + BOARD_ID];
if (USE_AI) args.push('--ai-fields');
if (process.env.PIN_SHUFFLE === 'true') args.push('--shuffle');
const cmd = `npm ${args.join(' ')}`;

/** Max random delay in minutes before posting; 0 = no jitter. Default 5. */
const JITTER_MINUTES = Math.max(0, parseInt(process.env.PIN_SCHEDULE_JITTER_MINUTES ?? '5', 10) || 0);

function runPostPins() {
  const time = new Date().toISOString();
  const delayMs = JITTER_MINUTES > 0 ? Math.floor(Math.random() * JITTER_MINUTES * 60 * 1000) : 0;
  if (delayMs > 0) {
    const sec = (delayMs / 1000).toFixed(1);
    console.log(`[${time}] Scheduled run triggered, will execute in ${sec}s: ${cmd}`);
    setTimeout(doRun, delayMs);
  } else {
    console.log(`[${time}] Scheduled run triggered: ${cmd}`);
    doRun();
  }
}

function doRun() {
  const time = new Date().toISOString();
  exec(cmd, { cwd: rootDir }, (err, stdout, stderr) => {
    if (stdout) process.stdout.write(stdout);
    if (stderr) process.stderr.write(stderr);
    if (err) console.error(`[${time}] Run failed:`, err.message);
    else console.log(`[${time}] Run completed`);
  });
}

const cronOpts = { timezone: SCHEDULE_TZ };

console.log('Scheduled Pin posting started');
console.log('  Board ID:', BOARD_ID);
console.log(
  '  cron:',
  CRON_EXPR ?? `${DEFAULT_CRON_MAIN} + ${CRON_EXPR_21 ?? DEFAULT_CRON_21}`,
  `(${SCHEDULE_TZ})`
);
console.log('  AI copy:', USE_AI ? 'yes' : 'no');
console.log('  Post time jitter:', JITTER_MINUTES > 0 ? `0–${JITTER_MINUTES} min` : 'none');
console.log('  Press Ctrl+C to stop\n');

if (CRON_EXPR) {
  if (!cron.validate(CRON_EXPR)) {
    console.error('Invalid PIN_SCHEDULE_CRON:', CRON_EXPR);
    console.error('Examples: */30 9-20 * * * = every 30 min 09:00–20:30 in PIN_SCHEDULE_TZ');
    process.exit(1);
  }
  cron.schedule(CRON_EXPR, runPostPins, cronOpts);
} else {
  if (!cron.validate(DEFAULT_CRON_MAIN) || !cron.validate(DEFAULT_CRON_21)) {
    console.error('Invalid built-in default cron');
    process.exit(1);
  }
  cron.schedule(DEFAULT_CRON_MAIN, runPostPins, cronOpts);
  const second = CRON_EXPR_21 ?? DEFAULT_CRON_21;
  if (!cron.validate(second)) {
    console.error('Invalid PIN_SCHEDULE_CRON_21:', second);
    process.exit(1);
  }
  cron.schedule(second, runPostPins, cronOpts);
}

if (process.env.PIN_SCHEDULE_RUN_NOW === 'true') {
  runPostPins();
}
