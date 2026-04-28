import os
from dotenv import load_dotenv
import anthropic

load_dotenv()

client = anthropic.Anthropic(
    api_key=os.environ.get("ANTHROPIC_API_KEY")
)

def process_with_claude(user_message: str) -> str:
    # add json tools here in the future
    response = client.messages.create(
        model="claude-3-5-sonnet-20241022",
        max_tokens=1024,
        system="You are an elite Executive Assistant to the CEO of a fast-growing supplement retail chain.",
        messages=[
            {"role": "user", "content": user_message}
        ]
    )
    return response.content[0].text