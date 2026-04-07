from google.adk.agents import Agent
from codex_agent.tools import explain_code, load_prompt

GEMINI_MODEL_NAME = "gemini-2.5-flash"

docs_agent = Agent(
    model=GEMINI_MODEL_NAME,
    name="docs_agent",
    description="Generates clear, comprehensive documentation.",
    instruction=load_prompt("docs_agent.md", "You are the Docs Agent. Generate clear, comprehensive documentation including READMEs, API references, and internal developer guides. Make complex systems easy to understand."),
    tools=[explain_code],
)
