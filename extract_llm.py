import os
import fitz
import re
import json
import time
from google import genai
from google.genai import types
from pydantic import BaseModel, Field

# Ensure API key is set
if not os.environ.get("GEMINI_API_KEY"):
    print("Error: GEMINI_API_KEY environment variable not set.")
    exit(1)

client = genai.Client()

class Reference(BaseModel):
    raw: str = Field(description="The complete original text of the reference from the paper.")
    author: str = Field(description="List of authors exactly as written.")
    title: str = Field(description="Title of the referenced paper/book.")
    year: str = Field(description="Year of publication.")
    venue: str | None = Field(default=None, description="Conference, journal, or publisher.")
    url: str | None = Field(default=None, description="URL or arXiv link if present.")

class ReferenceList(BaseModel):
    references: list[Reference] = Field(description="A list of all parsed references.")

def extract_references_text(pdf_path):
    try:
        doc = fitz.open(pdf_path)
    except Exception as e:
        print(f"Failed to open {pdf_path}: {e}")
        return ""
        
    full_text = ""
    for page in doc:
        full_text += page.get_text("text")

    # Better heuristic for finding references block
    match = re.search(r'\n(References|Bibliography|REFERENCES)\s*\n', full_text)
    if match:
        return full_text[match.end():]
    
    # Fallback to last 15%
    return full_text[int(len(full_text)*0.85):]

def process_pdfs(directory):
    output_dir = os.path.join(directory, "raw_annotations")
    os.makedirs(output_dir, exist_ok=True)

    pdf_files = [f for f in os.listdir(directory) if f.endswith(".pdf")]

    for pdf_file in pdf_files:
        output_file = os.path.join(output_dir, f"{os.path.splitext(pdf_file)[0]}_refs.json")
        # if os.path.exists(output_file):
        #    print(f"Skipping {pdf_file}, already parsed.")
        #    continue
            
        print(f"Processing {pdf_file}...")
        pdf_path = os.path.join(directory, pdf_file)
        
        refs_text = extract_references_text(pdf_path)
        if not refs_text.strip():
            print(f"Could not extract text from {pdf_file}")
            continue

        # Clean up some common PDF garbage to help LLM context limit
        refs_text = re.sub(r'\n\s*\d+\s*\n', '\n', refs_text)  # Remove stray page numbers
        refs_text = refs_text[:120000] # Limit to 120k chars just in case

        prompt = f"""
        You are a bibliographic expert. Below is the raw text of the References section from a machine learning paper. 
        Extract EVERY reference into a structured JSON array using the standard BibTeX-like fields.
        Crucially, preserve the original formatting of the authors exactly as written in the raw text.
        
        Text to parse:
        {refs_text}
        """

        try:
            response = client.models.generate_content(
                model='gemini-2.5-flash',
                contents=prompt,
                config=types.GenerateContentConfig(
                    response_mime_type="application/json",
                    response_schema=ReferenceList,
                ),
            )
            
            # Save the JSON
            parsed_data = json.loads(response.text)
            
            with open(output_file, 'w', encoding='utf-8') as f:
                json.dump({
                    "paper": pdf_file,
                    "total_references": len(parsed_data.get('references', [])),
                    "references": parsed_data.get('references', [])
                }, f, indent=4)
                
            print(f"Saved {len(parsed_data.get('references', []))} references to {output_file}")
            
            # Small sleep to respect rate limits
            time.sleep(2)
            
        except Exception as e:
            print(f"Error calling Gemini for {pdf_file}: {e}")

if __name__ == "__main__":
    process_pdfs(".")
