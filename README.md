# Pinterest Agent — 自动化发 Pin

用本地图片自动发布到 Pinterest 画板。适合已有图片、想批量发 Pin 的场景。

## 前置条件

- 已配置 `.env`（`PINTEREST_CLIENT_ID`、`PINTEREST_CLIENT_SECRET`、`PINTEREST_REDIRECT_URI`）
- 已完成一次 OAuth 登录，项目根目录下有 `tokens.json`

## 一步步操作（自动化发 Pin）

### 第一步：安装依赖

```bash
npm install
```

**说明**：`npm install` 会根据 `package.json` 里的 `dependencies` 和 `devDependencies` 安装所有依赖，并写入 `node_modules`。以后跑 `npm run xxx` 或 `npx ts-node` 都会用到这些包。

---

### 第二步：拿到 Pinterest 授权（若还没做过）

1. 启动本地服务：

```bash
npm run dev
```

**说明**：`npm run dev` 执行的是 `ts-node-dev --respawn --transpile-only src/index.ts`。即用 `ts-node-dev` 直接跑 TypeScript，不先编译；`--respawn` 表示改代码后自动重启；`--transpile-only` 只做转译不做类型检查，启动更快。

2. 浏览器打开：

```
http://localhost:3000/pinterest/login
```

**说明**：这会跳转到 Pinterest 授权页，你授权后会被重定向到 `PINTEREST_REDIRECT_URI`（如 `http://localhost:3000/pinterest/callback`），服务端用回调里的 `code` 换 `access_token` 并写入 `tokens.json`。之后发 API 请求都会用这个 token。

3. 看到 “Token saved to tokens.json” 后，可以关掉 `npm run dev`（或另开一个终端做下面步骤）。

---

### 第三步：列出画板，拿到 board_id

在项目根目录执行：

```bash
npm run boards
```

**说明**：`npm run boards` 会执行 `ts-node src/agent/post-pins.ts boards`。即用 `ts-node` 直接运行 TypeScript 脚本，脚本里会读 `tokens.json` 的 `access_token`，调用 Pinterest API `GET /v5/boards` 拉取你账号下的画板列表并打印。发 Pin 时必须指定要发到哪个画板，所以需要从这里记下要用的 `board_id`（第一列）。

---

### 第四步：准备图片

把要发的图片放到 **`assets/to-post`** 目录（若不存在请先创建：`mkdir -p assets/to-post`）；或用 `--dir=...` 指定其他目录。支持 `.jpg`、`.jpeg`、`.png`。

**说明**：脚本会扫描目录下这些扩展名的文件，读成 base64 后通过 Pinterest API 上传。发**成功**的图会移到 `assets/posted`，**失败**的会移到 `assets/failed`（目录不存在时会自动创建）。

---

### 第五步：发 Pin

在项目根目录执行（把 `BOARD_ID` 换成第三步拿到的画板 ID）：

```bash
npm run post-pins -- --board=BOARD_ID
```

默认会从 **`assets/to-post`** 读图并依次发布；成功后图片移至 `assets/posted`，失败移至 `assets/failed`。

可选参数（都写在 `--` 后面）：

- `--dir=目录路径`：图片所在目录，默认 `assets/to-post`
- `--image=单张图片路径`：只发这一张
- `--title=标题`
- `--description=描述`

示例：

```bash
npm run post-pins -- --board=123456789 --dir=./my-photos --title="我的图" --description="描述"
```

---

## 根据图片/名称自动选画板

不必每次手填 `--board=ID`，可以用下面三种方式让脚本自己决定发到哪个画板。

### 方式一：按「画板名称关键词」匹配（无需额外配置）

用 `--board-hint=关键词`，脚本会在你账号的画板列表里找**名称或描述包含该词**的画板（不区分中英文、大小写），用第一个匹配的。

```bash
npm run post-pins -- --board-hint=旅行 --dir=./images
```

若画板名是「旅行 / Travel」或描述里含「旅行」，就会自动选它。

### 方式二：用「目录名」当关键词（同上，更省事）

把图片放在**以画板名命名的子目录**下，不写 `--board-hint` 也会用目录名去匹配画板。

例如画板叫「美食」，可以：

```bash
mkdir -p images/美食
# 把图片放进 images/美食/
npm run post-pins -- --dir=./images/美食
```

脚本会用目录名 `美食` 去匹配画板名称，等同于 `--board-hint=美食`。

### 方式三：根据图片内容用 AI 选画板（需 OpenAI）

若希望**每张图按内容**自动发到最相关的画板，可加 `--auto-board`。脚本会用 OpenAI Vision 分析每张图，得到 1～3 个英文类别词（如 travel、food、fashion），再按这些词匹配画板名称；匹配不到则发到你的第一个画板。

1. 在 `.env` 里配置 OpenAI API Key：

```bash
OPENAI_API_KEY=sk-...
```

2. 执行：

```bash
npm run post-pins -- --auto-board --dir=./images
```

**说明**：会为每张图调一次 OpenAI（模型 `gpt-4o-mini`），产生少量费用；未配置 `OPENAI_API_KEY` 时用 `--auto-board` 会报错并提示改用 `--board` 或 `--board-hint`。

