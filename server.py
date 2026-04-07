import os
import sqlite3
import uvicorn
from fastapi import FastAPI, Request
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from typing import List, Optional
import json

# Load environment variables from .env FIRST (before any ADK imports)
from dotenv import load_dotenv
env_loaded = load_dotenv()

# Verify API Key
api_key = os.getenv("GOOGLE_API_KEY")
if not api_key:
    print("⚠️ WARNING: GOOGLE_API_KEY not found in environment!")
else:
    print(f"✅ API Key loaded (Prefix: {api_key[:8]}...)")

# ─────────────────────────── CONFIGURATION ───────────────────────────────────

PROJECT_ROOT = os.path.dirname(os.path.abspath(__file__))
ui_dir = os.path.join(PROJECT_ROOT, "ui")
DB_DIR = os.path.join(PROJECT_ROOT, "database")
DB_FILE = os.path.join(DB_DIR, "chat_history.db")

os.makedirs(DB_DIR, exist_ok=True)

# ─────────────────────────── DATABASE ────────────────────────────────────────

def init_db():
    conn = sqlite3.connect(DB_FILE)
    cursor = conn.cursor()
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS cx_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id TEXT NOT NULL,
            role TEXT NOT NULL,
            content TEXT NOT NULL,
            agent_name TEXT,
            files TEXT,
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS cx_sessions (
            session_id TEXT PRIMARY KEY,
            title TEXT,
            last_updated DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    conn.commit()
    conn.close()

init_db()

def save_to_db(session_id, role, content, agent_name=None, files=None):
    try:
        conn = sqlite3.connect(DB_FILE)
        cursor = conn.cursor()
        cursor.execute('SELECT title FROM cx_sessions WHERE session_id = ?', (session_id,))
        if not cursor.fetchone():
            title = (content[:40] + '...') if len(content) > 40 else (content or "New Chat")
            cursor.execute('INSERT INTO cx_sessions (session_id, title) VALUES (?, ?)', (session_id, title))
        else:
            cursor.execute('UPDATE cx_sessions SET last_updated = CURRENT_TIMESTAMP WHERE session_id = ?', (session_id,))
        cursor.execute('INSERT INTO cx_history (session_id, role, content, agent_name, files) VALUES (?, ?, ?, ?, ?)',
                       (session_id, role, content, agent_name, files))
        conn.commit()
        conn.close()
    except Exception as e:
        print(f"DB Error: {e}")

# ─────────────────────────── APP SETUP ───────────────────────────────────────

from google.adk.cli.fast_api import get_fast_api_app
from codex_agent.agent import root_agent

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ─────────────────────────── HELPERS ──────────────────────────────────────────
def safe_model_map(model_name: str) -> str:
    """Translates UI model names to valid Gemini technical IDs (2026 version)."""
    if not model_name: return "gemini-2.5-flash"
    m = model_name.lower().replace("models/", "")
    if "2.5-pro" in m: return "gemini-2.5-pro"
    if "2.5-flash" in m: return "gemini-2.5-flash"
    if "3.1-flash" in m: return "gemini-3.1-flash"
    return m

# ─────────────────────────── MODELS ──────────────────────────────────────────

class RunRequest(BaseModel):
    appName: str
    userId: str
    sessionId: str
    model: str
    newMessage: dict

# ─────────────────────────── ROUTES ──────────────────────────────────────────

@app.get("/api/sessions")
async def get_sessions():
    conn = sqlite3.connect(DB_FILE)
    conn.row_factory = sqlite3.Row
    rows = conn.execute('SELECT * FROM cx_sessions ORDER BY last_updated DESC').fetchall()
    conn.close()
    return [dict(r) for r in rows]

@app.get("/api/history/{session_id}")
async def get_history(session_id: str):
    conn = sqlite3.connect(DB_FILE)
    conn.row_factory = sqlite3.Row
    rows = conn.execute('SELECT * FROM cx_history WHERE session_id = ? ORDER BY id ASC', (session_id,)).fetchall()
    conn.close()
    return [dict(r) for r in rows]

@app.post("/api/history/add")
async def add_history(item: dict):
    save_to_db(
        item.get('session_id', 'default'),
        item.get('role', 'user'),
        item.get('content', ''),
        item.get('agent_name'),
        files=item.get('files')
    )
    return {"status": "success"}

@app.delete("/api/history/{session_id}")
async def delete_history(session_id: str):
    conn = sqlite3.connect(DB_FILE)
    conn.execute('DELETE FROM cx_history WHERE session_id = ?', (session_id,))
    conn.execute('DELETE FROM cx_sessions WHERE session_id = ?', (session_id,))
    conn.commit()
    conn.close()
    return {"status": "success"}

@app.post("/api/history/truncate")
async def truncate_history(data: dict):
    session_id = data.get('session_id')
    keep_count = data.get('keep_count', 0)
    if not session_id:
        return {"error": "Missing session_id"}
    conn = sqlite3.connect(DB_FILE)
    # Get the ID at the keep_count index to truncate after it
    cursor = conn.execute('SELECT id FROM cx_history WHERE session_id = ? ORDER BY id ASC LIMIT 1 OFFSET ?', (session_id, keep_count))
    row = cursor.fetchone()
    if row:
        target_id = row[0]
        conn.execute('DELETE FROM cx_history WHERE session_id = ? AND id >= ?', (session_id, target_id))
    conn.commit()
    conn.close()
    return {"status": "success"}

@app.post("/api/history/clear")
async def clear_all_history():
    conn = sqlite3.connect(DB_FILE)
    conn.execute('DELETE FROM cx_history')
    conn.execute('DELETE FROM cx_sessions')
    conn.commit()
    conn.close()
    return {"status": "success"}

@app.post("/run")
async def run_agent(request: RunRequest):
    from google.adk.runners import Runner
    from google.adk.sessions import InMemorySessionService
    from google.genai import types as genai_types

    # Handle both 'content' string and 'parts' list from frontend
    input_text = request.newMessage.get("content")
    if not input_text:
        parts = request.newMessage.get("parts", [])
        input_text = " ".join([p.get("text", "") for p in parts if isinstance(p, dict)])

    # Ensure model compatibility (Map futuristic technical IDs to real ones)
    actual_model = safe_model_map(request.model)

    # Propagate to agent and sub-agents
    root_agent.model = actual_model
    if hasattr(root_agent, 'sub_agents') and root_agent.sub_agents:
        for sa in root_agent.sub_agents:
            sa.model = actual_model

    # Build ADK Runner with auto session creation
    session_service = InMemorySessionService()
    runner = Runner(
        agent=root_agent,
        app_name=request.appName,
        session_service=session_service,
        auto_create_session=True,
    )

    # Build the message in ADK Content format
    new_message = genai_types.Content(
        role="user",
        parts=[genai_types.Part(text=input_text)]
    )

    async def event_generator():
        full_response = ""
        # Safety check for API key inside the generator
        api_key = os.getenv("GOOGLE_API_KEY")
        if not api_key:
            yield "\n[Error: GOOGLE_API_KEY is missing in .env or environment!]"
            return

        active_agent = "Codex"
        
        try:
            async for event in runner.run_async(
                user_id=request.userId,
                session_id=request.sessionId,
                new_message=new_message,
            ):
                if event.content and event.content.parts:
                    for part in event.content.parts:
                        # 1. Advanced Agent Detection (Internal ADK property for stream ownership)
                        event_agent = getattr(event, 'agent', None)
                        if event_agent and hasattr(event_agent, 'name'):
                            name = event_agent.name
                            if name != active_agent:
                                active_agent = name
                                if "codex_agent" not in name:
                                    # Extract specialist name part (e.g. coding from coding_agent)
                                    cls_part = name.replace("_agent", "")
                                    pill = f'<div class="tool-call-pill pill-{cls_part}"><span class="tool-pill-dot"></span>{name}</div>'
                                    full_response += pill
                                    yield pill

                        # 2. Direct Function Call Interception (Delegation triggers)
                        f_call = getattr(part, 'function_call', None)
                        if f_call:
                            call_name = f_call.name
                            if "agent" in call_name.lower():
                                cls_part = call_name.replace("_agent", "")
                                pill = f'<div class="tool-call-pill pill-{cls_part}"><span class="tool-pill-dot"></span>{call_name}</div>'
                                full_response += pill
                                yield pill

                        # 3. Regular text chunks
                        if hasattr(part, 'text') and part.text:
                            full_response += part.text
                            yield part.text

            if not full_response:
                yield "The Supervisor is delegating to specialized agents..."

            if full_response:
                save_to_db(request.sessionId, "agent", full_response, agent_name=active_agent)
        except Exception as e:
            err_msg = str(e)
            print(f"Agent Error: {err_msg}")
            # If it's the "must contain either output text" error, it means delegation failed
            if "model output must contain" in err_msg:
                yield "\n[Agent Delegation Error: The model provided an empty response. This often happens if sub-agent models are misconfigured. Retrying...]"
            else:
                yield f"\n[Error: {err_msg}]"

    return StreamingResponse(event_generator(), media_type="text/plain")

@app.post("/api/model")
async def set_model(data: dict):
    model = data.get("model")
    actual_model = safe_model_map(model)
    root_agent.model = actual_model
    # Propagate model choice to all specialized sub-agents
    if hasattr(root_agent, 'sub_agents') and root_agent.sub_agents:
        for sa in root_agent.sub_agents:
            sa.model = actual_model
    return {"status": "success", "model": model, "actual_model": actual_model}

# ── STATIC FILES (LAST) ──────────────────────────────────────

app.mount("/ui", StaticFiles(directory=ui_dir), name="ui")
app.mount("/", StaticFiles(directory=ui_dir, html=True), name="static")

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000)
