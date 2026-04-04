/**
 * Scheduled Pin posting: runs npm run post-pins at cron times.
 *
 * .env config:
 *   PIN_BOARD_ID=board_id          Required, target board to post to
 *   PIN_SCHEDULE_CRON=...          Optional; default every 15 min, 07:00–23:45 America/Los_Angeles
 *   PIN_SCHEDULE_TZ=America/Los_Angeles  Optional IANA tz for cron (default US Pacific)
 *   PIN_SCHEDULE_AI_FIELDS=true   Optional, add --ai-fields when true
 *   PIN_SCHEDULE_JITTER_MINUTES=5 Optional, random delay 0–N min before posting, default 5; set 0 to disable
 *   PIN_SHUFFLE=true            Optional; pass --shuffle to post-pins (random order before --max)
 *
 * Run: npm run schedule (keep running; use pm2 or nohup in production)
 */
import 'dotenv/config';
import cron from 'node-cron';
import { exec } from 'child_process';

const BOARD_ID = process.env.PIN_BOARD_ID;
/** Every 15 min 07:00–23:45 (America/Los_Angeles). Quiet ~23:45–07:00. */
const DEFAULT_CRON = '*/15 7-23 * * *';
const CRON_EXPR = process.env.PIN_SCHEDULE_CRON?.trim();
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
console.log('  cron:', CRON_EXPR ?? DEFAULT_CRON, `(${SCHEDULE_TZ})`);
console.log('  AI copy:', USE_AI ? 'yes' : 'no');
console.log('  Post time jitter:', JITTER_MINUTES > 0 ? `0–${JITTER_MINUTES} min` : 'none');
console.log('  Press Ctrl+C to stop\n');

const effectiveCron = CRON_EXPR ?? DEFAULT_CRON;
if (!cron.validate(effectiveCron)) {
  console.error('Invalid PIN_SCHEDULE_CRON:', effectiveCron);
  console.error('Example: use PIN_SCHEDULE_TZ=America/Los_Angeles and a 5-field cron.');
  process.exit(1);
}
cron.schedule(effectiveCron, runPostPins, cronOpts);

if (process.env.PIN_SCHEDULE_RUN_NOW === 'true') {
  runPostPins();
}
