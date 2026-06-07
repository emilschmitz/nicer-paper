import os
import fitz  # PyMuPDF
import re
import json

def extract_references_section(pdf_path):
    """
    Attempts to extract the References section from a PDF.
    This is a heuristic approach: it searches backwards for "References" or "Bibliography"
    and grabs text from there to the end.
    """
    try:
        doc = fitz.open(pdf_path)
    except Exception as e:
        print(f"Error opening {pdf_path}: {e}")
        return ""

    full_text = ""
    for page in doc:
        full_text += page.get_text("text")

    # Try to find the start of the references section.
    # Looking for 'References' usually at the end of the paper on a line by itself or heading.
    match = re.search(r'\n(References|Bibliography)\s*\n', full_text, re.IGNORECASE)
    
    if match:
        refs_text = full_text[match.end():]
        return refs_text
    else:
        # Fallback: Just return the last 15% of the text, assuming references are there.
        # This is very rough and prone to error.
        print(f"Warning: Could not clearly identify 'References' header in {pdf_path}")
        cutoff = int(len(full_text) * 0.85)
        return full_text[cutoff:]

def parse_references(refs_text):
    """
    Attempts to split the monolithic references text into individual references.
    This is highly heuristic since formats vary wildly (e.g., [1], [2] vs author-year).
    """
    
    # Try bracketed numbers e.g. [1] ... [2] ...
    bracket_pattern = r'(\[\d+\][ \t]+.*?)(?=\[\d+\]|\Z)'
    bracket_matches = re.findall(bracket_pattern, refs_text, re.DOTALL)
    
    if len(bracket_matches) > 5:
        # Assuming bracketed style
        refs = [m.strip() for m in bracket_matches]
        return refs

    # Try numbered without brackets e.g. 1. ... 2. ...
    numbered_pattern = r'(^\d+\.[ \t]+.*?)(?=^\d+\.|\Z)'
    numbered_matches = re.findall(numbered_pattern, refs_text, re.MULTILINE | re.DOTALL)
    if len(numbered_matches) > 5:
        return [m.strip() for m in numbered_matches]

    # If no clear numbering scheme, we'll try splitting by double newlines or hanging indents,
    # but for a basic script, we might just return the whole text as one chunk to be manually or better parsed later.
    # For now, just split by double newline as a best guess for unnumbered Author-Year styles
    blocks = re.split(r'\n\s*\n', refs_text)
    blocks = [b.strip() for b in blocks if len(b.strip()) > 10]
    return blocks

def process_pdfs(directory):
    output_dir = os.path.join(directory, "raw_annotations")
    os.makedirs(output_dir, exist_ok=True)

    pdf_files = [f for f in os.listdir(directory) if f.endswith(".pdf")]

    for pdf_file in pdf_files:
        print(f"Processing {pdf_file}...")
        pdf_path = os.path.join(directory, pdf_file)
        
        refs_text = extract_references_section(pdf_path)
        if not refs_text:
            continue
            
        individual_refs = parse_references(refs_text)
        
        # Create output file
        base_name = os.path.splitext(pdf_file)[0]
        output_file = os.path.join(output_dir, f"{base_name}_refs.json")
        
        # Save raw references
        with open(output_file, 'w', encoding='utf-8') as f:
            json.dump({
                "paper": pdf_file,
                "total_references_found": len(individual_refs),
                "raw_references": individual_refs
            }, f, indent=4)
        print(f"Saved {len(individual_refs)} raw references to {output_file}")

if __name__ == "__main__":
    process_pdfs(".")
