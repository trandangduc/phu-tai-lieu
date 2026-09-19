"""Lịch sử chat (SQLite). Một người dùng, không có tài khoản."""
from __future__ import annotations

import json
import sqlite3
import time
import uuid

from . import config


def _conn() -> sqlite3.Connection:
    config.ensure_dirs()
    c = sqlite3.connect(config.CHAT_DB, timeout=30.0)
    c.row_factory = sqlite3.Row
    c.executescript("""
    CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY, title TEXT, created REAL, updated REAL);
    CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL, role TEXT NOT NULL, content TEXT NOT NULL,
        citations TEXT, created REAL);
    CREATE INDEX IF NOT EXISTS idx_msg_sess ON messages(session_id, id);
    """)
    return c


def new_session(title: str) -> str:
    sid, now = uuid.uuid4().hex, time.time()
    with _conn() as c:
        c.execute("INSERT INTO sessions VALUES (?,?,?,?)", (sid, title[:80], now, now))
    return sid


def add_message(sid: str, role: str, content: str, citations: list | None = None) -> int:
    now = time.time()
    with _conn() as c:
        cur = c.execute("INSERT INTO messages(session_id, role, content, citations, created) "
                        "VALUES (?,?,?,?,?)",
                        (sid, role, content, json.dumps(citations or [], ensure_ascii=False), now))
        c.execute("UPDATE sessions SET updated=? WHERE id=?", (now, sid))
        return cur.lastrowid


def messages(sid: str, limit: int | None = None) -> list[dict]:
    with _conn() as c:
        rows = c.execute("SELECT * FROM messages WHERE session_id=? ORDER BY id", (sid,)).fetchall()
    out = [{"id": r["id"], "role": r["role"], "content": r["content"],
            "citations": json.loads(r["citations"] or "[]")} for r in rows]
    return out[-limit:] if limit else out


def sessions() -> list[dict]:
    with _conn() as c:
        return [dict(r) for r in c.execute(
            "SELECT id, title, updated FROM sessions ORDER BY updated DESC LIMIT 200")]


def exists(sid: str) -> bool:
    with _conn() as c:
        return c.execute("SELECT 1 FROM sessions WHERE id=?", (sid,)).fetchone() is not None


def delete_session(sid: str) -> None:
    with _conn() as c:
        c.execute("DELETE FROM messages WHERE session_id=?", (sid,))
        c.execute("DELETE FROM sessions WHERE id=?", (sid,))
