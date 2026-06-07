import urllib.request
import urllib.parse
import xml.etree.ElementTree as ET
import os

papers = {
    2015: "Deep Residual Learning for Image Recognition",
    2016: "You Only Look Once: Unified, Real-Time Object Detection",
    2017: "Attention Is All You Need",
    2018: "BERT: Pre-training of Deep Bidirectional Transformers for Language Understanding",
    2019: "EfficientNet: Rethinking Model Scaling for Convolutional Neural Networks",
    2020: "Denoising Diffusion Probabilistic Models",
    2021: "Learning Transferable Visual Models from Natural Language Supervision",
    2022: "High-Resolution Image Synthesis with Latent Diffusion Models",
    2023: "LLaMA: Open and Efficient Foundation Language Models",
    2024: "Mamba: Linear-Time Sequence Modeling with Selective State Spaces"
}

def download_arxiv_paper(year, title):
    # Some titles have colons which might mess up exact matching, we split by colon and use the first part
    search_title = title.split(':')[0]
    query = urllib.parse.quote(f'ti:"{search_title}"')
    url = f'http://export.arxiv.org/api/query?search_query={query}&max_results=1'
    
    try:
        response = urllib.request.urlopen(url)
        xml_data = response.read()
        root = ET.fromstring(xml_data)
        
        ns = {'atom': 'http://www.w3.org/2005/Atom'}
        entry = root.find('atom:entry', ns)
        
        if entry is not None:
            pdf_link = None
            for link in entry.findall('atom:link', ns):
                if link.attrib.get('title') == 'pdf':
                    pdf_link = link.attrib.get('href')
                    break
            
            if pdf_link:
                print(f"[{year}] Found: {title}. Downloading...")
                filename = f"{year}_{title.replace(' ', '_').replace(':', '')}.pdf"
                download_url = pdf_link
                if not download_url.endswith('.pdf'):
                    download_url += '.pdf'
                
                req = urllib.request.Request(download_url, headers={'User-Agent': 'Mozilla/5.0'})
                with urllib.request.urlopen(req) as response, open(filename, 'wb') as out_file:
                    out_file.write(response.read())
                    
                print(f"Downloaded: {filename}")
            else:
                print(f"[{year}] No PDF link found for: {title}")
        else:
            print(f"[{year}] Paper not found on Arxiv: {title}")
    except Exception as e:
        print(f"[{year}] Error searching/downloading {title}: {e}")

if __name__ == "__main__":
    for year, title in papers.items():
        download_arxiv_paper(year, title)
