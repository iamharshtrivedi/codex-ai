import pytest
import os
import sys
from unittest.mock import MagicMock, patch

# Ensure project root is in path
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from codex_agent.tools import analyze_code, explain_code, security_scan, load_prompt
from server import safe_model_map

# ─── TOOL TESTS ─────────────────────────────────────────────────────────────

def test_analyze_code_python_syntax_error():
    bad_code = "def oops(: print('hi')"
    result = analyze_code(bad_code, "python")
    assert result["status"] == "success" # Tools usually return success but with issues
    assert any("Syntax error" in issue for issue in result["issues"])

def test_analyze_code_style_issues():
    wide_code = "print('" + "A" * 130 + "')"
    result = analyze_code(wide_code, "python")
    assert any("exceeds 120 chars" in issue for issue in result["issues"])

def test_explain_code_detection():
    py_code = "import os\ndef main(): pass"
    result = explain_code(py_code)
    assert result["detected_language"] == "Python"
    
    js_code = "const x = () => console.log('hi');"
    result = explain_code(js_code)
    assert result["detected_language"] == "JavaScript/TypeScript"

def test_security_scan_vulnerabilities():
    unsafe = "eval(user_input)\nos.system('rm -rf /')"
    result = security_scan(unsafe)
    assert result["severity"] == "critical"
    messages = [f["message"] for f in result["findings"]]
    assert any("eval() executes arbitrary code" in m for m in messages)
    assert any("os.system() is vulnerable" in m for m in messages)

def test_load_prompt_fallback():
    # Test that it returns fallback if file is missing
    result = load_prompt("non_existent_file.md", "Fallback prompt")
    assert result == "Fallback prompt"

# ─── MODEL MAPPING TESTS ────────────────────────────────────────────────────

def test_safe_model_map_resolutions():
    assert safe_model_map("Gemini 2.5 Flash") == "gemini-2.5-flash"
    assert safe_model_map("gemini-3-pro") == "gemini-2.5-pro" # Based on our mapping logic in server.py
    assert safe_model_map(None) == "gemini-2.5-flash"
    assert safe_model_map("models/gemini-2.5-pro") == "gemini-2.5-pro"

# ─── AGENT INTEGRATION TESTS (MOCKED) ───────────────────────────────────────

@pytest.mark.asyncio
async def test_agent_swarm_initialization():
    from codex_agent.agent import root_agent
    assert root_agent.name == "codex_agent"
    assert len(root_agent.sub_agents) == 4
    
    # Check that specialist names are correctly set
    sub_names = [sa.name for sa in root_agent.sub_agents]
    assert "coding_agent" in sub_names
    assert "debug_agent" in sub_names
    assert "devops_agent" in sub_names
    assert "docs_agent" in sub_names

@pytest.mark.asyncio
async def test_server_run_endpoint_mocked():
    from server import app
    from fastapi.testclient import TestClient
    
    with patch("google.adk.runners.Runner.run_async") as mock_run:
        # Mocking an async generator
        async def mock_generator(*args, **kwargs):
            mock_event = MagicMock()
            mock_event.content.parts = [MagicMock(text="Mocked Response")]
            yield mock_event
            
        mock_run.return_value = mock_generator()
        
        with TestClient(app) as client:
            payload = {
                "appName": "test_app",
                "userId": "test_user",
                "sessionId": "test_session",
                "model": "gemini-2.5-flash",
                "newMessage": {"content": "Hello"}
            }
            # We use a POST request but since it's a StreamingResponse we need to iterate
            with client.stream("POST", "/run", json=payload) as response:
                assert response.status_code == 200
                chunks = [chunk.decode() for chunk in response.iter_raw()]
                assert any("Mocked Response" in chunk for chunk in chunks)
