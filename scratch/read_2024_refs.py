import fitz
doc = fitz.open("/home/emil/projects/cit-tooltips/pdfs/2024_Mamba_Linear-Time_Sequence_Modeling_with_Selective_State_Spaces.pdf")
# Usually references are at the end.
for i in range(doc.page_count - 5, doc.page_count):
    print(f"--- PAGE {i} ---")
    print(doc[i].get_text())
