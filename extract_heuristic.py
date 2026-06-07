import os
import fitz
import re
import json

def extract_references_text(pdf_path):
    doc = fitz.open(pdf_path)
    full_text = ""
    for page in doc:
        full_text += page.get_text("text")

    # Find where References start
    match = re.search(r'\n(References|Bibliography)\s*\n', full_text, re.IGNORECASE)
    if match:
        refs_text = full_text[match.end():]
        # Clean up common PDF artifact noise like page numbers or headers
        refs_text = re.sub(r'\n\s*\d+\s*\n', '\n', refs_text)
        return refs_text
    
    # Fallback heuristic
    return full_text[int(len(full_text)*0.85):]

def chunk_references(refs_text):
    # Try bracketed numbers e.g. [1] ... [2]
    bracket_pattern = r'(\[\d+\][ \t]+.*?)(?=\[\d+\]|\Z)'
    bracket_matches = re.findall(bracket_pattern, refs_text, re.DOTALL)
    if len(bracket_matches) > 5:
        return [m.strip().replace('\n', ' ') for m in bracket_matches]

    # Try numbered e.g. 1. ... 2.
    numbered_pattern = r'(^\d+\.[ \t]+.*?)(?=^\d+\.|\Z)'
    numbered_matches = re.findall(numbered_pattern, refs_text, re.MULTILINE | re.DOTALL)
    if len(numbered_matches) > 5:
        return [m.strip().replace('\n', ' ') for m in numbered_matches]

    # Try name-date styles (e.g. Author, A., & Author, B. (Year).)
    # Split by double newline or hanging indent
    blocks = re.split(r'\n\s*\n', refs_text)
    clean_blocks = []
    for block in blocks:
        block = block.strip()
        if len(block) > 20:
            clean_blocks.append(block.replace('\n', ' '))
    return clean_blocks

def extract_fields(ref_string):
    """
    Very basic heuristic extraction for standard fields: author, year, title, venue
    """
    fields = {"raw": ref_string}
    
    # Year: look for (YYYY) or just YYYY
    year_match = re.search(r'\(?(19|20\d{2})\)?', ref_string)
    if year_match:
        fields['year'] = year_match.group(1)
        
    # Venue: look for common conferences/journals
    venues = ['NeurIPS', 'ICLR', 'CVPR', 'ICML', 'ACL', 'EMNLP', 'NAACL', 'ECCV', 'KDD', 'AAAI', 'JMLR', 'arXiv', 'Nature', 'Science']
    for v in venues:
        if v.lower() in ref_string.lower():
            fields['venue_heuristic'] = v
            break
            
    # Try to split author and title roughly based on year or periods
    parts = re.split(r'\.\s+|\(\d{4}\)', ref_string)
    if len(parts) > 1:
        # Assuming the first part is likely authors
        author_cand = parts[0]
        # remove leading brackets like [1]
        author_cand = re.sub(r'^\[\d+\]\s*', '', author_cand).strip()
        fields['author'] = author_cand
        
        # Second part might be title
        if len(parts) > 2:
             fields['title'] = parts[1].strip().strip('"').strip("'")
             
    # arXiv ID
    arxiv_match = re.search(r'arxiv:(\d{4}\.\d{4,5})', ref_string, re.IGNORECASE)
    if arxiv_match:
        fields['arxiv_id'] = arxiv_match.group(1)
        
    return fields

def process_pdfs(directory):
    output_dir = os.path.join(directory, "raw_annotations")
    os.makedirs(output_dir, exist_ok=True)

    pdf_files = [f for f in os.listdir(directory) if f.endswith(".pdf")]

    for pdf_file in pdf_files:
        print(f"Processing {pdf_file}...")
        pdf_path = os.path.join(directory, pdf_file)
        
        refs_text = extract_references_text(pdf_path)
        chunks = chunk_references(refs_text)
        
        parsed_refs = []
        for chunk in chunks:
            parsed_refs.append(extract_fields(chunk))
        
        base_name = os.path.splitext(pdf_file)[0]
        output_file = os.path.join(output_dir, f"{base_name}_refs.json")
        
        with open(output_file, 'w', encoding='utf-8') as f:
            json.dump({
                "paper": pdf_file,
                "total_references": len(parsed_refs),
                "references": parsed_refs
            }, f, indent=4)
        print(f"Saved {len(parsed_refs)} references to {output_file}")

if __name__ == "__main__":
    process_pdfs(".")
