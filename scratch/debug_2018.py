import fitz
import json
import os

pdf_path = "/home/emil/projects/cit-tooltips/pdfs/2018_BERT_Pre-training_of_Deep_Bidirectional_Transformers_for_Language_Understanding.pdf"
doc = fitz.open(pdf_path)

links_data = []
for page in doc:
    links = page.get_links()
    blocks = page.get_text("blocks")
    for link in links:
        if 'uri' in link:
            rect = fitz.Rect(link['from'])
            intersecting_text = ""
            for b in blocks:
                b_rect = fitz.Rect(b[:4])
                if rect.intersects(b_rect):
                    intersecting_text += b[4] + " "
            clean_text = intersecting_text.replace('\n', ' ').strip()
            clean_text = ' '.join(clean_text.split())
            links_data.append({'uri': link['uri'], 'text': clean_text})

for l in links_data:
    print(f"URI: {l['uri']}\nTEXT: {l['text']}\n")
