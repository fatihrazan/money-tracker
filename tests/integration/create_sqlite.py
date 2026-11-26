import hashlib
import sqlite3
import sys

conn = sqlite3.connect(sys.argv[1])
conn.executescript('''
CREATE TABLE users(id INTEGER PRIMARY KEY, username TEXT, password_hash TEXT);
CREATE TABLE accounts(id INTEGER PRIMARY KEY, user_id INTEGER, name TEXT, type TEXT, initial_balance INTEGER, archived INTEGER);
CREATE TABLE categories(id INTEGER PRIMARY KEY, user_id INTEGER, name TEXT, kind TEXT, budget INTEGER);
CREATE TABLE transactions(id INTEGER PRIMARY KEY, user_id INTEGER, kind TEXT, amount INTEGER, account_id INTEGER, to_account_id INTEGER, category_id INTEGER, note TEXT, date TEXT, created_at TEXT);
INSERT INTO accounts VALUES(1,1,'BNI','bank',1000000,0),(2,1,'GoPay','ewallet',50000,0);
INSERT INTO categories VALUES(1,1,'Makan','expense',200000),(2,1,'Biaya Admin','expense',NULL);
INSERT INTO transactions VALUES
 (1,1,'expense',18000,2,NULL,1,'Kopi','2026-10-01','2026-10-01 12:00:00'),
 (2,1,'transfer',100000,1,2,NULL,'Topup','2026-10-02','2026-10-02 12:00:00'),
 (3,1,'expense',1000,1,NULL,2,'Biaya transfer','2026-10-02','2026-10-02 12:00:01'),
 (4,1,'adjustment',-500,2,NULL,NULL,'Selisih','2026-10-03','2026-10-03 12:00:00');
''')
password_hash = 'scrypt:32768:8:1$testsalt$' + hashlib.scrypt(b'legacy-password',salt=b'testsalt',n=32768,r=8,p=1,maxmem=67108864,dklen=64).hex()
conn.execute('INSERT INTO users VALUES(1,?,?)', ('legacy',password_hash))
conn.commit()
conn.close()
