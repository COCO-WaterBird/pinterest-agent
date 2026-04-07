/**
 * Scheduled Pin posting: runs npm run post-pins at cron times.
 *
 * .env config:
 *   PIN_BOARD_ID=board_id          Required, target board to post to
 *   PIN_SCHEDULE_CRON=...          Optional; default 07:05–00:05 PT, every 15 min
 *   PIN_SCHEDULE_CRON_END=5 0 * * * Optional end-slot cron (default 00:05; env name kept for compatibility)
 *   PIN_SCHEDULE_TZ=America/Los_Angeles  Optional IANA tz for cron (default US Pacific)
 *   PIN_SCHEDULE_AI_FIELDS=true   Optional, add --ai-fields when true
 *   PIN_SHUFFLE=true              Optional; pass --shuffle to post-pins (random order before --max)
 *
 * Run: npm run schedule (keep running; use pm2 or nohup in production)
 */
import 'dotenv/config';
import cron from 'node-cron';
import { exec } from 'child_process';

const BOARD_ID = process.env.PIN_BOARD_ID;
/** Every 15 min from 07:05–23:50 PT, plus 00:05 (America/Los_Angeles). */
const DEFAULT_CRON = '5,20,35,50 7-23 * * *';
const DEFAULT_CRON_END = '5 0 * * *';
const CRON_EXPR = process.env.PIN_SCHEDULE_CRON?.trim();
const CRON_EXPR_END = process.env.PIN_SCHEDULE_CRON_END?.trim();
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

function runPostPins() {
  const time = new Date().toISOString();
  console.log(`[${time}] Scheduled run triggered: ${cmd}`);
  doRun();
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
console.log('  cron:', CRON_EXPR ?? `${DEFAULT_CRON} + ${CRON_EXPR_END ?? DEFAULT_CRON_END}`, `(${SCHEDULE_TZ})`);
console.log('  AI copy:', USE_AI ? 'yes' : 'no');
console.log('  Press Ctrl+C to stop\n');

const effectiveCron = CRON_EXPR ?? DEFAULT_CRON;
if (!cron.validate(effectiveCron)) {
  console.error('Invalid PIN_SCHEDULE_CRON:', effectiveCron);
  process.exit(1);
}
cron.schedule(effectiveCron, runPostPins, cronOpts);

const endCron = CRON_EXPR_END ?? DEFAULT_CRON_END;
if (!cron.validate(endCron)) {
  console.error('Invalid PIN_SCHEDULE_CRON_END:', endCron);
  process.exit(1);
}
cron.schedule(endCron, runPostPins, cronOpts);

if (process.env.PIN_SCHEDULE_RUN_NOW === 'true') {
  runPostPins();
}
