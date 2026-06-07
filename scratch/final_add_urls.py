import json
import glob
import re
import os

def extract_url_from_text(text):
    # 1. Look for explicit http/https URLs
    url_match = re.search(r'https?://[^\s<>"]+[a-zA-Z0-9/]', text)
    if url_match:
        return url_match.group(0)
    
    # 2. Look for DOI
    doi_match = re.search(r'10\.\d{4,9}/[-._;()/:a-zA-Z0-9]+', text)
    if doi_match:
        doi = doi_match.group(0).rstrip('.')
        # Clean up trailing punctuation often caught in regex
        doi = re.sub(r'[,;.\s]+$', '', doi)
        return f"https://doi.org/{doi}"
    
    # 3. Look for arXiv
    arxiv_match = re.search(r'(?:arXiv:)?(\d{4}\.\d{4,5})', text)
    if arxiv_match:
        arxiv_id = arxiv_match.group(1)
        return f"https://arxiv.org/abs/{arxiv_id}"
    
    return None

json_files = glob.glob('/home/emil/projects/cit-tooltips/annotations/*.json')

for json_file in json_files:
    print(f"Processing {json_file}...")
    with open(json_file, 'r') as f:
        data = json.load(f)
    
    updated_count = 0
    for item in data:
        # If url is already set, skip unless it's null
        if item.get('url'):
            continue
            
        # Try to extract from raw text
        url = extract_url_from_text(item.get('raw', ''))
        
        # If not in raw, but we have doi or eprint fields
        if not url:
            if item.get('doi'):
                doi = item['doi']
                if not doi.startswith('http'):
                    url = f"https://doi.org/{doi}"
                else:
                    url = doi
            elif item.get('eprint'):
                eprint = item['eprint']
                if 'arxiv' in eprint.lower() or re.match(r'\d{4}\.\d{4,5}', eprint):
                    arxiv_id = re.search(r'\d{4}\.\d{4,5}', eprint)
                    if arxiv_id:
                        url = f"https://arxiv.org/abs/{arxiv_id.group(0)}"
        
        if url:
            item['url'] = url
            updated_count += 1
            
    print(f"Updated {updated_count} items in {json_file}")
    
    with open(json_file, 'w') as f:
        json.dump(data, f, indent=4)
