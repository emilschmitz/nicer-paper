import json
import os
import time
from google import genai
from google.genai import types
from pydantic import BaseModel, Field

# Ensure API key is set
if not os.environ.get("GEMINI_API_KEY"):
    token_path = ".gcloud_token"
    if os.path.exists(token_path):
        with open(token_path, "r") as f:
            os.environ["GEMINI_API_KEY"] = f.read().strip()
    else:
        print("No GEMINI_API_KEY found.")

client = genai.Client()

class Reference(BaseModel):
    author: str = Field(description="List of authors exactly as written in the raw text.")
    title: str = Field(description="Title of the referenced paper/book.")
    year: str = Field(description="Year of publication.")
    venue: str = Field(description="Conference, journal, publisher, or 'arXiv'.")
    arxiv_id: str | None = Field(default=None, description="arXiv ID if present.")

file_path = "raw_annotations/2016_You_Only_Look_Once_Unified,_Real-Time_Object_Detection_refs.json"

with open(file_path, "r") as f:
    data = json.load(f)

print(f"Loaded {len(data['references'])} references.")

for idx, ref in enumerate(data["references"]):
    raw_text = ref["raw"]
    
    prompt = f"""
    You are a bibliographic expert. Below is a raw reference string from a machine learning paper.
    Extract the standard fields (author, title, year, venue, arxiv_id) accurately.
    Crucially, preserve the original formatting of the authors exactly as written in the raw text. Do not include page numbers, volume, etc in the title or venue.

    Raw reference:
    {raw_text}
    """
    
    retries = 3
    while retries > 0:
        try:
            response = client.models.generate_content(
                model='gemini-2.5-flash',
                contents=prompt,
                config=types.GenerateContentConfig(
                    response_mime_type="application/json",
                    response_schema=Reference,
                ),
            )
            parsed_data = json.loads(response.text)
            
            ref["author"] = parsed_data.get("author", "")
            ref["title"] = parsed_data.get("title", "")
            ref["year"] = str(parsed_data.get("year", "")) if parsed_data.get("year") else ""
            ref["venue"] = parsed_data.get("venue", "")
            
            if parsed_data.get("arxiv_id"):
                ref["arxiv_id"] = parsed_data.get("arxiv_id")
            elif "arxiv_id" in ref:
                del ref["arxiv_id"]
                
            print(f"[{idx+1}/{len(data['references'])}] Parsed: {ref['title'][:40]}...")
            break
        except Exception as e:
            print(f"Error for {idx}: {e}")
            retries -= 1
            time.sleep(2)

with open(file_path, "w") as f:
    json.dump(data, f, indent=4)

print("Saved.")
