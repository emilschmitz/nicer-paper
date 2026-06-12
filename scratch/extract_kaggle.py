import os
import json
import re
import urllib.request
from urllib.error import HTTPError
import time

DATASET_PATH = '/home/emil/.cache/kagglehub/datasets/mathurinache/citation-network-dataset/versions/1/dblp.v12.json'
PDF_DIR = 'pdfs'
ANN_DIR = 'annotations'

os.makedirs(PDF_DIR, exist_ok=True)
os.makedirs(ANN_DIR, exist_ok=True)

TARGET_COUNT = 120

def is_valid_pdf(arxiv_id):
    url = f"https://arxiv.org/pdf/{arxiv_id}.pdf"
    try:
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'}, method='HEAD')
        with urllib.request.urlopen(req) as response:
            return response.status == 200
    except HTTPError:
        return False
    except Exception:
        return False

def extract_arxiv_id(paper):
    text = json.dumps(paper)
    # Be more strict: must have arxiv somewhere near the ID, or in a URL
    matches = re.findall(r'(?:arxiv|abs/|pdf/)[:/\s]*(\d{4}\.\d{4,5}(?:v\d+)?)', text, re.IGNORECASE)
    for m in matches:
        return m
    
    matches_old = re.findall(r'([a-z\-]+/\d{7}(?:v\d+)?)', text, re.IGNORECASE)
    for m in matches_old:
        return m
        
    return None

def main():
    print("Pass 1: Finding valid arxiv papers...")
    
    selected_papers = []
    reference_ids = set()
    
    # Check how many we already have
    existing_count = len([f for f in os.listdir(PDF_DIR) if f.endswith('.pdf')])
    print(f"Already have {existing_count} PDFs.")
    
    with open(DATASET_PATH, 'r', encoding='utf-8') as f:
        for line in f:
            line = line.strip()
            if line.startswith(','):
                line = line[1:]
            if line.startswith('[') or line.startswith(']'):
                continue
            if not line:
                continue
            
            if 'arxiv' in line.lower():
                try:
                    paper = json.loads(line)
                    arxiv_id = extract_arxiv_id(paper)
                    if arxiv_id:
                        # Before doing HEAD request, check if we already have this ID in annotations
                        # This is a heuristic, but we just need 120 total.
                        title = paper.get('title', f'Unknown_{arxiv_id}')
                        clean_t = "".join(c if c.isalnum() else '_' for c in title)[:60].strip('_')
                        year = paper.get('year', '0000')
                        pdf_filename = f"{year}_{clean_t}.pdf"
                        
                        pdf_path = os.path.join(PDF_DIR, pdf_filename)
                        if os.path.exists(pdf_path):
                            # Already downloaded
                            selected_papers.append(paper)
                            refs = paper.get('references', [])
                            reference_ids.update(refs)
                            print(f"Already downloaded {len(selected_papers)}: {arxiv_id}")
                            continue

                        # Check if it's valid
                        if is_valid_pdf(arxiv_id):
                            selected_papers.append(paper)
                            refs = paper.get('references', [])
                            reference_ids.update(refs)
                            print(f"Found new valid {len(selected_papers)}: {arxiv_id}")
                            time.sleep(0.5) # respect rate limit
                        else:
                            pass
                            
                        if len(selected_papers) >= TARGET_COUNT:
                            break
                except json.JSONDecodeError:
                    continue

    print(f"Collected {len(selected_papers)} papers and {len(reference_ids)} reference IDs.")
    if len(selected_papers) == 0:
        return
        
    print("Pass 2: Extracting reference metadata...")
    resolved_references = {}
    
    with open(DATASET_PATH, 'r', encoding='utf-8') as f:
        for i, line in enumerate(f):
            if i % 1000000 == 0:
                print(f"Scanned {i} lines for references...")
                
            line = line.strip()
            if line.startswith(','):
                line = line[1:]
            if line.startswith('[') or line.startswith(']'):
                continue
            if not line:
                continue
                
            match = re.match(r'^\{"id":\s*(\d+)', line)
            if match:
                pid = int(match.group(1))
                if pid in reference_ids:
                    try:
                        paper = json.loads(line)
                        resolved_references[pid] = paper
                        if len(resolved_references) == len(reference_ids):
                            print("Found all references!")
                            break
                    except json.JSONDecodeError:
                        pass
    
    print(f"Resolved {len(resolved_references)} out of {len(reference_ids)} references.")
    
    print("Pass 3: Saving annotations and downloading PDFs...")
    success_count = 0
    
    for paper in selected_papers:
        arxiv_id = extract_arxiv_id(paper)
        title = paper.get('title', f'Unknown_{arxiv_id}')
        
        clean_t = "".join(c if c.isalnum() else '_' for c in title)[:60].strip('_')
        year = paper.get('year', '0000')
        
        pdf_filename = f"{year}_{clean_t}.pdf"
        json_filename = f"{year}_{clean_t}.json"
        
        pdf_path = os.path.join(PDF_DIR, pdf_filename)
        json_path = os.path.join(ANN_DIR, json_filename)
        
        bib_entries = {}
        for i, ref_id in enumerate(paper.get('references', [])):
            ref_paper = resolved_references.get(ref_id)
            if ref_paper:
                authors = [a.get('name') for a in ref_paper.get('authors', [])]
                venue = ref_paper.get('venue', {})
                if isinstance(venue, dict):
                    venue = venue.get('raw', '')
                bib_entries[f"BIBREF{i}"] = {
                    "title": ref_paper.get('title', ''),
                    "authors": authors,
                    "year": ref_paper.get('year'),
                    "venue": venue,
                    "link": f"https://api.semanticscholar.org/graph/v1/paper/{ref_paper.get('doi')}" if ref_paper.get('doi') else ""
                }
            else:
                bib_entries[f"BIBREF{i}"] = {
                    "title": f"Unknown Reference {ref_id}",
                    "authors": [],
                    "year": None,
                    "venue": "",
                    "link": ""
                }
                
        annotation = {
            "paper_id": arxiv_id,
            "title": title,
            "bib_entries": bib_entries
        }
        
        with open(json_path, 'w', encoding='utf-8') as f:
            json.dump(annotation, f, indent=2, ensure_ascii=False)
            
        if not os.path.exists(pdf_path):
            pdf_url = f"https://arxiv.org/pdf/{arxiv_id}.pdf"
            print(f"Downloading {pdf_url} to {pdf_filename}...")
            try:
                req = urllib.request.Request(pdf_url, headers={'User-Agent': 'Mozilla/5.0'})
                with urllib.request.urlopen(req) as response:
                    with open(pdf_path, 'wb') as f:
                        f.write(response.read())
                success_count += 1
                time.sleep(1) # Be nice to arxiv
            except Exception as e:
                print(f"Failed to download {pdf_url}: {e}")
        else:
            success_count += 1
            
    print(f"Finished! Successfully processed {success_count} papers.")

if __name__ == '__main__':
    main()
