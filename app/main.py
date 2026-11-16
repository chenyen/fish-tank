"""虚拟养鱼 - Web 服务（FastAPI）"""
import base64
import hashlib
import hmac
import math
import os
import random
import threading
import time

from fastapi import FastAPI, Request, Response, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

import db
import game

SECRET = os.environ.get("FT_SECRET", "fish-tank-dev-secret").encode()
COOKIE_NAME = "ft_sess"
STATIC_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "static")

app = FastAPI(title="虚拟养鱼", docs_url=None, redoc_url=None)
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")

_lock = threading.Lock()

DEFAULT_NAMES = ["小豆", "团子", "泡芙", "布丁", "糯米", "麦芽", "橙子", "雪球"]


# ---------------------------------------------------------------- 认证工具

def hash_password(pwd: str) -> str:
    salt = os.urandom(16).hex()
    dk = hashlib.pbkdf2_hmac("sha256", pwd.encode(), salt.encode(), 120_000).hex()
    return f"{salt}${dk}"


def verify_password(pwd: str, stored: str) -> bool:
    try:
        salt, dk = stored.split("$", 1)
    except ValueError:
        return False
    calc = hashlib.pbkdf2_hmac("sha256", pwd.encode(), salt.encode(), 120_000).hex()
    return hmac.compare_digest(calc, dk)


def make_session(user_id: int) -> str:
    payload = f"{user_id}:{int(time.time())}"
    sig = hmac.new(SECRET, payload.encode(), hashlib.sha256).hexdigest()[:32]
    return base64.urlsafe_b64encode(f"{payload}:{sig}".encode()).decode()


def read_session(token: str | None) -> int | None:
    if not token:
        return None
    try:
        raw = base64.urlsafe_b64decode(token.encode()).decode()
        user_id, ts, sig = raw.rsplit(":", 2)
        expect = hmac.new(SECRET, f"{user_id}:{ts}".encode(), hashlib.sha256).hexdigest()[:32]
        if not hmac.compare_digest(sig, expect):
            return None
        if time.time() - int(ts) > 30 * 86400:
            return None
        return int(user_id)
    except Exception:
        return None


def current_user(request: Request, conn) -> dict:
    uid = read_session(request.cookies.get(COOKIE_NAME))
    if uid is None:
        raise HTTPException(status_code=401, detail="请先登录")
    row = conn.execute("SELECT id, username FROM users WHERE id=?", (uid,)).fetchone()
    if not row:
        raise HTTPException(status_code=401, detail="登录状态失效")
    return dict(row)


# ---------------------------------------------------------------- 数据读写

def get_tank(conn, user_id: int) -> dict:
    row = conn.execute("SELECT * FROM tanks WHERE user_id=?", (user_id,)).fetchone()
    if row:
        return dict(row)
    now = time.time()
    conn.execute(
        """INSERT INTO tanks(user_id, coins, food, food_acc, last_tick, pending, next_payout)
           VALUES(?,?,?,?,?,?,?)""",
        (user_id, 30.0, 5, 0.0, now, 0.0, game.next_hour_boundary(now)),
    )
    conn.commit()
    return dict(conn.execute("SELECT * FROM tanks WHERE user_id=?", (user_id,)).fetchone())


def get_fish(conn, tank_id: int) -> list:
    rows = conn.execute("SELECT * FROM fish WHERE tank_id=? ORDER BY id", (tank_id,)).fetchall()
    return [dict(r) for r in rows]


def save_world(conn, tank: dict, fish_list: list) -> None:
    conn.execute(
        """UPDATE tanks SET coins=?, food=?, food_acc=?, last_tick=?, pending=?, next_payout=?
           WHERE id=?""",
        (tank["coins"], tank["food"], tank["food_acc"], tank["last_tick"],
         tank["pending"], tank["next_payout"], tank["id"]),
    )
    for f in fish_list:
        conn.execute(
            "UPDATE fish SET growth=?, hunger=? WHERE id=?",
            (f["growth"], f["hunger"], f["id"]),
        )
    conn.commit()


def advance(conn, user_id: int):
    """载入、推进时间、返回 (tank, fish_list, 产出摘要)"""
    tank = get_tank(conn, user_id)
    fish_list = get_fish(conn, tank["id"])
    gain = game.tick(tank, fish_list, time.time())
    save_world(conn, tank, fish_list)
    return tank, fish_list, gain


