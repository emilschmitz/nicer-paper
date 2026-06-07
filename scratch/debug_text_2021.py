import fitz

pdf_path = "/home/emil/projects/cit-tooltips/pdfs/2021_Learning_Transferable_Visual_Models_from_Natural_Language_Supervision.pdf"
doc = fitz.open(pdf_path)

for page_num in range(doc.page_count - 8, doc.page_count):
    page = doc[page_num]
    text = page.get_text()
    lines = text.split('\n')
    for line in lines:
        if 'http' in line or 'arXiv' in line or 'arxiv' in line:
            print(f"Page {page_num}: {line.strip()}")
