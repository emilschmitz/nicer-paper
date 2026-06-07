import fitz
doc = fitz.open("/home/emil/projects/cit-tooltips/pdfs/2021_Learning_Transferable_Visual_Models_from_Natural_Language_Supervision.pdf")
for page in doc:
    for link in page.get_links():
        if "uri" in link:
            print(link['uri'])
