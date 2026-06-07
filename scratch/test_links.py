import fitz

pdf_path = "/home/emil/projects/cit-tooltips/pdfs/2015_Deep_Residual_Learning_for_Image_Recognition.pdf"
doc = fitz.open(pdf_path)
for page in doc:
    links = page.get_links()
    for link in links:
        if "uri" in link:
            print(f"Page {page.number}: {link['uri']} at {link['from']}")
