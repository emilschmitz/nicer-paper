import json
import re

with open('raw_annotations/2015_Deep_Residual_Learning_for_Image_Recognition_refs.json', 'r') as f:
    data = json.load(f)

venues_list = ['NeurIPS', 'NIPS', 'ICLR', 'CVPR', 'ICML', 'ACL', 'EMNLP', 'NAACL', 'ECCV', 'KDD', 'AAAI', 'JMLR', 'arXiv', 'Nature', 'Science', 'CoRR', 'IEEE', 'ACM', 'BMVC', 'IJCV', 'TPAMI', 'AISTATS', 'Siam', 'Oxford university press', 'Cambridge university press', 'Springer', 'Tech Report', 'Technical report', 'Neural computation', 'Tech. Rep.', 'Technical Report']

for i, ref in enumerate(data['references']):
    raw = ref['raw'].replace('\n', ' ')
    
    # Reset all fields except raw
    for k in list(ref.keys()):
        if k != 'raw':
            del ref[k]
            
    match = re.match(r'^\[\d+\]\s+(.*?)$', raw)
    if match:
        content = match.group(1)
        
        # Extract year
        year_match = re.search(r'\b(19\d{2}|20\d{2})\b', content)
        if year_match:
            ref['year'] = year_match.group(1)
            
        # Extract arxiv_id
        arxiv_match = re.search(r'arxiv:(\d{4}\.\d{4,5})', content, re.IGNORECASE)
        if arxiv_match:
            ref['arxiv_id'] = arxiv_match.group(1)
            
        # Extract venue
        for v in venues_list:
            if re.search(r'\b' + re.escape(v) + r'\b', content, re.IGNORECASE):
                ref['venue'] = v
                break
                
        # Split author and title
        # For real references (indices 0 to 49) they are well-formatted.
        # But we'll apply it to all just in case.
        parts = re.split(r'(?<=[a-z]{2})\.\s+(?=[A-Z])|(?<=et al)\.\s+(?=[A-Z])|(?<=al\.)\s+(?=[A-Z])', content, maxsplit=1)
        if len(parts) >= 2:
            ref['author'] = parts[0].strip(' .')
            title_rest = parts[1]
            parts2 = re.split(r'(?<=[a-zA-Z])\.\s+(?=[A-Z0-9])', title_rest, maxsplit=1)
            ref['title'] = parts2[0].strip(' .')
        else:
            # Fallback
            parts = content.split('. ', 1)
            if len(parts) >= 2:
                ref['author'] = parts[0].strip(' .')
                parts2 = parts[1].split('. ', 1)
                ref['title'] = parts2[0].strip(' .')

with open('raw_annotations/2015_Deep_Residual_Learning_for_Image_Recognition_refs.json', 'w') as f:
    json.dump(data, f, indent=4)
