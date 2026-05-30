---
name: toutiao-publisher
version: 1.0.0
description: 自动发布文章到今日头条。触发词：发头条、发布头条、今日头条、发文章、写头条。
---

# 今日头条自动发布

## 触发词
发头条、发布头条、今日头条、发文章、写头条

## 前置条件
1. 用户已安装 Chrome 并在其中登录过头条号 (mp.toutiao.com)
2. 项目已安装依赖: `cd D:\TouTiao && npm install`

## 发布流程

### 使用方式

```bash
cd D:\TouTiao && npx tsx src/cli.ts --title "标题" --content "<p>正文</p>"
```

### 完整参数

```bash
npx tsx src/cli.ts \
  --title "文章标题" \
  --content "<h1>段落</h1><p>正文内容</p>" \
  --image-keyword "科技 电脑" \
  --cover-keyword "科技"
```

### 跳过可选步骤

```bash
# 跳过图片
npx tsx src/cli.ts --title "标题" --content "<p>正文</p>" --no-images

# 跳过声明
npx tsx src/cli.ts --title "标题" --content "<p>正文</p>" --no-declarations
```

## 子技能触发

当用户提供了标题和内容时，AI 应直接执行发布命令。当用户只提供主题时，AI 先生成内容再发布。

## 错误处理

- 登录超时: 提示用户手动登录浏览器
- 元素找不到: 提示检查头条后台页面是否更新
- 发布失败: 提示检查内容是否完整、网络是否正常
