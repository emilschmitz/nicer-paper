import json
import re

with open('raw_annotations/2015_Deep_Residual_Learning_for_Image_Recognition_refs.json', 'r') as f:
    data = json.load(f)

venues_list = ['NeurIPS', 'NIPS', 'ICLR', 'CVPR', 'ICML', 'ACL', 'EMNLP', 'NAACL', 'ECCV', 'KDD', 'AAAI', 'JMLR', 'arXiv', 'Nature', 'Science', 'CoRR', 'IEEE', 'ACM', 'BMVC', 'IJCV', 'TPAMI', 'AISTATS', 'Siam', 'Oxford university press', 'Cambridge university press', 'Springer', 'Tech Report', 'Technical report', 'Neural computation', 'Tech. Rep.', 'Technical Report']

# Set of real references (from [1] to [50])
ref_numbers_seen = set()

for ref in data['references']:
    raw = ref['raw'].replace('\n', ' ')
    
    # Remove existing keys except 'raw'
    for k in list(ref.keys()):
        if k != 'raw':
            del ref[k]
            
    match = re.match(r'^\[(\d+)\]\s+(.*?)$', raw)
    if match:
        num = int(match.group(1))
        content = match.group(2)
        
        # A real reference is 1 to 50, and we only process the first occurrence of each number
        if 1 <= num <= 50 and num not in ref_numbers_seen:
            ref_numbers_seen.add(num)
            
            # Format: Authors. Title. Venue, Year.
            # Split by '. '
            parts = re.split(r'\.\s+(?=[A-Z])', content, maxsplit=2)
            if len(parts) >= 2:
                ref['author'] = parts[0].strip()
                ref['title'] = parts[1].strip()
                if len(parts) > 2:
                    rest = parts[2].strip()
                else:
                    rest = ""
                    
                # Fix for some special cases
                if "arXiv:" in content or "arxiv:" in content.lower():
                    title_match = re.search(r'(.*?)\.\s+(arXiv:\d+\.\d+)', content, re.IGNORECASE)
                    if title_match:
                        # Wait, author was already split.
                        pass
                
                # Check if title contains venue (e.g. if there was no period after title)
                
                # Actually, let's use a simpler heuristic for extracting year, venue, etc from the rest
                year_match = re.search(r'\b(19\d{2}|20\d{2})\b', content)
                if year_match:
                    ref['year'] = year_match.group(1)
                    
                arxiv_match = re.search(r'arxiv:(\d{4}\.\d{4,5})', content, re.IGNORECASE)
                if arxiv_match:
                    ref['arxiv_id'] = arxiv_match.group(1)
                    
                for v in venues_list:
                    if v.lower() in content.lower():
                        ref['venue'] = v
                        break
        else:
            # It's garbage text.
            # We can still extract year or arxiv_id if it's strictly asked, but usually it shouldn't have author/title.
            # Let's extract year if it has one.
            pass

with open('raw_annotations/2015_Deep_Residual_Learning_for_Image_Recognition_refs.json', 'w') as f:
    json.dump(data, f, indent=4)
