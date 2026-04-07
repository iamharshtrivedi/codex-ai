import os
from google import genai
from dotenv import load_dotenv

load_dotenv()
api_key = os.getenv("GOOGLE_API_KEY")
client = genai.Client(api_key=api_key)

try:
    with open("available_models.txt", "w") as f:
        f.write("Listing available models...\n")
        for model in client.models.list():
            f.write(f" - {model.name}\n")
    print("Done. Saved to available_models.txt")
except Exception as e:
    print(f"Error listing models: {e}")
