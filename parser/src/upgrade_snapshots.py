"""Fixed migration worker: JSON on stdin/stdout, no filesystem writes."""
import json
import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parent))
from ratings import upgrade_snapshot

if __name__ == '__main__':
    rows=json.load(sys.stdin)
    print(json.dumps([dict(id=row['id'],data=upgrade_snapshot(row['data'])) for row in rows],allow_nan=False))
