import os
import json
import time
import urllib.request
import urllib.parse
from xml.etree import ElementTree as ET

PDF_DIR = 'pdfs'
ANN_DIR = 'annotations'

os.makedirs(PDF_DIR, exist_ok=True)
os.makedirs(ANN_DIR, exist_ok=True)

CATEGORIES = [
    'cs.OS', 'cs.PL', 'math.NT', 'astro-ph', 'q-bio.NC', 'cs.DB', 
    'cs.SE', 'math.CO', 'hep-th', 'stat.AP', 'cs.LG', 'cs.AI'
]

def clean_title(title):
    return ''.join(c if c.isalnum() else '_' for c in title)[:60].strip('_')

def get_arxiv_papers(year, cat, max_results=1):
    url = f'http://export.arxiv.org/api/query?search_query=cat:{cat}+AND+submittedDate:[{year}01010000+TO+{year}12312359]&max_results={max_results}'
    try:
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req) as response:
            xml_data = response.read()
            root = ET.fromstring(xml_data)
            papers = []
            for entry in root.findall('{http://www.w3.org/2005/Atom}entry'):
                title = entry.find('{http://www.w3.org/2005/Atom}title').text.replace('\n', ' ')
                id_url = entry.find('{http://www.w3.org/2005/Atom}id').text
                arxiv_id = id_url.split('/abs/')[-1].split('v')[0]
                pdf_link = id_url.replace('/abs/', '/pdf/') + '.pdf'
                papers.append({'title': title, 'arxiv_id': arxiv_id, 'pdf_url': pdf_link})
            return papers
    except Exception as e:
        print(f"Error fetching arXiv {cat} {year}: {e}")
        return []

def get_s2_references(arxiv_id):
    url = f'https://api.semanticscholar.org/graph/v1/paper/arXiv:{arxiv_id}/references?fields=title,authors,year,venue'
    try:
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req) as response:
            data = json.loads(response.read().decode('utf-8'))
            if 'data' in data:
                return data['data']
    except Exception as e:
        print(f"Error fetching S2 references for {arxiv_id}: {e}")
    return None

def download_pdf(url, dest):
    try:
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req) as response:
            with open(dest, 'wb') as f:
                f.write(response.read())
        return True
    except Exception as e:
        print(f"Error downloading {url}: {e}")
        return False

def main():
    target_count = 120
    count = 0
    start_year = 2015
    end_year = 2024
    
    print(f"Starting to fetch {target_count} papers...")
    
    for year in range(start_year, end_year + 1):
        for cat in CATEGORIES:
            if count >= target_count:
                break
            
            print(f"\n[{count}/{target_count}] Querying {cat} in {year}...")
            papers = get_arxiv_papers(year, cat)
            time.sleep(3) # arXiv API limit
            
            for paper in papers:
                arxiv_id = paper['arxiv_id']
                clean_t = clean_title(paper['title'])
                pdf_filename = f"{year}_{clean_t}.pdf"
                json_filename = f"{year}_{clean_t}.json"
                
                pdf_path = os.path.join(PDF_DIR, pdf_filename)
                json_path = os.path.join(ANN_DIR, json_filename)
                
                if os.path.exists(pdf_path) and os.path.exists(json_path):
                    print(f"Already exists: {pdf_filename}")
                    count += 1
                    continue
                
                print(f"Fetching references for {arxiv_id}...")
                refs = get_s2_references(arxiv_id)
                time.sleep(1.5) # Semantic Scholar API rate limit
                
                if not refs:
                    print(f"No references found for {arxiv_id}, skipping.")
                    continue
                
                bib_entries = {}
                for i, ref in enumerate(refs):
                    cited_paper = ref.get('citedPaper', {})
                    if not cited_paper:
                        continue
                    bib_entries[f"BIBREF{i}"] = {
                        "title": cited_paper.get('title', ''),
                        "authors": cited_paper.get('authors', []),
                        "year": cited_paper.get('year'),
                        "venue": cited_paper.get('venue', ''),
                        "link": f"https://api.semanticscholar.org/graph/v1/paper/{cited_paper.get('paperId')}" if cited_paper.get('paperId') else ""
                    }
                
                if not bib_entries:
                    print(f"References had no citedPaper for {arxiv_id}, skipping.")
                    continue
                    
                annotation = {
                    "paper_id": arxiv_id,
                    "title": paper['title'],
                    "bib_entries": bib_entries
                }
                
                print(f"Downloading PDF {pdf_filename}...")
                if download_pdf(paper['pdf_url'], pdf_path):
                    with open(json_path, 'w', encoding='utf-8') as f:
                        json.dump(annotation, f, indent=2, ensure_ascii=False)
                    print(f"✓ Saved {pdf_filename} and annotation.")
                    count += 1
                else:
                    print(f"Failed to download PDF.")

    print(f"\nDone! Fetched {count} papers with annotations.")

if __name__ == '__main__':
    main()
