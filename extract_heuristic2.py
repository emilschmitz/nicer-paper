import os
import fitz
import re
import json

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

def chunk_references(refs_text):
    # Remove common artifacts like pure page numbers on a line
    refs_text = re.sub(r'\n\s*\d+\s*\n', '\n', refs_text)
    
    # Check for Bracketed e.g., [1]
    bracket_matches = list(re.finditer(r'\[\d+\]', refs_text))
    if len(bracket_matches) > 10:
        chunks = []
        for i in range(len(bracket_matches)):
            start = bracket_matches[i].start()
            end = bracket_matches[i+1].start() if i + 1 < len(bracket_matches) else len(refs_text)
            chunks.append(refs_text[start:end].replace('\n', ' ').strip())
        return chunks

    # Check for Numbered e.g., 1.
    numbered_matches = list(re.finditer(r'(?:\n|^)\s*\d+\.\s', refs_text))
    if len(numbered_matches) > 10:
        chunks = []
        for i in range(len(numbered_matches)):
            start = numbered_matches[i].start()
            end = numbered_matches[i+1].start() if i + 1 < len(numbered_matches) else len(refs_text)
            chunks.append(refs_text[start:end].replace('\n', ' ').strip())
        return chunks

    # Fallback: Author-Year style (e.g. BERT, CLIP)
    # They don't have brackets or numbers.
    # They often have no empty lines between them.
    # We look for a line that starts with an Author (Capital letter) and contains a Year near the start.
    # A Year is usually 19XX or 20XX.
    
    lines = refs_text.split('\n')
    chunks = []
    current_chunk = []
    
    for line in lines:
        line_clean = line.strip()
        if not line_clean:
            continue
            
        # If line looks like the start of a new reference:
        # - Starts with capital letter
        # - Has a year (19.. or 20..) somewhere in the next few words/lines
        # - Previous chunk ended with a period or we're just relying on year matches
        
        # Let's use a simpler heuristic: look for a year. A reference usually has exactly one year.
        # But a reference spans multiple lines. The first line usually has authors, the second might have year.
        
        # Let's split by searching for years!
        pass
        
    # Another approach for Author-Year: 
    # Use re.split on occurrences of a new Author block. 
    # We can detect an Author block by finding Capitalized words followed by commas, and eventually a Year.
    # Actually, let's just use double-newlines if they exist.
    blocks = re.split(r'\n\s*\n', refs_text)
    clean_blocks = [b.strip().replace('\n', ' ') for b in blocks if len(b.strip()) > 20]
    if len(clean_blocks) > 10:
        return clean_blocks
        
    # If no double newlines (like BERT), we need a clever line-by-line aggregator
    current_ref = ""
    refs = []
    for line in lines:
        line = line.strip()
        if not line:
            continue
        # Does the previous line end with a period? And does this line start with a Capital?
        if current_ref and current_ref.endswith('.') and line[0].isupper() and len(re.findall(r'\b(?:19|20)\d{2}\b', current_ref)) > 0:
            refs.append(current_ref)
            current_ref = line
        else:
            if current_ref:
                current_ref += " " + line
            else:
                current_ref = line
    if current_ref:
        refs.append(current_ref)
        
    return [r for r in refs if len(r) > 20]

def extract_fields(ref_string):
    fields = {"raw": ref_string}
    
    year_match = re.search(r'\b(19\d{2}|20\d{2})\b', ref_string)
    if year_match:
        fields['year'] = year_match.group(1)
        
    # Venue
    venues = ['NeurIPS', 'ICLR', 'CVPR', 'ICML', 'ACL', 'EMNLP', 'NAACL', 'ECCV', 'KDD', 'AAAI', 'JMLR', 'arXiv', 'Nature', 'Science', 'CoRR', 'IEEE', 'ACM']
    for v in venues:
        if v.lower() in ref_string.lower():
            fields['venue'] = v
            break
            
    # Try to split by year to separate authors and title
    if year_match:
        parts = ref_string.split(year_match.group(1))
        if len(parts) >= 2:
            author_part = parts[0].strip(' .(),')
            author_part = re.sub(r'^\[\d+\]\s*|^\d+\.\s*', '', author_part)
            fields['author'] = author_part
            
            title_part = parts[1].strip(' .(),')
            # Extract up to the next period
            title_match = re.search(r'^([^\.]+)', title_part)
            if title_match:
                fields['title'] = title_match.group(1).strip()
    else:
        # Fallback split
        parts = re.split(r'\.\s+', ref_string, maxsplit=2)
        if len(parts) > 1:
            author_part = re.sub(r'^\[\d+\]\s*|^\d+\.\s*', '', parts[0]).strip()
            fields['author'] = author_part
            fields['title'] = parts[1].strip()

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
