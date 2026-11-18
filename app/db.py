"""SQLite 持久层：建表 + 连接管理"""
import math
import os
import sqlite3
import time
from contextlib import contextmanager

import config

DB_PATH = os.environ.get("DB_PATH", "/data/tank.db")

SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
    id       INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    pwd      TEXT NOT NULL,
    created  REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS tanks (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id   INTEGER UNIQUE NOT NULL,
    coins     REAL NOT NULL DEFAULT 30,
    food      INTEGER NOT NULL DEFAULT 5,
    food_acc  REAL NOT NULL DEFAULT 0,
    last_tick REAL NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS fish (
    id      INTEGER PRIMARY KEY AUTOINCREMENT,
    tank_id INTEGER NOT NULL,
    name    TEXT NOT NULL,
    growth  REAL NOT NULL DEFAULT 0,
    hunger  REAL NOT NULL DEFAULT 60,
    hue     INTEGER NOT NULL DEFAULT 200,
    species TEXT NOT NULL DEFAULT 'carp',
    born    REAL NOT NULL,
    FOREIGN KEY (tank_id) REFERENCES tanks(id)
);

CREATE TABLE IF NOT EXISTS tank_meta (
    tank_id INTEGER PRIMARY KEY,
    title   TEXT NOT NULL,
    FOREIGN KEY (tank_id) REFERENCES tanks(id)
);
CREATE INDEX IF NOT EXISTS idx_fish_tank ON fish(tank_id);
"""


def connect() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH, timeout=10)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    return conn


def init_db() -> None:
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    with connect() as conn:
        conn.executescript(SCHEMA)
        _migrate(conn)
        # 后台参数表 + 默认鱼种 + 管理员账号（首次启动种子数据）
        config.ensure_seed(conn)


def _migrate(conn) -> None:
    """兼容旧库：补齐金币结算相关字段。"""
    cols = {r["name"] for r in conn.execute("PRAGMA table_info(tanks)")}
    if "pending" not in cols:
        conn.execute("ALTER TABLE tanks ADD COLUMN pending REAL NOT NULL DEFAULT 0")
    if "next_payout" not in cols:
        conn.execute("ALTER TABLE tanks ADD COLUMN next_payout REAL")
    nxt = math.ceil(time.time() / 3600) * 3600
    conn.execute("UPDATE tanks SET next_payout=? WHERE next_payout IS NULL", (nxt,))

    # 兼容旧库：补鱼种类字段（老鱼一律当鲤鱼）
    fcols = {r["name"] for r in conn.execute("PRAGMA table_info(fish)")}
    if "species" not in fcols:
        conn.execute("ALTER TABLE fish ADD COLUMN species TEXT NOT NULL DEFAULT 'carp'")
    conn.commit()


@contextmanager
def session():
    """请求级连接：自动提交并保证关闭，避免连接泄漏。"""
    conn = connect()
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()
