from fastapi import FastAPI, Request
from agent import process_with_claude

app = FastAPI()

@app.get("/")
async def root():
    return {"status": "Agent is online."}

# This is a dummy endpoint. Later, Gmail or Slack will send data here.
@app.post("/webhook/test")
async def test_webhook(request: Request):
    payload = await request.json()
    incoming_text = payload.get("text", "")
    
    # Send the incoming text to our Claude agent
    agent_response = process_with_claude(incoming_text)
    
    return {"agent_response": agent_response}