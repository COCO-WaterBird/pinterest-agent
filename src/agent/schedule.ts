/**
 * Scheduled Pin posting: runs npm run post-pins at cron times.
 *
 * .env config:
 *   PIN_BOARD_ID=board_id          Required, target board to post to
 *   PIN_SCHEDULE_CRON=0 9 * * *   Cron expression, default daily at 09:00 (min hour day month dow)
 *   PIN_SCHEDULE_AI_FIELDS=true   Optional, add --ai-fields when true
 *   PIN_SCHEDULE_JITTER_MINUTES=5 Optional, random delay 0–N min before posting, default 5; set 0 to disable
 *
 * Run: npm run schedule (keep running; use pm2 or nohup in production)
 */
import 'dotenv/config';
import cron from 'node-cron';
import { exec } from 'child_process';

const BOARD_ID = process.env.PIN_BOARD_ID;
const CRON_EXPR = process.env.PIN_SCHEDULE_CRON ?? '0 9 * * *'; // default daily 09:00
const USE_AI = process.env.PIN_SCHEDULE_AI_FIELDS === 'true';

if (!BOARD_ID) {
  console.error('Missing PIN_BOARD_ID in .env (target board ID to post to)');
  process.exit(1);
}

const rootDir = process.cwd();
const args = ['run', 'post-pins', '--', '--board=' + BOARD_ID];
if (USE_AI) args.push('--ai-fields');
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

if (!cron.validate(CRON_EXPR)) {
  console.error('Invalid PIN_SCHEDULE_CRON:', CRON_EXPR);
  console.error('Examples: 0 9 * * * = daily 09:00, 0 9,15 * * * = 09:00 and 15:00');
  process.exit(1);
}

console.log('Scheduled Pin posting started');
console.log('  Board ID:', BOARD_ID);
console.log('  cron:', CRON_EXPR, '(min hour day month dow)');
console.log('  AI copy:', USE_AI ? 'yes' : 'no');
console.log('  Post time jitter:', JITTER_MINUTES > 0 ? `0–${JITTER_MINUTES} min` : 'none');
console.log('  Press Ctrl+C to stop\n');

cron.schedule(CRON_EXPR, runPostPins);

if (process.env.PIN_SCHEDULE_RUN_NOW === 'true') {
  runPostPins();
}
