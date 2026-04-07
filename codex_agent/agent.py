"""
Codex AI - Expert Coding Agent
Modularized Supervisor Agent
"""

import os
from google.adk.agents import Agent

# Import tools and prompt loader from our centralized tools module
from codex_agent.tools import analyze_code, explain_code, load_prompt

# Import specialized sub-agents from their new dedicated directories
from codex_agent.sub_agents.coding_agent.coding_agent import coding_agent
from codex_agent.sub_agents.debug_agent.debug_agent import debug_agent
from codex_agent.sub_agents.devops_agent.devops_agent import devops_agent
from codex_agent.sub_agents.docs_agent.docs_agent import docs_agent

GEMINI_MODEL_NAME = "gemini-2.5-flash"

# ─── PRIMARY AGENT (SUPERVISOR) ───────────────────────────────────────────────

root_agent = Agent(
    model=GEMINI_MODEL_NAME,
    name="codex_agent",
    description="Project coordinator and supervisor.",
    instruction=load_prompt("primary_agent.md"),
    sub_agents=[coding_agent, debug_agent, devops_agent, docs_agent],
    tools=[analyze_code, explain_code],
)
