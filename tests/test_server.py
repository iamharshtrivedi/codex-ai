import pytest
from fastapi.testclient import TestClient
import os
import sqlite3
import json
import shutil

# Import the app safely
from server import app, DB_FILE, init_db

client = TestClient(app)

@pytest.fixture(autouse=True, scope="module")
def setup_db():
    """Sets up a clean database for testing."""
    # Ensure we use a clean test DB file name to avoid collisions
    backup_db = DB_FILE + ".bak"
    if os.path.exists(DB_FILE):
        shutil.copy2(DB_FILE, backup_db)
        os.remove(DB_FILE)
    
    init_db() # Create tables in the new file
    
    yield
    
    # Cleanup after tests
    if os.path.exists(DB_FILE):
        os.remove(DB_FILE)
    if os.path.exists(backup_db):
        shutil.move(backup_db, DB_FILE)

def test_read_root():
    response = client.get("/")
    assert response.status_code == 200
    # Root should serve index.html, not error
    try:
        data = response.json()
        assert "error" not in data
    except:
        # If it's pure HTML, that's what we want
        assert response.headers["content-type"].startswith("text/html") or "html" in response.text.lower()

def test_api_sessions_empty():
    response = client.get("/api/sessions")
    assert response.status_code == 200
    assert response.json() == []

def test_api_model_switching():
    test_model = "gemini-3-pro"
    response = client.post("/api/model", json={"model": test_model})
    assert response.status_code == 200
    assert response.json()["status"] == "success"
    # Note: This updates the global root_agent.model in memory!

def test_api_add_history():
    session_id = "test_session_1"
    payload = {
        "session_id": session_id,
        "role": "user",
        "content": "Hello Codex!",
        "agent_name": "Primary"
    }
    response = client.post("/api/history/add", json=payload)
    assert response.status_code == 200
    assert response.json()["status"] == "success"
    
    # Verify retrieval
    history = client.get(f"/api/history/{session_id}").json()
    assert len(history) == 1
    assert history[0]["content"] == "Hello Codex!"

def test_api_truncate_history():
    session_id = "test_session_1"
    # Add second message
    client.post("/api/history/add", json={
        "session_id": session_id, "role": "agent", "content": "Hi!", "agent_name": "Primary"
    })
    
    # Truncate
    response = client.post("/api/history/truncate", json={
        "session_id": session_id, "keep_count": 1
    })
    assert response.status_code == 200
    
    history = client.get(f"/api/history/{session_id}").json()
    assert len(history) == 1
    assert history[0]["role"] == "user"

def test_api_delete_session():
    session_id = "test_session_1"
    response = client.delete(f"/api/history/{session_id}")
    assert response.status_code == 200
    
    sessions = client.get("/api/sessions").json()
    assert not any(s["session_id"] == session_id for s in sessions)
