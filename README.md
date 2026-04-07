# Codex AI — Expert Coding Agent
### Built with Google ADK · Python · Gemini Flash/Pro · Fast API

A production-ready AI coding agent with a **modular multi-agent architecture**, **live code execution**, **file uploads**, and a Gemini-inspired dark UI. This project uses a specialized team of autonomous sub-agents coordinated by a central Primary Supervisor.

---

## 🏗️ Project Architecture

Codex AI is built as a modular Python package for maximum scalability and maintainability.

```text
codex-ai/
├── codex_agent/             # Core Agent Package
│   ├── sub_agents/         # Specialist Agent Modules
│   │   ├── coding_agent/   # Writes & executes production code
│   │   │   ├── coding_agent.py
│   │   │   └── coding_agent.md
│   │   ├── debug_agent/    # Bug hunting & security analysis
│   │   │   ├── debug_agent.py
│   │   │   └── debug_agent.md
│   │   ├── devops_agent/   # CI/CD & infrastructure logic
│   │   │   ├── devops_agent.py
│   │   │   └── devops_agent.md
│   │   └── docs_agent/     # Technical documentation generator
│   │       ├── docs_agent.py
│   │       └── docs_agent.md
│   ├── agent.py            # Primary Supervisor (Orchestration logic)
│   ├── primary_agent.md    # Supervisor instructions & persona
│   ├── tools.py            # Centralized Toolbox (Execution, Analysis, Security)
│   └── __init__.py
├── database/
│   └── chat_history.db      # Persisted Chat History (SQLite)
├── ui/                     # High-Performance Frontend
│   ├── index.html          # Core layout & structure
│   ├── style.css           # Premium dark-mode styling
│   └── app.js              # Real-time state & API integration
├── tests/                  # Automated Test Suite
│   └── test_server.py      # Backend & API endpoint validation
├── server.py               # FastAPI Production Entry Point
├── requirements.txt        # Core Dependencies
├── Dockerfile              # Cloud Run & Containerization Ready
└── .env                     # API Keys & Configuration (local only)
```

---

## 🤖 The Expert Team

| Agent | Specialty | Mandate |
|-------|-----------|---------|
| **Supervisor** | Orchestration | High-level goal planning and agent delegation. |
| **Coding** | Production Code | Writing clean, optimized, and DRY logic. |
| **Debug** | Bug Hunting | Error analysis, security scanning, and logic fixes. |
| **DevOps** | Infrastructure | Docker, CI/CD, and deployment automation. |
| **Docs** | Communication | API reference, READMEs, and technical documentation. |

---

## 🛠️ Performance Tools

All sub-agents have access to a centralized suite of specialized Python tools:

*   **`execute_python`**: Runs code in a sandboxed subprocess with real-time output and security blocks.
*   **`analyze_code`**: Multi-language syntax, style, and readability analysis (Python, JS/TS).
*   **`security_scan`**: Scans for 17+ vulnerability patterns including injection and hardcoded secrets.
*   **`explain_code`**: Structural decomposition found in functions, classes, and logic across languages.
*   **`generate_tests`**: Boilerplate unit test generation (Pytest/Unittest) for Python functions.
*   **`format_code`**: Normalizes whitespace and ensures project-wide style consistency.

---

## 🚀 Quick Start

### 1. Environment Setup
```bash
# Create and activate virtual environment
python -m venv .venv
.venv\Scripts\activate  # Windows
source .venv/bin/activate  # macOS/Linux

# Install elite dependencies
pip install -r requirements.txt
```

### 2. Configuration
Create a `.env` file in the root directory:
```env
# Gemini API Key (https://aistudio.google.com/app/apikey)
GOOGLE_API_KEY=your_key_here
```

### 3. Launch
```bash
# Start the FastAPI backend
python server.py
```
> **Pro Tip:** If you see `database is locked`, ensure only one terminal is running `server.py`. SQLite supports only one writing process at a time.

### 4. Connect
Open `ui/index.html` in your browser. Click the **⚡ FLASH** badge in the sidebar, set the Server URL to `http://127.0.0.1:8000`, and hit **Connect**.

---

## 🎤 Voice & Multimodal
Codex AI supports **Voice Input** via the Google Cloud Speech-to-Text REST API. 
1. Enable the STT API in your Google Cloud Console.
2. Click the 🎤 mic icon in the UI and provide your Google API Key.
3. Chat naturally – your voice is converted to text in real-time.

---

## 🔒 Security
Every line of code written or analyzed by Codex is subjected to a non-bypassable security scan. We automatically detect:
- Arbitrary code execution (`eval`, `exec`).
- Shell injection (`os.system`, `subprocess` with `shell=True`).
- Hardcoded sensitive credentials (API Keys, Passwords).
- Cryptographic weaknesses (MD5, plain HTTP).

---

## ☁️ Cloud Deployment
Deploy to **Google Cloud Run** with one command using the provided `Dockerfile`. The SQLite database is local, but the system is engineered for easy migration to **Postgres** (see `server.py` for config).
