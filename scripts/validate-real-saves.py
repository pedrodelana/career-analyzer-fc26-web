"""Optional local integration audit; never uploads or modifies input files."""
import hashlib
import json
import os
import sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'parser/src'))
from main import parse

folder=Path(os.environ.get('FC26_SAVES',str(Path(os.environ['LOCALAPPDATA'])/'EA SPORTS FC 26/settings')))
results=[]
for path in sorted(folder.iterdir()):
    if not path.is_file() or path.is_symlink() or not path.name.lower().startswith('cmmgr'):
        continue
    before=hashlib.sha256(path.read_bytes()).hexdigest()
    try:
        result=parse(path)
        dates=result['careerDateInfo']
        assert dates['referenceDate']==dates['lastMatchDate']
        if dates['referenceDate'] is None:
            assert all(p['age'] is None for p in result['players'])
        if path.name=='CmMgrC20260923004935042':
            assert dates['lastMatchDate']=='2026-03-14' and dates['referenceDateSource']=='SAVE_LAST_MATCH'
        results.append({'file':path.name,'club':result['metadata']['clubName'],'careerDateInfo':dates,'playersWithAge':sum(p['age'] is not None for p in result['players']),'integrity':result['integrity'],'resolvedNames':sum(not p['displayName'].startswith('Unknown Player') for p in result['players'])})
    except Exception as error:
        results.append({'file':path.name,'error':str(error)})
    assert before==hashlib.sha256(path.read_bytes()).hexdigest(), 'Input file changed during validation'
print(json.dumps({'readOnlyVerified':True,'files':len(results),'knownReferenceSavePresent':any(r['file']=='CmMgrC20260923004935042' for r in results),'results':results},indent=2))
