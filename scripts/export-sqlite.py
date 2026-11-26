"""Read legacy SQLite without changing it; write JSON only to the importer's pipe."""
import json
import sqlite3
import sys
from pathlib import Path

path = Path(sys.argv[1]).resolve()
conn = sqlite3.connect(path.as_uri() + '?mode=ro', uri=True)
conn.row_factory = sqlite3.Row
try:
    tables = {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    data = {table: [dict(row) for row in conn.execute(f'SELECT * FROM {table} ORDER BY id')]
            if table in tables else [] for table in ['users', 'accounts', 'categories', 'transactions']}
    print(json.dumps(data, ensure_ascii=True))
finally:
    conn.close()
