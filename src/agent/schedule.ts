/**
 * 定时发 Pin：按 cron 表达式在指定时间执行 npm run post-pins
 *
 * 配置 .env：
 *   PIN_BOARD_ID=画板ID          必填，发到哪个画板
 *   PIN_SCHEDULE_CRON=0 9 * * *  cron 表达式，默认每天 9:00（分 时 日 月 周）
 *   PIN_SCHEDULE_AI_FIELDS=true  可选，为 true 时加 --ai-fields
 *
 * 运行：npm run schedule（需常驻，可配合 pm2 或 nohup）
 */
import 'dotenv/config';
import cron from 'node-cron';
import { exec } from 'child_process';

const BOARD_ID = process.env.PIN_BOARD_ID;
const CRON_EXPR = process.env.PIN_SCHEDULE_CRON ?? '0 9 * * *'; // 默认每天 9:00
const USE_AI = process.env.PIN_SCHEDULE_AI_FIELDS === 'true';

if (!BOARD_ID) {
  console.error('请配置 .env 中的 PIN_BOARD_ID（要发到的画板 ID）');
  process.exit(1);
}

const rootDir = process.cwd();
const args = ['run', 'post-pins', '--', '--board=' + BOARD_ID];
if (USE_AI) args.push('--ai-fields');
const cmd = `npm ${args.join(' ')}`;

function runPostPins() {
  const time = new Date().toISOString();
  console.log(`[${time}] 定时任务触发: ${cmd}`);
  exec(cmd, { cwd: rootDir }, (err, stdout, stderr) => {
    if (stdout) process.stdout.write(stdout);
    if (stderr) process.stderr.write(stderr);
    if (err) console.error(`[${time}] 执行失败:`, err.message);
    else console.log(`[${time}] 执行完成`);
  });
}

// 校验 cron 表达式
if (!cron.validate(CRON_EXPR)) {
  console.error('无效的 PIN_SCHEDULE_CRON:', CRON_EXPR);
  console.error('示例: 0 9 * * * = 每天 9:00, 0 9,15 * * * = 每天 9:00 和 15:00');
  process.exit(1);
}

console.log('定时发 Pin 已启动');
console.log('  画板 ID:', BOARD_ID);
console.log('  cron:', CRON_EXPR, '(分 时 日 月 周)');
console.log('  AI 文案:', USE_AI ? '是' : '否');
console.log('  按 Ctrl+C 退出\n');

cron.schedule(CRON_EXPR, runPostPins);

// 可选：启动时立即执行一次（方便测试）
if (process.env.PIN_SCHEDULE_RUN_NOW === 'true') {
  runPostPins();
}
