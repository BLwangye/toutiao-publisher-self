# Toutiao Publisher - Design Spec

## 概述

今日头条文章自动发布工具。通过 opencode AI 调度 + TypeScript/Playwright 浏览器自动化，实现头条号文章的自动化发布。

## 架构

```
用户 → opencode → SKILL.md → TypeScript/Playwright 脚本 → 浏览器 → 头条后台
```

两层架构：
- **调度层**：opencode Skill 文档，定义触发词、发布流程、异常处理策略
- **执行层**：TypeScript + Playwright，封装浏览器操作，暴露为 CLI 命令

## 技术选型

| 项 | 选择 | 原因 |
|----|------|------|
| 语言 | TypeScript | 类型安全，Playwright 原生支持 |
| 运行时 | Node.js + tsx | 直接执行 .ts 文件 |
| 浏览器自动化 | Playwright | 微软出品，API 简洁 |
| 浏览器 | Chromium (launchPersistentContext) | 复用 Chrome 本地 profile 保留登录态 |
| CLI 参数 | commander | 成熟的参数解析库 |
| 配置 | 配置文件 + 环境变量 | 头条号地址、超时等 |

## 目录结构

```
toutiao-publisher/
├── SKILL.md                 # opencode 技能文档
├── package.json
├── tsconfig.json
├── src/
│   ├── browser.ts           # Playwright 浏览器启动/连接管理
│   ├── login.ts             # 登录态检查 & 引导手动登录
│   ├── editor.ts            # 编辑器操作：标题输入、正文注入
│   ├── images.ts            # AI配图 & 封面设置
│   ├── publish.ts           # 发布流程：点击发布、确认、验证
│   └── cli.ts               # CLI 入口，组装上述模块
└── tests/
    └── publish.test.ts
```

## 模块职责

### browser.ts
- `createContext()`：通过 `launchPersistentContext` 连接本地 Chrome 用户数据目录
- 返回 `{ browser, page }` 供其他模块使用

### login.ts
- `ensureLogin(page)`：检查当前页面是否已登录头条号后台
- 若未登录，提示用户手动扫码/密码登录，等待 URL 跳转到创作页

### editor.ts
- `typeTitle(page, title)`：定位标题输入框，逐字输入
- `insertContent(page, html)`：操作 ProseMirror 编辑器 DOM，触发 React 合成事件
  - 注入 innerHTML
  - 派发 `input`、`compositionend`、`selectionchange`、`blur`、`focus` 事件
  - 确保 SPA 框架检测到内容变化

### images.ts
- `insertAIImage(page, keyword)`：点击 AI 创作助手 → 输入关键词 → 选择推荐图片
- `setCover(page, keyword)`：打开免费正版图库 → 搜索 → 选择封面

### publish.ts
- `clickPublish(page)`：点击「预览并发布」→ 等待预览加载 → 点击「确认发布」
- `verifyPublish(page)`：检查 URL 是否跳转到文章详情页

### cli.ts
- 解析 CLI 参数（--title, --content）
- 依次调用以上模块完成发布
- 返回结果（成功/失败 + 文章链接）

## 关键设计决策

### 登录态管理
- 使用 Playwright 的 `launchPersistentContext(userDataDir)` 连接到用户已有的 Chrome 用户数据目录
- 默认路径：`%LOCALAPPDATA%/Google/Chrome/User Data`
- 用户需先在 Chrome 中手动登录过头条号，脚本复用该登录态
- 备选：可指定独立的 userDataDir 避免与日常浏览器冲突

### 正文内容注入
头条编辑器基于 ProseMirror，直接设置 innerHTML 不够，需要通过 JS 触发完整的 React 合成事件链：
```
element.innerHTML = html;
element.dispatchEvent(new Event('input', { bubbles: true }));
element.dispatchEvent(new CompositionEvent('compositionend'));
element.dispatchEvent(new Event('selectionchange'));
element.blur();
element.focus();
```

### 元素定位策略
不使用 OpenClaw 的 aria ref，改用 Playwright 原生选择器：
- `placeholder="请输入标题"` → 定位标题框
- `.ProseMirror` → 定位正文编辑器
- `text="AI 创作助手"` → 定位 AI 助手按钮
- `text="预览并发布"` → 定位发布按钮
- `text="确认发布"` → 定位确认按钮

### 超时与重试
- 每个操作默认超时 30s
- AI 图片加载额外等待 30s
- 发布结果检查最多重试 3 次，每次间隔 2s

## 一期功能范围

- [x] 标题输入
- [x] 正文内容注入（HTML/Markdown）
- [x] AI 配图
- [x] 封面设置
- [x] 声明设置（头条首发、个人观点、AI 标注）
- [x] 发布并验证
- [ ] 微头条发布（二期）
- [ ] 图片上传到正文（二期）

## 测试策略

- 单元测试：editor.ts 的 DOM 操作函数（vitest + jsdom）
- 集成测试：完整发布流程（需真实登录态，默认跳过）

## 风险与限制

1. 头条后台页面结构可能变更，需维护选择器
2. 依赖用户已在 Chrome 中登录头条号
3. 发布频率受头条号限制，需注意防封
4. Windows 首个版本支持，Linux/Mac 适配后续
