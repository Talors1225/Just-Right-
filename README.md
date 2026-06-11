# 对味了

> 懒得挑？我帮你找对味的。
>
> — Talors

一个基于 AI 的游戏和影视推荐工具。

你不需要记住作品名字，也不需要研究各种标签。

直接用自然语言描述你的需求：

* 想玩什么游戏
* 想看什么电影或电视剧
* 喜欢什么风格
* 不喜欢什么类型

AI 会理解你的描述，并从作品库中找出最符合你口味的内容。

## \#演示地址:https://duiweile.up.railway.app/

## ✨ 功能特色

### 🎮 找游戏

从 **上万款游戏**中寻找最符合你需求的作品。

例如：

> 想玩一个剧情优秀、单人体验为主、能沉浸几十小时的 RPG。

> 想找类似《星露谷物语》的休闲经营游戏，但画面更现代一点。

支持：

* 标签筛选
* 自然语言搜索
* AI 推荐理由
* 匹配度评分

\---

### 🎬 找影视

从 **上万部影视作品**中寻找符合口味的内容。

例如：

> 想看一部悬疑感强、反转多、节奏快的电影。

> 想找类似《西部世界》的影视。

AI 会分析你的需求，并给出推荐理由。

\---

### ⭐ 收藏与分享

喜欢的作品可以直接收藏。

支持生成分享图片，方便发给朋友：

* 游戏推荐清单
* 影视推荐清单
* 收藏列表分享

\---

### 🤖 自由选择 AI 模型

项目不绑定任何特定厂商。

只要兼容 OpenAI API 格式即可使用，例如：

* DeepSeek
* OpenAI
* Moonshot
* SiliconFlow
* Ollama
* 其他兼容 OpenAI 接口的服务

\---

### 🌙 深色模式

支持：

* 自动跟随系统主题
* 手动切换明暗模式

\---

## 🚀 快速开始

1. 安装依赖

```bash
npm install
```

2. 配置环境变量

复制配置模板：

```bash
cp .env.example .env
```

编辑 `.env`：

```env
LLM\\\_BASE\\\_URL=https://api.deepseek.com/v1
LLM\\\_API\\\_KEY=your-api-key
LLM\\\_MODEL=deepseek-chat
```

\---

3. 初始化数据

你可以选择导入精选数据快速体验：

```bash
node scripts/seed-games.js
node scripts/seed-movies.js
```

包含：

* 约 200 款精选游戏
* 约 100 部精选影视

或者构建完整数据库：

```bash
node scripts/build-catalog.js
```

该过程需要联网抓取数据。

\---

4. 启动项目

```bash
node server.js
```

浏览器访问：

```text
http://localhost:13000
```

\---

## ⚙️ 环境变量

|变量|说明|默认值|
|-|-|-|
|`LLM\\\_BASE\\\_URL`|API 地址|`https://api.deepseek.com/v1`|
|`LLM\\\_API\\\_KEY`|API Key|必填|
|`LLM\\\_MODEL`|模型名称|`deepseek-chat`|
|`PORT`|服务端口|`13000`|

\---

### 常见配置示例

**DeepSeek**

```env
LLM\\\_BASE\\\_URL=https://api.deepseek.com/v1
LLM\\\_API\\\_KEY=sk-xxxx
LLM\\\_MODEL=deepseek-chat
```

**OpenAI**

```env
LLM\\\_BASE\\\_URL=https://api.openai.com/v1
LLM\\\_API\\\_KEY=sk-xxxx
LLM\\\_MODEL=gpt-4o-mini
```

**Google Gemini**

```env
LLM\\\_BASE\\\_URL=https://generativelanguage.googleapis.com/v1beta/openai
LLM\\\_API\\\_KEY=sk-xxxx
LLM\\\_MODEL=gemini-2.0-flash
```

> 所有兼容 OpenAI `/v1/chat/completions` 接口的模型服务均可使用。

\---

## 🛠 技术栈

**后端**

* Node.js
* Express
* sql.js（SQLite）

**前端**

* 原生 JavaScript SPA
* ES Modules
* 无框架依赖

**AI**

* 任意 OpenAI Compatible LLM

**数据来源**

游戏：

* IGDB
* SteamSpy
* RAWG

影视：

* TMDB

\---

## 📂 项目结构

```text
├── server.js              # 服务入口
├── public/
│   ├── index.html
│   ├── style.css
│   ├── app.js
│   └── modules/
├── scripts/               # 数据构建脚本
├── data/                  # 数据库文件
└── .env.example
```

\---

## 🐳 Docker

```dockerfile
FROM node:20-slim

WORKDIR /app

COPY package\\\*.json ./
RUN npm install --production

COPY . .

EXPOSE 13000

CMD \\\["node", "server.js"]
```

\---

## 💡 我为什么做这个项目？

现在的推荐系统很多，但大多数都要求用户：

* 知道自己想找什么
* 会使用复杂筛选器
* 熟悉各种分类和标签

我一般不知道具体要玩什么或者看什么，我只是想找个“对味”的

于是有了这个项目。

\---

## 🤝 欢迎交流与贡献

这是一个兴趣驱动的小项目，目前还有很多可以完善和优化的地方。

如果你发现：

* 搜索结果不够准确
* 推荐理由不够合理
* 数据存在缺失或错误
* UI / UX 可以更好
* 有新的功能想法

都欢迎提交：

* Issue
* Pull Request
* Discussion
* 使用反馈

任何建议、吐槽、想法，甚至一句简单的使用体验，都可能帮助项目变得更好。

如果这个项目帮你找到了一款喜欢的游戏，或者发现了一部值得观看的作品，欢迎点个 "Star ⭐"支持一下。

你的支持和反馈，就是开源项目持续更新最大的动力。

感谢关注和使用，期待与你交流，也欢迎一起把  对味了  做得更好。

\---

## License

MIT

