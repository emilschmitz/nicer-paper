import os
import json
import warnings
from refextract import extract_references_from_file

# Suppress PyPDF2 deprecation warnings from refextract
warnings.filterwarnings("ignore")

def process_pdfs(directory):
    output_dir = os.path.join(directory, "raw_annotations")
    os.makedirs(output_dir, exist_ok=True)

    pdf_files = [f for f in os.listdir(directory) if f.endswith(".pdf")]

    for pdf_file in pdf_files:
        print(f"Processing {pdf_file} with refextract...")
        pdf_path = os.path.join(directory, pdf_file)
        
        try:
            # This returns a list of dictionaries mapping standard bibtex fields
            references = extract_references_from_file(pdf_path)
            
            # Reformat to match the required fields: author, title, year, venue, url, raw
            formatted_refs = []
            for ref in references:
                formatted_ref = {
                    "raw": ref.get("raw_ref", [""])[0] if "raw_ref" in ref else "",
                    "author": " and ".join(ref.get("author", [])),
                    "title": ref.get("title", [""])[0] if "title" in ref else "",
                    "year": ref.get("year", [""])[0] if "year" in ref else "",
                    "venue": ref.get("journal_title", [""])[0] if "journal_title" in ref else (
                             ref.get("journal_reference", [""])[0] if "journal_reference" in ref else ""),
                    "url": ref.get("url", [""])[0] if "url" in ref else "",
                    "doi": ref.get("doi", [""])[0] if "doi" in ref else "",
                    "arxiv_id": ref.get("eprint", [""])[0] if "eprint" in ref else ""
                }
                
                # Cleanup empty keys
                formatted_ref = {k: v for k, v in formatted_ref.items() if v}
                formatted_refs.append(formatted_ref)
            
            output_file = os.path.join(output_dir, f"{os.path.splitext(pdf_file)[0]}_refs.json")
            with open(output_file, 'w', encoding='utf-8') as f:
                json.dump({
                    "paper": pdf_file,
                    "total_references": len(formatted_refs),
                    "references": formatted_refs
                }, f, indent=4)
                
            print(f"Saved {len(formatted_refs)} references to {output_file}")
            
        except Exception as e:
            print(f"Error extracting from {pdf_file}: {e}")

if __name__ == "__main__":
    process_pdfs(".")