def serialize(tank: dict, fish_list: list, gain: dict) -> dict:
    now = time.time()
    fish_out = []
    for f in fish_list:
        st = game.stage_of(f["growth"])
        eff = game.efficiency(f["hunger"])
        fish_out.append({
            "id": f["id"],
            "name": f["name"],
            "growth": round(f["growth"], 1),
            "hunger": round(f["hunger"], 1),
            "hue": f["hue"],
            "age": int(now - f["born"]),
            "stage": st,
            "adult": game.is_adult(f),
            "eff": eff,
            "coin_rate": round(game.coin_rate(f["growth"], f["hunger"]), 2),
            "base_rate": game.COIN_RATES[st["key"]],
        })
    food = tank["food"]
    next_food_in = None
    if food < game.FOOD_CAP:
        next_food_in = max(0, int(game.FOOD_REGEN_SEC - tank["food_acc"]))
    return {
        "coins": int(tank["coins"]),
        "coins_exact": round(tank["coins"], 2),
        "pending": round(tank["pending"], 2),
        "next_payout_in": max(0, int((tank["next_payout"] or now) - now)),
        "payout_interval": game.PAYOUT_INTERVAL,
        "income_per_hour": round(sum(f["coin_rate"] for f in fish_out), 2),
        "food": food,
        "food_cap": game.FOOD_CAP,
        "next_food_in": next_food_in,
        "capacity": game.TANK_CAP,
        "fish": fish_out,
        "gain": gain,
        "prices": {
            "fish": game.FISH_PRICE,
            "food_pack": game.FOOD_PACK_PRICE,
            "food_pack_size": game.FOOD_PACK,
            "feed_amount": game.FEED_AMOUNT,
        },
        "rules": {
            "coin_rates": game.COIN_RATES,
            "advance_reward": game.ADVANCE_REWARD,
        },
    }


# ---------------------------------------------------------------- 请求体

class Credentials(BaseModel):
    username: str
    password: str


class FishCreate(BaseModel):
    name: str = ""


class FeedReq(BaseModel):
    fish_id: int


# ---------------------------------------------------------------- 路由

@app.get("/")
def index():
    return FileResponse(os.path.join(STATIC_DIR, "index.html"))


@app.post("/api/register")
def register(body: Credentials, response: Response):
    name = body.username.strip()
    if not (2 <= len(name) <= 20):
        raise HTTPException(400, "用户名需 2-20 个字符")
    if not (4 <= len(body.password) <= 64):
        raise HTTPException(400, "密码需 4-64 位")
    with _lock, db.session() as conn:
        if conn.execute("SELECT 1 FROM users WHERE username=?", (name,)).fetchone():
            raise HTTPException(400, "用户名已被占用")
        now = time.time()
        cur = conn.execute(
            "INSERT INTO users(username, pwd, created) VALUES(?,?,?)",
            (name, hash_password(body.password), now),
        )
        uid = cur.lastrowid
        tank = get_tank(conn, uid)
        conn.execute(
            "INSERT INTO fish(tank_id, name, growth, hunger, hue, born) VALUES(?,?,?,?,?,?)",
            (tank["id"], DEFAULT_NAMES[0], 0.0, 70.0, random.randint(0, 359), now),
        )
        conn.commit()
        # 送一条初始鱼后再推进一次，保证 last_tick 一致
        advance(conn, uid)
    response.set_cookie(COOKIE_NAME, make_session(uid), max_age=30 * 86400,
                        httponly=True, samesite="lax")
    return {"ok": True, "username": name}


@app.post("/api/login")
def login(body: Credentials, response: Response):
    with _lock, db.session() as conn:
        row = conn.execute(
            "SELECT * FROM users WHERE username=?", (body.username.strip(),)
        ).fetchone()
        if not row or not verify_password(body.password, row["pwd"]):
            raise HTTPException(400, "用户名或密码错误")
        get_tank(conn, row["id"])
    response.set_cookie(COOKIE_NAME, make_session(row["id"]), max_age=30 * 86400,
                        httponly=True, samesite="lax")
    return {"ok": True, "username": row["username"]}


