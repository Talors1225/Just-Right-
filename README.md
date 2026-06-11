# JustRight

> Don't know what to pick? Let me find your perfect match.
>
> — Talors

An AI-powered game and movie recommendation tool.

You don't need to remember titles or study complex tags.

Just describe what you're looking for in natural language:

* What game you want to play
* What movie or TV show you want to watch
* What style you prefer
* What types you dislike

AI will understand your description and find the best matches from the library.

#Demo URL: https://duiweile.up.railway.app/
#Sample image: https://private-user-images.githubusercontent.com/286664814/606193953-fe7b7fca-b85c-40cd-9754-106da229da40.png?jwt=eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJpc3MiOiJnaXRodWIuY29tIiwiYXVkIjoicmF3LmdpdGh1YnVzZXJjb250ZW50LmNvbSIsImtleSI6ImtleTUiLCJleHAiOjE3ODExNTQ3NTYsIm5iZiI6MTc4MTE1NDQ1NiwicGF0aCI6Ii8yODY2NjQ4MTQvNjA2MTkzOTUzLWZlN2I3ZmNhLWI4NWMtNDBjZC05NzU0LTEwNmRhMjI5ZGE0MC5wbmc_WC1BbXotQWxnb3JpdGhtPUFXUzQtSE1BQy1TSEEyNTYmWC1BbXotQ3JlZGVudGlhbD1BS0lBVkNPRFlMU0E1M1BRSzRaQSUyRjIwMjYwNjExJTJGdXMtZWFzdC0xJTJGczMlMkZhd3M0X3JlcXVlc3QmWC1BbXotRGF0ZT0yMDI2MDYxMVQwNTA3MzZaJlgtQW16LUV4cGlyZXM9MzAwJlgtQW16LVNpZ25hdHVyZT1mODdkMGJiYzg1ODU5YmFlYWY0YWQ2YmQzYTFlMzMxNmJkNTUyMDk1NDE0ZDE0OTRhNTc2ZTQ1NTM2YzdhNTU1JlgtQW16LVNpZ25lZEhlYWRlcnM9aG9zdCZyZXNwb25zZS1jb250ZW50LXR5cGU9aW1hZ2UlMkZwbmcifQ.WQnuaqQ5k2ytF_0kqbfVCg0EYSz6cpRRINeTL6x7WAA
---

## ✨ Features

### 🎮 Find Games

Search from **thousands of games** to find the perfect match.

Examples:

> I want an RPG with great story, single-player, that I can sink dozens of hours into.

> Something like Stardew Valley but with more modern graphics.

Supports:

* Tag filtering
* Natural language search
* AI match reasoning
* Match score

---

### 🎬 Find Movies

Search from **thousands of movies and TV shows** to find what fits your taste.

Examples:

> A suspenseful movie with lots of plot twists and fast pacing.

> Something like Westworld.

AI will analyze your preferences and explain why each pick matches.

---

### ⭐ Wishlist & Share

Save your favorites with one click.

Generate shareable images to send to friends:

* Game recommendation list
* Movie recommendation list
* Wishlist sharing

---

### 🤖 Bring Your Own LLM

No vendor lock-in.

Works with any OpenAI-compatible API, such as:

* DeepSeek
* OpenAI
* Moonshot
* SiliconFlow
* Ollama
* Any other OpenAI-compatible service

---

### 🌙 Dark Mode

Supports:

* Auto-follow system theme
* Manual light/dark toggle

---

## 🚀 Quick Start

1. Install dependencies

```bash
npm install
```

2. Configure environment

Copy the config template:

```bash
cp .env.example .env
```

Edit `.env`:

```env
LLM_BASE_URL=https://api.deepseek.com/v1
LLM_API_KEY=your-api-key
LLM_MODEL=deepseek-chat
```

---

3. Initialize data

You can import curated seed data for a quick start:

```bash
node scripts/seed-games.js
node scripts/seed-movies.js
```

Includes:

* ~200 curated games
* ~100 curated movies

Or build the full database:

```bash
node scripts/build-catalog.js
```

This requires internet access to fetch data.

---

4. Start the server

```bash
node server.js
```

Open in browser:

```text
http://localhost:13000
```

---

## ⚙️ Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `LLM_BASE_URL` | API endpoint | `https://api.deepseek.com/v1` |
| `LLM_API_KEY` | API Key | Required |
| `LLM_MODEL` | Model name | `deepseek-chat` |
| `PORT` | Server port | `13000` |

---

### Common LLM Configurations

**DeepSeek**

```env
LLM_BASE_URL=https://api.deepseek.com/v1
LLM_API_KEY=sk-xxxx
LLM_MODEL=deepseek-chat
```

**OpenAI**

```env
LLM_BASE_URL=https://api.openai.com/v1
LLM_API_KEY=sk-xxxx
LLM_MODEL=gpt-4o-mini
```

**Google Gemini**

```env
LLM_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai
LLM_API_KEY=sk-xxxx
LLM_MODEL=gemini-2.0-flash
```

> Any API compatible with OpenAI's `/v1/chat/completions` format will work.

---

## 🛠 Tech Stack

**Backend**

* Node.js
* Express
* sql.js (SQLite)

**Frontend**

* Vanilla JavaScript SPA
* ES Modules
* No framework dependency

**AI**

* Any OpenAI-compatible LLM

**Data Sources**

Games:

* IGDB
* SteamSpy
* RAWG

Movies:

* TMDB

---

## 📂 Project Structure

```text
├── server.js              # Backend entry
├── public/
│   ├── index.html
│   ├── style.css
│   ├── app.js
│   └── modules/
├── scripts/               # Data build scripts
├── data/                  # Database files
└── .env.example
```

---

## 🐳 Docker

```dockerfile
FROM node:20-slim

WORKDIR /app

COPY package*.json ./
RUN npm install --production

COPY . .

EXPOSE 13000

CMD ["node", "server.js"]
```

---

## 💡 Why I Built This

Most recommendation systems require users to:

* Know exactly what they're looking for
* Use complex filters
* Be familiar with categories and tags

I usually don't know what I want to play or watch. I just want something that "feels right."

So I built this.

---

## 🤝 Contributing

This is a passion project with plenty of room for improvement.

If you find:

* Search results could be more accurate
* Recommendation reasons could be better
* Data is missing or incorrect
* UI/UX could be improved
* You have a feature idea

Feel free to submit:

* Issue
* Pull Request
* Discussion
* Feedback

Any suggestion, complaint, idea, or even a simple usage experience can help make the project better.

If this project helped you find a game you enjoy or a movie worth watching, feel free to give it a "Star ⭐".

Your support and feedback are the biggest motivation for keeping this project alive.

Thanks for checking it out. Looking forward to hearing from you, and welcome to help make JustRight even better.

---

## License

MIT
