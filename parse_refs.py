import json
import re
import sys

def parse_ref(raw):
    # Removing [1], [2] at the start
    text = re.sub(r'^\[\d+\]\s+', '', raw)
    
    # We want to extract author, title, venue, year, arxiv_id
    
    # Author is up to the first ". " where the previous char is not a single uppercase letter
    # Or just use the fact that title usually follows
    
    # A generic regex for: Authors. Title. Venue, Year.
    # Wait, some titles have question marks, like "[16] ... Can active memory replace attention? In Advances..."
    # So we split by ". " or "? "
    
    parts = []
    current_part = ""
    for i in range(len(text)):
        current_part += text[i]
        if text[i] in ['.', '?'] and i + 1 < len(text) and text[i+1] == ' ':
            # check if it's an initial like "V. Le."
            if i > 0 and text[i-1].isupper() and (i < 2 or text[i-2] == ' '):
                continue
            if current_part.strip().endswith("et al."):
                continue
            # Also "Proc. of"
            if current_part.strip().endswith("Proc."):
                continue
            if current_part.strip() == "Inc.":
                continue
            
            parts.append(current_part.strip())
            current_part = ""
            # skip space
    if current_part:
        parts.append(current_part.strip())
        
    parts = [p for p in parts if p]
    
    author = ""
    title = ""
    venue = ""
    year = ""
    arxiv_id = ""
    
    # Last part usually contains year
    year_match = re.search(r'\b(19\d{2}|20\d{2})\b', text)
    if year_match:
        year = year_match.group(1)
        
    arxiv_match = re.search(r'arXiv:(\d{4}\.\d{4,5}(?:v\d+)?)', text)
    if not arxiv_match:
        arxiv_match = re.search(r'abs/(\d{4}\.\d{4,5})', text)
    if arxiv_match:
        arxiv_id = arxiv_match.group(1)

    if len(parts) >= 3:
        author = parts[0]
        if author.endswith('.'): author = author[:-1]
        title = parts[1]
        if title.endswith('.'): title = title[:-1]
        venue = " ".join(parts[2:])
        # remove year from venue if it ends with it
        venue = re.sub(r',\s*(19\d{2}|20\d{2})\.?$', '', venue)
        venue = re.sub(r'\.?\s*(19\d{2}|20\d{2})\.?$', '', venue)
        if venue.endswith('.'): venue = venue[:-1]
    elif len(parts) == 2:
        author = parts[0]
        if author.endswith('.'): author = author[:-1]
        title = parts[1]
        if title.endswith('.'): title = title[:-1]
    else:
        author = text
        
    return {
        "raw": raw,
        "author": author,
        "title": title,
        "venue": venue,
        "year": year,
        "arxiv_id": arxiv_id
    }

with open("raw_annotations/2017_Attention_Is_All_You_Need_refs.json", "r") as f:
    data = json.load(f)

for ref in data["references"]:
    parsed = parse_ref(ref["raw"])
    for k in ["author", "title", "venue", "year", "arxiv_id"]:
        if parsed.get(k):
            ref[k] = parsed[k]
        else:
            if k in ref:
                del ref[k]

with open("raw_annotations/2017_Attention_Is_All_You_Need_refs.json.tmp", "w") as f:
    json.dump(data, f, indent=4)