@app.post("/api/logout")
def logout(response: Response):
    response.delete_cookie(COOKIE_NAME)
    return {"ok": True}


@app.get("/api/me")
def me(request: Request):
    with db.session() as conn:
        try:
            user = current_user(request, conn)
        except HTTPException:
            return {"logged_in": False}
    return {"logged_in": True, "username": user["username"]}


@app.get("/api/state")
def state(request: Request):
    with _lock, db.session() as conn:
        user = current_user(request, conn)
        tank, fish_list, gain = advance(conn, user["id"])
        data = serialize(tank, fish_list, gain)
    data["username"] = user["username"]
    return data


@app.post("/api/fish")
def add_fish(body: FishCreate, request: Request):
    with _lock, db.session() as conn:
        user = current_user(request, conn)
        tank, fish_list, gain = advance(conn, user["id"])
        if len(fish_list) >= game.TANK_CAP:
            raise HTTPException(400, f"鱼缸最多养 {game.TANK_CAP} 条鱼")
        if tank["coins"] < game.FISH_PRICE:
            raise HTTPException(400, f"金币不足，需要 {game.FISH_PRICE} 金币")
        name = (body.name or "").strip()[:12] or random.choice(DEFAULT_NAMES)
        tank["coins"] -= game.FISH_PRICE
        conn.execute(
            "INSERT INTO fish(tank_id, name, growth, hunger, hue, born) VALUES(?,?,?,?,?,?)",
            (tank["id"], name, 0.0, 70.0, random.randint(0, 359), time.time()),
        )
        save_world(conn, tank, fish_list)
        fish_list = get_fish(conn, tank["id"])
        return serialize(tank, fish_list, gain)


@app.post("/api/feed")
def feed(body: FeedReq, request: Request):
    with _lock, db.session() as conn:
        user = current_user(request, conn)
        tank, fish_list, gain = advance(conn, user["id"])
        target = next((f for f in fish_list if f["id"] == body.fish_id), None)
        if not target:
            raise HTTPException(404, "这条鱼不在你的鱼缸里")
        if tank["food"] <= 0:
            raise HTTPException(400, "没有饲料了，先去换购一些")
        if target["hunger"] >= 100:
            raise HTTPException(400, f"{target['name']} 已经吃饱了")
        tank["food"] -= 1
        target["hunger"] = min(100.0, target["hunger"] + game.FEED_AMOUNT)
        save_world(conn, tank, fish_list)
        return serialize(tank, fish_list, gain)


@app.post("/api/food")
def buy_food(request: Request):
    with _lock, db.session() as conn:
        user = current_user(request, conn)
        tank, fish_list, gain = advance(conn, user["id"])
        if tank["food"] >= game.FOOD_CAP:
            raise HTTPException(400, "饲料已经装满了")
        if tank["food"] + game.FOOD_PACK > game.FOOD_CAP:
            raise HTTPException(
                400, f"饲料快满了（{tank['food']}/{game.FOOD_CAP}），先喂掉一些再换购"
            )
        if tank["coins"] < game.FOOD_PACK_PRICE:
            raise HTTPException(400, f"金币不足，需要 {game.FOOD_PACK_PRICE} 金币")
        tank["coins"] -= game.FOOD_PACK_PRICE
        tank["food"] = min(game.FOOD_CAP, tank["food"] + game.FOOD_PACK)
        save_world(conn, tank, fish_list)
        return serialize(tank, fish_list, gain)


@app.get("/api/leaderboard")
def leaderboard():
    with db.session() as conn:
        rows = conn.execute(
            """SELECT u.username,
                      COUNT(f.id)                     AS fish_count,
                      COALESCE(SUM(f.growth), 0)      AS total_growth,
                      COALESCE(MAX(f.growth), 0)      AS best_growth
               FROM users u
               LEFT JOIN tanks t ON t.user_id = u.id
               LEFT JOIN fish  f ON f.tank_id = t.id
               GROUP BY u.id
               ORDER BY total_growth DESC
               LIMIT 10"""
        ).fetchall()
    return {"rank": [
        {"username": r["username"], "fish": r["fish_count"],
         "total_growth": int(r["total_growth"]),
         "best_stage": game.stage_of(r["best_growth"])["name"]}
        for r in rows
    ]}


db.init_db()
