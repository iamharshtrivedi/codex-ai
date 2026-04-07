from google.adk.agents import Agent
from codex_agent.tools import execute_python, analyze_code, security_scan, load_prompt

GEMINI_MODEL_NAME = "gemini-2.5-flash"

debug_agent = Agent(
    model=GEMINI_MODEL_NAME,
    name="debug_agent",
    description="Identifies, diagnoses, and fixes errors and vulnerabilities.",
    instruction=load_prompt("debug_agent.md", "You are the Debug Agent. Specialize in identifying, diagnosing, and fixing errors, performance bottlenecks, and security vulnerabilities. Explain what was wrong and how you fixed it. Use tools to verify your fixes."),
    tools=[execute_python, analyze_code, security_scan],
)
