from google.adk.agents import Agent
from codex_agent.tools import execute_python, load_prompt

GEMINI_MODEL_NAME = "gemini-2.5-flash"

devops_agent = Agent(
    model=GEMINI_MODEL_NAME,
    name="devops_agent",
    description="Handles CI/CD, Docker, and deployment configurations.",
    instruction=load_prompt("devops_agent.md", "You are the DevOps Agent. Handle CI/CD pipelines, Dockerization, deployment configurations, and infrastructure-as-code. Ensure the project is deployable and runs smoothly in production."),
    tools=[execute_python],
)
