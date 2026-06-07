import fitz
import json
import glob
import os
import difflib

# Find all JSON annotations
json_files = glob.glob('/home/emil/projects/cit-tooltips/annotations/*.json')

def get_best_match(target_text, candidates, threshold=0.8):
    best_match = None
    best_ratio = 0
    for cand in candidates:
        ratio = difflib.SequenceMatcher(None, target_text, cand['raw']).ratio()
        if ratio > best_ratio:
            best_ratio = ratio
            best_match = cand
    if best_ratio >= threshold:
        return best_match
    return None

for json_file in json_files:
    # Load JSON
    with open(json_file, 'r') as f:
        data = json.load(f)
    
    # Get corresponding PDF
    # The JSON has "source_paper" which is the PDF filename.
    if not data:
        continue
    pdf_filename = data[0]['source_paper']
    pdf_path = os.path.join('/home/emil/projects/cit-tooltips/pdfs', pdf_filename)
    
    if not os.path.exists(pdf_path):
        print(f"PDF not found for {json_file}: {pdf_path}")
        continue
        
    print(f"Processing {pdf_filename}...")
    doc = fitz.open(pdf_path)
    
    # Extract links and their corresponding blocks
    links_data = []
    for page in doc:
        links = page.get_links()
        blocks = page.get_text("blocks")
        
        for link in links:
            if 'uri' not in link:
                continue
            uri = link['uri']
            rect = fitz.Rect(link['from'])
            
            # Find intersecting blocks
            intersecting_text = ""
            for b in blocks:
                # b[0]-b[3] are the rect coordinates
                b_rect = fitz.Rect(b[:4])
                if rect.intersects(b_rect):
                    # b[4] is the text
                    intersecting_text += b[4] + " "
            
            if intersecting_text:
                clean_text = intersecting_text.replace('\n', ' ').strip()
                # remove multiple spaces
                clean_text = ' '.join(clean_text.split())
                links_data.append({'uri': uri, 'text': clean_text})
                
    # Match to JSON data
    matched_count = 0
    for link_info in links_data:
        best_match = get_best_match(link_info['text'], data)
        if best_match:
            # Only update if null or different
            if best_match['url'] != link_info['uri']:
                best_match['url'] = link_info['uri']
                matched_count += 1
                
    print(f"Matched {matched_count} URLs out of {len(links_data)} links found.")
    
    # Save JSON
    with open(json_file, 'w') as f:
        json.dump(data, f, indent=4)
