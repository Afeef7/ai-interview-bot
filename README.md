# MockMate

Intelligent real-time mock interview platform with AI feedback and emotion analytics.

---

## Project Structure

```
ai-interview-bot/
├── .env                     # Root environment variables (GEMINI_API_KEY, GEMINI_MODEL)
├── .gitignore               # Ignored files (.env, venv, node_modules, etc.)
├── README.md                # Project documentation and run commands
├── backend/
│   ├── venv/                # Python virtual environment
│   ├── main.py              # FastAPI application with CORS and /health
│   └── requirements.txt     # Backend dependencies
└── frontend/
    ├── public/
    │   └── web_model/       # TF.js emotion model assets (model.json & shards)
    ├── src/
    │   ├── App.jsx          # MockMate UI checking backend health
    │   ├── App.css          # UI styles
    │   ├── index.css        # Global CSS tokens and font imports
    │   └── main.jsx         # React DOM entrypoint
    ├── index.html           # HTML entrypoint
    ├── package.json
    └── vite.config.js
```

---

## Prerequisites

- **Python**: 3.10+ (Python 3.12 recommended)
- **Node.js**: 18+ (Node.js 20+ recommended) and `npm`

---

## Environment Configuration

Ensure a `.env` file exists in the **root** folder (`ai-interview-bot/.env`) with the following variables:

```env
GEMINI_API_KEY=your_gemini_api_key_here
GEMINI_MODEL=gemini-2.5-flash
```

> **Security Note:** Never commit `.env` to Git. The `.gitignore` is already configured to exclude it. The `/health` endpoint only reports whether the key is loaded and never reveals the actual key string.

---

## Running the Backend

### Windows (PowerShell)
```powershell
# 1. Navigate to backend directory
cd backend

# 2. Activate virtual environment
.\venv\Scripts\Activate.ps1

# 3. (Optional / first-time) Install dependencies:
# pip install -r requirements.txt

# 4. Start the FastAPI server with Uvicorn
uvicorn main:app --reload --host 127.0.0.1 --port 8000
```

### Windows (Command Prompt / cmd.exe)
```cmd
cd backend
.\venv\Scripts\activate.bat
uvicorn main:app --reload --host 127.0.0.1 --port 8000
```

### macOS / Linux
```bash
cd backend
source venv/bin/activate
uvicorn main:app --reload --host 127.0.0.1 --port 8000
```

Backend will be available at:
- **Health Check**: [http://localhost:8000/health](http://localhost:8000/health)
- **Swagger Docs**: [http://localhost:8000/docs](http://localhost:8000/docs)

---

## Running the Frontend

In a separate terminal window:

```bash
# 1. Navigate to frontend directory
cd frontend

# 2. (Optional / first-time) Install dependencies:
# npm install

# 3. Start Vite development server
npm run dev
```

The frontend will start at [http://localhost:5173](http://localhost:5173).

Open the URL in your browser to verify that MockMate connects to `http://localhost:8000/health` and shows the server status and API key configuration state.

---

## Emotion Model Assets

Place your TensorFlow.js emotion model files (`model.json` and associated binary shard files `group*-shard*of*.bin`) into:
```
frontend/public/web_model/
```
They will be served statically by Vite at `http://localhost:5173/web_model/model.json`.