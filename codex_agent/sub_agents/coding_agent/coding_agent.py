from google.adk.agents import Agent
from codex_agent.tools import execute_python, analyze_code, format_code, load_prompt

GEMINI_MODEL_NAME = "gemini-2.5-flash"

coding_agent = Agent(
    model=GEMINI_MODEL_NAME,
    name="coding_agent",
    description="Writes high-quality, production-ready code.",
    instruction=load_prompt("coding_agent.md", "You are the Coding Agent. Write high-quality, production-ready code with clear inline comments. Follow best practices and design patterns. Always prioritize readability, performance, and scalability."),
    tools=[execute_python, analyze_code, format_code],
)
