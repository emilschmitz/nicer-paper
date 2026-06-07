import fitz

pdf_path = "/home/emil/projects/cit-tooltips/pdfs/2017_Attention_Is_All_You_Need.pdf"
doc = fitz.open(pdf_path)

print(f"Total links: {sum(len(page.get_links()) for page in doc)}")

for page in doc:
    links = page.get_links()
    for link in links:
        if "uri" in link:
            print(f"Page {page.number}: {link['uri']} at {link['from']}")
