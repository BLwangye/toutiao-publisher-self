# 即梦AI 图片生成 & 插入 设计文档

## 概述

集成火山引擎即梦AI文生图4.0，生成配图后通过剪贴板粘贴方式插入头条编辑器正文和封面。

## 架构

```
cli.ts --keyword--> jimeng.ts --火山引擎API--> 图片URL
                           ↓
                      下载到本地 (images/)
                           ↓
                    editor.ts (pasteImage) → 剪贴板粘贴 → ProseMirror
                           ↓
                    images.ts (setCover) → 文件选择器 → 封面区
```

## 新增/修改文件

| 文件 | 动作 | 职责 |
|------|------|------|
| `src/jimeng.ts` | 新增 | 即梦AI API调用：签名认证、文生图请求、结果解析 |
| `src/editor.ts` | 修改 | 新增 `pasteImage(page, imagePath)` 函数 |
| `src/images.ts` | 修改 | `setCover` 改用文件上传方式 |
| `src/cli.ts` | 修改 | 生成图片→插入正文→设置封面 统一流程 |
| `.env` | 新增 | `VOLC_ACCESS_KEY`, `VOLC_SECRET_KEY` |

## jimeng.ts 设计

### API 概述
- **服务**: 火山引擎即梦AI-图片生成4.0
- **域名**: `https://visual.volcengineapi.com`
- **Action**: `CVProcess`
- **认证**: AK/SK + HMAC-SHA256 签名
- **版本**: 2022-08-31

### 函数签名

```typescript
export async function generateImage(options: {
  prompt: string;
  width?: number;   // 默认 1024
  height?: number;  // 默认 1024
  style?: string;   // 风格，默认空
}): Promise<string[]>
// 返回图片URL数组
```

### CLI 参数扩展

```bash
# 自动生成配图
npx tsx src/cli.ts --title "..." --content "..." --image-keyword "旅行 风景"

# 流程: 生成1张配图 → 下载 → 粘贴到正文 → 生产1张封面 → 上传封面 → 发布
```

## 图片插入机制

### 正文插入 (已验证可行)
通过 ProseMirror 的 paste 事件插入图片：

```typescript
// 读取图片 → base64 → DataTransfer → paste事件
const buffer = fs.readFileSync(imagePath);
const base64 = buffer.toString('base64');
const mime = 'image/png';
const dataUri = `data:${mime};base64,${base64}`;

await page.evaluate((dataUri) => {
  const editor = document.querySelector('.ProseMirror');
  editor.focus();
  const dt = new DataTransfer();
  dt.setData('text/html', `<img src="${dataUri}" />`);
  editor.dispatchEvent(new ClipboardEvent('paste', {
    clipboardData: dt,
    bubbles: true,
  }));
}, dataUri);
```

### 封面设置
封面区有"单图"模式，通过文件选择器上传：

```typescript
const fileChooser = page.waitForEvent('filechooser');
await page.locator('label', { hasText: '单图' }).click();
// 寻找上传触发元素...
const chooser = await fileChooser;
await chooser.setFiles(imagePath);
```

封面具体上传入口需运行时探测（可能点击单图后出现上传按钮/区域）。

## 环境变量

```env
VOLC_ACCESS_KEY=your_ak
VOLC_SECRET_KEY=your_sk
```

## 一期范围

- [x] 即梦AI文生图（单张）
- [x] 图片下载本地
- [x] 正文粘贴插入
- [x] 封面上传
- [ ] 批量多图
- [ ] 图生图/风格化

## 风险

1. 即梦API调用需付费（按量计费）
2. 封面文件选择器位置需运行时确认
3. base64 大图可能受编辑器限制
