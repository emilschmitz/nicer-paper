import os
import json
import time
from bs4 import BeautifulSoup
from grobid_client.grobid_client import GrobidClient

def process_pdfs(directory):
    output_dir = os.path.join(directory, "raw_annotations")
    os.makedirs(output_dir, exist_ok=True)
    
    # Wait for grobid to be ready
    print("Waiting for Grobid server to start...")
    time.sleep(10)

    client = GrobidClient(config_path=None, grobid_server='http://localhost:8070', batch_size=10, coordinates=["ref"], sleep_time=5)

    print("Sending PDFs to Grobid for processing...")
    # This processes all PDFs in the input directory and saves TEI XML files to output directory
    client.process("processReferences", directory, output=output_dir, consolidate_citations=1, tei_coordinates=False, force=True)

    print("Extracting references from TEI XMLs...")
    for filename in os.listdir(output_dir):
        if not filename.endswith(".tei.xml"):
            continue
            
        xml_path = os.path.join(output_dir, filename)
        base_name = filename.replace(".tei.xml", "")
        
        with open(xml_path, 'r', encoding='utf-8') as f:
            soup = BeautifulSoup(f, 'xml')
            
        refs = []
        for bibl in soup.find_all('biblStruct'):
            ref = {}
            
            # Title
            title_node = bibl.find('title')
            if title_node:
                ref['title'] = title_node.text.strip()
                
            # Authors
            authors = []
            for author in bibl.find_all('author'):
                persName = author.find('persName')
                if persName:
                    forename = persName.find('forename')
                    surname = persName.find('surname')
                    
                    name_parts = []
                    if forename: name_parts.append(forename.text.strip())
                    if surname: name_parts.append(surname.text.strip())
                    
                    if name_parts:
                        authors.append(" ".join(name_parts))
            if authors:
                ref['author'] = " and ".join(authors)
                
            # Year
            date_node = bibl.find('date')
            if date_node and date_node.has_attr('when'):
                ref['year'] = date_node['when'][:4]
                
            # Venue (Journal or Conference)
            monogr = bibl.find('monogr')
            if monogr:
                monogr_title = monogr.find('title')
                if monogr_title:
                    ref['venue'] = monogr_title.text.strip()
            
            # Additional keys (doi, url, eprint) could be added if Grobid consolidates them
            for idno in bibl.find_all('idno'):
                id_type = idno.get('type')
                if id_type:
                    ref[id_type] = idno.text.strip()

            if ref:
                refs.append(ref)
                
        json_path = os.path.join(output_dir, f"{base_name}_refs.json")
        with open(json_path, 'w', encoding='utf-8') as f:
            json.dump({
                "paper": f"{base_name}.pdf",
                "total_references": len(refs),
                "references": refs
            }, f, indent=4)
            
        print(f"Saved {len(refs)} references to {json_path}")
        
    print("Done!")

if __name__ == "__main__":
    process_pdfs(".")
