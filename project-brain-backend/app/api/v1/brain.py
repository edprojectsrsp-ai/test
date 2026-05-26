import os
from typing import Any, Optional

import httpx
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.core.config import settings

router = APIRouter(prefix="/brain", tags=["Brain"])


class ChatRequest(BaseModel):
    message: str
    context: str


@router.post("/chat")
def ask_project_brain(request: ChatRequest):
    try:
        # OpenAI uses a slightly different message structure (system prompts vs user prompts)
        response = client.chat.completions.create(
            model="gpt-4o-mini",  # You can upgrade to "gpt-4o" for heavier reasoning
            messages=[
                {
                    "role": "system",
                    "content": f"You are 'Project Brain', an AI assistant for a construction management system. Current Screen Context: {request.context}. Keep your answer concise, professional, and directly related to the context provided.",
                },
                {
                    "role": "user",
                    "content": request.message,
                },
            ],
        )
        # Extract the text from the OpenAI response object
        return {"reply": response.choices[0].message.content}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