---

## AI 文案规则（--auto-board / --ai-fields）

使用 OpenAI 生成文案时，会遵循以下规则（针对品牌 **The Cabination**）：

- **标题**：格式为 `[风格] + [布局] + [功能] + [用途]`，例如 *"Modern Minimalist Wall Mounted Cabinet with Soft-Close Doors for Kitchen Storage"*，并尽量包含长尾关键词。
- **描述**：必须包含品牌名 **The Cabination**，并自然融入长尾关键词（如 small space storage solutions、apartment organization）。
- **Alt**：无障碍描述中也会尽量使用长尾关键词。
- **标签**：4～8 个长尾或具体关键词，会以 `#tag` 形式拼进描述末尾。

### 人工参与审核（推荐，符合 Pinterest 政策）

希望「人选图、看一遍/改一遍文案再发」时，用**两步**：

1. **生成预览（不发布）**：用 `--preview` 让 AI 生成每条 Pin 的文案并写入 `pin-preview.json`，不发到 Pinterest。
2. **编辑预览文件**：打开 `pin-preview.json`，按需改 title/description/alt，或对不想发的条目加上 `"skip": true`。
3. **按预览发布**：执行 `npm run post-pins -- --from-preview`，只会上传预览文件中未标记 skip 的条目。

```bash
# 第一步：生成预览
npm run post-pins -- --auto-board --preview --dir=./images

# 第二步：编辑项目根目录下的 pin-preview.json

# 第三步：发布
npm run post-pins -- --from-preview
```

---

### 长尾关键词清单（可选）

**建议建立清单**，便于 SEO 一致性和品牌聚焦：

- **方式一**：在项目根目录创建 `keywords.txt`，每行一个长尾关键词，`#` 开头为注释。示例见 `keywords.txt.example`，复制为 `keywords.txt` 后按需修改。
- **方式二**：在 `.env` 中配置 `PIN_KEYWORDS=词1,词2,词3`。

有清单时，AI 会在标题、描述、alt 中**优先自然融入**这些词；没有清单时，AI 仍会根据图片内容生成长尾表述，但不会统一围绕你指定的关键词。

```bash
# 使用关键词清单发 Pin（清单可选）
npm run post-pins -- --auto-board --dir=./images
# 或指定画板 + 仅 AI 文案
npm run post-pins -- --board-hint=cabinet --ai-fields --dir=./images
```

---

## 定时发 Pin

在固定时间自动执行发 Pin（例如每天 9:00 发 `assets/to-post` 里的图）。

### 1. 配置 .env

在 `.env` 中增加（或取消注释）：

```bash
PIN_BOARD_ID=1119144644842442822      # 必填，发到哪个画板
PIN_SCHEDULE_CRON=0 9 * * *          # 默认每天 9:00（分 时 日 月 周）
PIN_SCHEDULE_AI_FIELDS=true          # 为 true 时使用 AI 生成标题/描述/alt
# PIN_SCHEDULE_RUN_NOW=true          # 可选：启动时先执行一次（测试用）
```

**cron 格式**（分 时 日 月 周）：

- `0 9 * * *` — 每天 9:00
- `0 9,15 * * *` — 每天 9:00 和 15:00
- `30 8 * * 1-5` — 工作日 8:30

### 2. 安装依赖并启动调度

```bash
npm install
npm run schedule
```

进程会常驻，到点自动执行 `post-pins --board=... --ai-fields`。若要后台运行可配合 `nohup npm run schedule &` 或 pm2。

### 3. 系统 crontab（可选）

不用常驻进程时，可用系统定时任务（在项目根目录执行）：

```bash
crontab -e
# 添加一行（每天 9:00，请把路径改成你的项目路径）：
# 0 9 * * * cd /path/to/Pinterest-agent && npm run post-pins -- --board=1119144644842442822 --ai-fields
```

---

## 小结：命令与作用

| 命令 | 作用 |
|------|------|
| `npm install` | 安装依赖到 `node_modules` |
| `npm run dev` | 启动 Express，用于 OAuth 登录并写入 `tokens.json` |
| `npm run boards` | 列出画板，拿到 `board_id` |
| `npm run post-pins -- --board=ID [--dir=...]` | 用本地图片向指定画板发 Pin |
| `npm run post-pins -- --board-hint=关键词` | 按画板名称匹配，自动选画板 |
| `npm run post-pins -- --auto-board` | 根据图片内容用 AI 选画板（需 `OPENAI_API_KEY`） |

| `npm run post-pins -- --from-preview` | 按预览文件发布（审核后发） |
| `npm run schedule` | 启动定时发 Pin（需配置 PIN_BOARD_ID、PIN_SCHEDULE_CRON） |

按顺序做完「安装 → 登录拿到 token → boards 拿 board_id → 放图到 assets/to-post → post-pins」就可以实现自动化发 Pinterest Pin。需要「根据图片自己判断发到哪个 board」时，用 `--board-hint` / 目录名 或 `--auto-board` 即可。需要定时发时配置 `.env` 后运行 `npm run schedule`。
