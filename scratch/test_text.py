import fitz

pdf_path = "/home/emil/projects/cit-tooltips/pdfs/2015_Deep_Residual_Learning_for_Image_Recognition.pdf"
doc = fitz.open(pdf_path)

for page_num in range(doc.page_count - 2, doc.page_count):
    page = doc[page_num]
    text = page.get_text()
    print(f"--- Page {page_num} ---")
    lines = text.split('\n')
    for line in lines:
        if 'arXiv' in line or 'http' in line:
            print(line)
