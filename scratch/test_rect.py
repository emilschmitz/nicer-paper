import fitz
import os

pdf_path = "/home/emil/projects/cit-tooltips/pdfs/2018_BERT_Pre-training_of_Deep_Bidirectional_Transformers_for_Language_Understanding.pdf"
doc = fitz.open(pdf_path)

for page_num in range(doc.page_count - 3, doc.page_count):
    page = doc[page_num]
    links = page.get_links()
    for link in links:
        if 'uri' in link:
            rect = fitz.Rect(link['from'])
            text = page.get_text("text", clip=rect).strip()
            print(f"URL: {link['uri']}")
            print(f"Text in rect: {text}")
            print("---")
