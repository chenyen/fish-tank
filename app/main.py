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
from fastapi.responses import FileResponse, HTMLResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

import config
import db
import game

SECRET = os.environ.get("FT_SECRET", "fish-tank-dev-secret").encode()
COOKIE_NAME = "ft_sess"
ADMIN_COOKIE = "ft_admin"
ADMIN_SESSION_AGE = 12 * 3600
STATIC_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "static")

app = FastAPI(title="虚拟养鱼", docs_url=None, redoc_url=None)
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")

_lock = threading.Lock()

DEFAULT_NAMES = ["小豆", "团子", "泡芙", "布丁", "糯米", "麦芽", "橙子", "雪球"]
DEFAULT_TITLE = "AQUARIUM"

hash_password = config.hash_password
verify_password = config.verify_password


# ---------------------------------------------------------------- 认证工具

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


# ---------------------------------------------------- 管理员会话（后台独立 Cookie）

def make_admin_session() -> str:
    payload = f"admin:{int(time.time())}"
    sig = hmac.new(SECRET, payload.encode(), hashlib.sha256).hexdigest()[:32]
    return base64.urlsafe_b64encode(f"{payload}:{sig}".encode()).decode()


def is_admin(request: Request) -> bool:
    token = request.cookies.get(ADMIN_COOKIE)
    if not token:
        return False
    try:
        raw = base64.urlsafe_b64decode(token.encode()).decode()
        role, ts, sig = raw.rsplit(":", 2)
        if role != "admin":
            return False
        expect = hmac.new(SECRET, f"{role}:{ts}".encode(), hashlib.sha256).hexdigest()[:32]
        if not hmac.compare_digest(sig, expect):
            return False
        return time.time() - int(ts) <= ADMIN_SESSION_AGE
    except Exception:
        return False


def require_admin(request: Request) -> str:
    """未登录后台一律 401，保证「未登录不可操作」。"""
    if not is_admin(request):
        raise HTTPException(status_code=401, detail="请先以管理员身份登录")
    return config.ADMIN_USERNAME


# ---------------------------------------------------------------- 数据读写

def get_tank(conn, user_id: int, cfg: dict) -> dict:
    row = conn.execute("SELECT * FROM tanks WHERE user_id=?", (user_id,)).fetchone()
    if row:
        return dict(row)
    now = time.time()
    params = game.params(cfg)
    conn.execute(
        """INSERT INTO tanks(user_id, coins, food, food_acc, last_tick, pending, next_payout)
           VALUES(?,?,?,?,?,?,?)""",
        (user_id, float(params["initial_coins"]), int(params["initial_food"]),
         0.0, now, 0.0, game.next_payout_at(now, cfg)),
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
            "UPDATE fish SET growth=?, hunger=?, fed=? WHERE id=?",
            (f["growth"], f["hunger"], int(f.get("fed") or 0), f["id"]),
        )
    conn.commit()


def tank_title(conn, tank_id: int) -> str:
    row = conn.execute("SELECT title FROM tank_meta WHERE tank_id=?", (tank_id,)).fetchone()
    return row["title"] if row else DEFAULT_TITLE


def clean_name(raw: str, label: str, max_len: int) -> str:
    """名字允许任意字符，只去掉换行与首尾空白，长度 1..max_len。"""
    s = (raw or "").replace("\r", " ").replace("\n", " ").strip()
    if not s:
        raise HTTPException(400, f"{label}不能为空")
    if len(s) > max_len:
        raise HTTPException(400, f"{label}最多 {max_len} 个字符")
    return s


def advance(conn, user_id: int, cfg: dict):
    """载入、推进时间、返回 (tank, fish_list, 产出摘要)"""
    tank = get_tank(conn, user_id, cfg)
    fish_list = get_fish(conn, tank["id"])
    gain = game.tick(tank, fish_list, time.time(), cfg)
    save_world(conn, tank, fish_list)
    return tank, fish_list, gain


def serialize(tank: dict, fish_list: list, gain: dict, title: str, cfg: dict) -> dict:
    now = time.time()
    params = game.params(cfg)
    shop = game.shop_catalog(cfg)

    fish_out = []
    gprof = game.growth_profile(cfg)
    for f in fish_list:
        st = game.stage_of(f["growth"])
        eff = game.efficiency(f["hunger"])
        sp = game.species_of(f, cfg)
        meta = game.species_meta(sp, cfg)
        gstate = game.growth_state(f["hunger"], cfg, gprof)
        fish_out.append({
            "id": f["id"],
            "name": f["name"],
            "species": sp,
            "species_name": meta.get("name") or sp,
            "look": meta.get("look") or sp,
            "size": round(float(meta.get("size") or 1.0), 2),
            "coin_k": round(float(meta.get("coin") or 1.0), 2),
            "growth": round(f["growth"], 1),
            "hunger": round(f["hunger"], 1),
            "hue": f["hue"],
            "age": int(now - f["born"]),
            "stage": st,
            "adult": game.is_adult(f),
            "sell": game.sell_value(f, cfg),
            "eff": eff,
            "coin_rate": round(game.coin_rate(f["growth"], f["hunger"], sp, cfg), 2),
            "base_rate": game.COIN_RATES[st["key"]],
            "growth_factor": gstate["factor"],
            "growth_per_hour": gstate["per_hour"],
            "growth_state": {
                "key": gstate["key"],
                "label": gstate["label"],
                "factor": gstate["factor"],
                "per_hour": gstate["per_hour"],
                "threshold": round(gstate["threshold"], 1),
                "next_threshold": (
                    None if gstate["next_threshold"] is None
                    else round(gstate["next_threshold"], 1)
                ),
            },
        })

    cap = int(params["tank_capacity"] or 0)
    regen = float(params["food_regen_sec"] or 0)
    return {
        "title": title,
        "coins": int(tank["coins"]),
        "coins_exact": round(tank["coins"], 2),
        "pending": round(tank["pending"], 2),
        "next_payout_in": max(0, int((tank["next_payout"] or now) - now)),
        "payout_interval": params["payout_interval"],
        "income_per_hour": round(sum(f["coin_rate"] for f in fish_out), 2),
        "food": tank["food"],
        "food_cap": None,
        "next_food_in": max(0, int(regen - tank["food_acc"])) if regen > 0 else None,
        "capacity": cap if cap > 0 else None,      # None = 不限
        "capacity_unlimited": cap <= 0,
        "fish": fish_out,
        "gain": gain,
        "prices": {
            "fish": shop[0]["price"] if shop else 0,
            "fish_min": min((s["price"] for s in shop), default=0),
            "species": shop,                        # 仅上架鱼种
            "species_all": game.species_catalog(cfg),   # 含下架，供绘制老鱼
            "food_pack": params["food_pack_price"],
            "food_pack_size": params["food_pack_size"],
            "feed_amount": params["feed_amount"],
        },
        "rules": {
            "coin_rates": game.COIN_RATES,
            "advance_reward": game.ADVANCE_REWARD,
            "growth_per_sec": gprof["per_sec"],
            "growth_tiers": gprof["tiers"],
            "swim_speed": float(params.get("swim_speed", 1) or 1),
        },
    }


# ---------------------------------------------------------------- 请求体

class Credentials(BaseModel):
    username: str
    password: str


class FishCreate(BaseModel):
    name: str = ""
    species: str = ""
    count: int = 1          # 一次买几条，1 为原有的单条购买


class FishBatchItem(BaseModel):
    species: str
    count: int = 1


class FishBatchCreate(BaseModel):
    items: list[FishBatchItem]


class FeedReq(BaseModel):
    fish_id: int


class TitleReq(BaseModel):
    title: str = ""


class FishRename(BaseModel):
    fish_id: int
    name: str = ""


class FishSell(BaseModel):
    fish_id: int


class AdminConfigReq(BaseModel):
    params: dict = {}
    species: list = []


class AdminPwdReq(BaseModel):
    old: str = ""
    new: str = ""


# ---------------------------------------------------------------- 页面

def _page(name: str) -> HTMLResponse:
    """返回页面，并给静态资源引用加 mtime 版本号。

    部署更新后文件 mtime 变化，URL 跟着变，浏览器会重新拉取最新的 js/css，
    避免用户因为缓存一直看到旧界面。无需手动维护版本号。
    """
    path = os.path.join(STATIC_DIR, name)
    with open(path, "r", encoding="utf-8") as fh:
        html = fh.read()

    def stamp(match):
        attr, url = match.group(1), match.group(2)
        rel = url.lstrip("/").split("?")[0]
        if rel.startswith("static/"):       # URL 里的 /static/ 前缀不属于 STATIC_DIR 内部路径
            rel = rel[len("static/"):]
        fp = os.path.join(STATIC_DIR, rel)
        try:
            version = int(os.path.getmtime(fp))
        except OSError:
            version = 0
        sep = "&" if "?" in url else "?"
        return f'{attr}="{url}{sep}v={version}"'

    import re
    html = re.sub(r'(src|href)="(/static/[^"]+)"', stamp, html)
    return HTMLResponse(html, headers={"Cache-Control": "no-store"})


@app.get("/")
def index():
    return _page("index.html")


@app.get("/admin")
def admin_page():
    return _page("admin.html")


# ---------------------------------------------------------------- 玩家接口

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
        cfg = config.load(conn)
        now = time.time()
        cur = conn.execute(
            "INSERT INTO users(username, pwd, created) VALUES(?,?,?)",
            (name, hash_password(body.password), now),
        )
        uid = cur.lastrowid
        tank = get_tank(conn, uid, cfg)
        conn.execute(
            "INSERT INTO fish(tank_id, name, growth, hunger, hue, species, born) "
            "VALUES(?,?,?,?,?,?,?)",
            (tank["id"], DEFAULT_NAMES[0], 0.0, 70.0, random.randint(0, 359),
             game.default_species(cfg), now),
        )
        conn.commit()
        # 送一条初始鱼后再推进一次，保证 last_tick 一致
        advance(conn, uid, cfg)
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
        get_tank(conn, row["id"], config.load(conn))
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
        cfg = config.load(conn)
        tank, fish_list, gain = advance(conn, user["id"], cfg)
        data = serialize(tank, fish_list, gain, tank_title(conn, tank["id"]), cfg)
    data["username"] = user["username"]
    return data


@app.post("/api/fish")
def add_fish(body: FishCreate, request: Request):
    """买鱼苗：支持 count 一次买多条，一次性按总价校验与扣费。"""
    count = 1 if body.count is None else int(body.count)
    if count < 1:
        raise HTTPException(400, "至少买 1 条鱼苗")
    if count > 999:
        raise HTTPException(400, "一次最多买 999 条鱼苗")
    with _lock, db.session() as conn:
        user = current_user(request, conn)
        cfg = config.load(conn)
        key = (body.species or game.default_species(cfg)).strip()
        shop = {sp["key"]: sp for sp in game.shop_catalog(cfg)}
        sp = shop.get(key)
        if not sp:
            raise HTTPException(400, "没有这种鱼苗")
        price = float(sp["price"])
        tank, fish_list, gain = advance(conn, user["id"], cfg)
        # 容量上限：0（默认）表示不限，只有后台显式配置才生效
        cap = int(game.param(cfg, "tank_capacity") or 0)
        if cap > 0:
            free = cap - len(fish_list)
            if free <= 0:
                raise HTTPException(400, f"鱼缸最多养 {cap} 条鱼")
            if count > free:
                raise HTTPException(
                    400, f"鱼缸最多养 {cap} 条鱼，现在还能买 {free} 条"
                )
        total = round(price * count, 2)
        if tank["coins"] < total:
            if count == 1:
                raise HTTPException(400, f"金币不足，{sp['name']}需要 {price:g} 金币")
            raise HTTPException(
                400,
                f"金币不足，{sp['name']} ×{count} 需要 {total:g} 金币，"
                f"现有 {tank['coins']:.1f}",
            )
        base = (body.name or "").strip()[:12]
        tank["coins"] = tank["coins"] - total
        now = time.time()
        for i in range(count):
            # 只有买单条时才用调用方给的名字，多条各自随机起名，避免重名
            name = base if (base and count == 1) else random.choice(DEFAULT_NAMES)
            conn.execute(
                "INSERT INTO fish(tank_id, name, growth, hunger, hue, species, born) "
                "VALUES(?,?,?,?,?,?,?)",
                (tank["id"], name, 0.0, 70.0, random.randint(0, 359), key, now + i * 0.001),
            )
        save_world(conn, tank, fish_list)
        fish_list = get_fish(conn, tank["id"])
        data = serialize(tank, fish_list, gain, tank_title(conn, tank["id"]), cfg)
    data["bought"] = {
        "count": count,
        "spent": total,
        "unit_price": price,
        "key": key,
        "species": sp["name"],
    }
    return data


@app.post("/api/fish/batch")
def add_fish_batch(body: FishBatchCreate, request: Request):
    """一次购买多种鱼苗：合并校验总价与容量，原子扣费后整批入缸。

    单条 /api/fish 保留不变；本接口专供前端「购物车」多选一次结算。
    """
    # 先合并同类项，拒绝非法数量
    merged: dict[str, int] = {}
    for item in body.items:
        key = (item.species or "").strip()
        cnt = int(item.count)
        if cnt <= 0:
            continue
        if cnt > 999:
            raise HTTPException(400, "单种鱼苗一次最多买 999 条")
        merged[key] = merged.get(key, 0) + cnt
    if not merged:
        raise HTTPException(400, "请先选择鱼苗和数量")

    with _lock, db.session() as conn:
        user = current_user(request, conn)
        cfg = config.load(conn)
        shop = {sp["key"]: sp for sp in game.shop_catalog(cfg)}
        plans = []
        for key, cnt in merged.items():
            sp = shop.get(key)
            if not sp:
                raise HTTPException(400, f"没有这种鱼苗：{key}")
            plans.append((key, sp, cnt, round(float(sp["price"]) * cnt, 2)))

        total_count = sum(cnt for _, _, cnt, _ in plans)
        total = round(sum(amount for _, _, _, amount in plans), 2)
        tank, fish_list, gain = advance(conn, user["id"], cfg)

        cap = int(game.param(cfg, "tank_capacity") or 0)
        if cap > 0:
            free = cap - len(fish_list)
            if total_count > free:
                raise HTTPException(
                    400, f"鱼缸最多养 {cap} 条鱼，现在还能买 {free} 条"
                )
        if tank["coins"] < total:
            raise HTTPException(
                400, f"金币不足，本次共需 {total:g} 金币，现有 {tank['coins']:.1f}"
            )

        tank["coins"] = round(tank["coins"] - total, 2)
        now = time.time()
        seq = 0
        for key, sp, cnt, _ in plans:
            for _ in range(cnt):
                conn.execute(
                    "INSERT INTO fish(tank_id, name, growth, hunger, hue, species, born) "
                    "VALUES(?,?,?,?,?,?,?)",
                    (tank["id"], random.choice(DEFAULT_NAMES), 0.0, 70.0,
                     random.randint(0, 359), key, now + seq * 0.001),
                )
                seq += 1
        save_world(conn, tank, fish_list)
        fish_list = get_fish(conn, tank["id"])
        data = serialize(tank, fish_list, gain, tank_title(conn, tank["id"]), cfg)

    data["bought"] = {
        "count": total_count,
        "spent": total,
        "items": [
            {"key": key, "species": sp["name"], "count": cnt,
             "unit_price": float(sp["price"]), "amount": amount}
            for key, sp, cnt, amount in plans
        ],
    }
    return data


@app.post("/api/title")
def rename_tank(body: TitleReq, request: Request):
    """改鱼缸名（顶部标题），任意字符。"""
    title = clean_name(body.title, "鱼缸名", 24)
    with _lock, db.session() as conn:
        user = current_user(request, conn)
        cfg = config.load(conn)
        tank, fish_list, gain = advance(conn, user["id"], cfg)
        conn.execute(
            "INSERT INTO tank_meta(tank_id, title) VALUES(?,?) "
            "ON CONFLICT(tank_id) DO UPDATE SET title=excluded.title",
            (tank["id"], title),
        )
        conn.commit()
        return serialize(tank, fish_list, gain, title, cfg)


@app.post("/api/fish/name")
def rename_fish(body: FishRename, request: Request):
    """给单条鱼改名，任意字符。"""
    name = clean_name(body.name, "鱼名", 16)
    with _lock, db.session() as conn:
        user = current_user(request, conn)
        cfg = config.load(conn)
        tank, fish_list, gain = advance(conn, user["id"], cfg)
        target = next((f for f in fish_list if f["id"] == body.fish_id), None)
        if not target:
            raise HTTPException(404, "这条鱼不在你的鱼缸里")
        conn.execute("UPDATE fish SET name=? WHERE id=?", (name, body.fish_id))
        conn.commit()
        fish_list = get_fish(conn, tank["id"])
        return serialize(tank, fish_list, gain, tank_title(conn, tank["id"]), cfg)


@app.post("/api/fish/sell")
def sell_fish(body: FishSell, request: Request):
    """卖出满级鱼（成长到顶级「锦鲤」，所有鱼种通用）。校验后删除鱼并把卖价入账。"""
    with _lock, db.session() as conn:
        user = current_user(request, conn)
        cfg = config.load(conn)
        tank, fish_list, gain = advance(conn, user["id"], cfg)
        target = next((f for f in fish_list if f["id"] == body.fish_id), None)
        if not target:
            raise HTTPException(404, "这条鱼不在你的鱼缸里")
        if not game.is_max_level(target):
            st = game.stage_of(target["growth"])
            top = game.STAGES[-1]["name"]
            raise HTTPException(400, f"还没满级，当前是「{st['name']}」，养到顶级「{top}」才能卖")
        sell = game.sell_value(target, cfg)
        price = float(sell["price"])
        # 删除鱼 + 金币入账（原子）
        conn.execute("DELETE FROM fish WHERE id=? AND tank_id=?", (body.fish_id, tank["id"]))
        tank["coins"] = round(float(tank["coins"]) + price, 2)
        save_world(conn, tank, [f for f in fish_list if f["id"] != body.fish_id])
        fish_list = get_fish(conn, tank["id"])
        data = serialize(tank, fish_list, gain, tank_title(conn, tank["id"]), cfg)
    data["sold"] = {
        "id": body.fish_id,
        "name": target["name"],
        "buy_price": sell["buy_price"],
        "price": price,
        "from_buy": sell["from_buy"],
        "from_food": sell["from_food"],
        "mult": sell["mult"],
        "fed": sell["fed"],
    }
    return data


@app.post("/api/feed")
def feed(body: FeedReq, request: Request):
    with _lock, db.session() as conn:
        user = current_user(request, conn)
        cfg = config.load(conn)
        tank, fish_list, gain = advance(conn, user["id"], cfg)
        target = next((f for f in fish_list if f["id"] == body.fish_id), None)
        if not target:
            raise HTTPException(404, "这条鱼不在你的鱼缸里")
        if tank["food"] <= 0:
            raise HTTPException(400, "没有饲料了，先去买一些")
        if target["hunger"] >= 100:
            raise HTTPException(400, f"{target['name']} 已经吃饱了")
        tank["food"] -= 1
        target["hunger"] = min(100.0, target["hunger"] + float(game.param(cfg, "feed_amount")))
        target["fed"] = int(target.get("fed") or 0) + 1   # 累计投喂份数，供卖价折算饲料钱
        save_world(conn, tank, fish_list)
        return serialize(tank, fish_list, gain, tank_title(conn, tank["id"]), cfg)


# 一键投喂的筛选门槛：饱食低于该值的鱼才参与投喂；喂时每条喂一包（+feed_amount），
# 与单条喂食 /api/feed 一致，喂完可超过 80%（如 79→89），仅以 100% 为上限。
FEED_ALL_CAP = 80.0


@app.post("/api/feed-all")
def feed_all(request: Request):
    """一键投喂：把饱食不高于 80% 的鱼喂到 80% 以上（严格 >80，上限 100%）。

    80% 是目标线，不是封顶：每条鱼按需消耗若干包，喂到超过 80% 立即停。
    例如每包 +10 时，79 → 89（1 包），70 → 90（2 包），80 → 90（1 包）；
    本来已超过 80% 的鱼不参与。饲料不足时按最饿优先，能喂几包喂几包。
    """
    with _lock, db.session() as conn:
        user = current_user(request, conn)
        cfg = config.load(conn)
        tank, fish_list, gain = advance(conn, user["id"], cfg)
        per = float(game.param(cfg, "feed_amount"))
        if per <= 0:
            raise HTTPException(400, "投喂参数异常，请联系管理员")

        def packs_to_exceed(hunger: float) -> int:
            """让 hunger 严格超过目标线所需的最少包数。"""
            if float(hunger) > FEED_ALL_CAP:
                return 0
            return int((FEED_ALL_CAP - float(hunger)) / per) + 1

        # 饱食 <=80 才需要喂（80 本身还没超过目标线）
        hungry = [f for f in fish_list if float(f["hunger"]) <= FEED_ALL_CAP]
        total_need = sum(packs_to_exceed(f["hunger"]) for f in hungry)

        packs = 0
        fed = 0
        fed_ids = []
        # 先喂最饿的，饲料不够时优先救回即将停滞的鱼
        for f in sorted(hungry, key=lambda item: item["hunger"]):
            need = packs_to_exceed(f["hunger"])
            given = 0
            while given < need and int(tank["food"]) > 0:
                tank["food"] = int(tank["food"]) - 1
                f["hunger"] = min(100.0, float(f["hunger"]) + per)
                f["fed"] = int(f.get("fed") or 0) + 1     # 累计投喂份数，供卖价折算饲料钱
                packs += 1
                given += 1
            if given:
                fed += 1
                fed_ids.append(f["id"])

        if packs:
            save_world(conn, tank, fish_list)

        data = serialize(tank, fish_list, gain, tank_title(conn, tank["id"]), cfg)
        data["feed_all"] = {
            "packs": packs,            # 本次消耗的饲料包数
            "fish": fed,               # 本次被投喂的鱼数
            "need": total_need,        # 把目标鱼都喂到 >80 所需总包数
            "short": max(0, total_need - packs),   # 还差多少包
            "hungry": len(hungry),     # 投喂前饱食不高于 80% 的鱼数
            "food": int(tank["food"]),  # 剩余饲料
            "cap": int(FEED_ALL_CAP),  # 一键投喂目标线（%）
            "fed_ids": fed_ids,        # 本次实际被投喂的鱼 id，供前端播放动画
        }
        return data


@app.post("/api/food")
def buy_food(request: Request):
    with _lock, db.session() as conn:
        user = current_user(request, conn)
        cfg = config.load(conn)
        price = float(game.param(cfg, "food_pack_price"))
        size = int(game.param(cfg, "food_pack_size"))
        tank, fish_list, gain = advance(conn, user["id"], cfg)
        if tank["coins"] < price:
            raise HTTPException(400, f"金币不足，需要 {price:g} 金币")
        tank["coins"] -= price
        tank["food"] += size          # 饲料不设上限，可以一直囤
        save_world(conn, tank, fish_list)
        return serialize(tank, fish_list, gain, tank_title(conn, tank["id"]), cfg)


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


# ---------------------------------------------------------------- 后台管理接口

def admin_payload(conn) -> dict:
    """后台读参数：全局字段定义 + 当前值 + 鱼种表（含使用量）+ 出厂默认值。"""
    cfg = config.load(conn)
    usage = config.species_usage(conn)
    adm = config.admin_row(conn)
    cap = int(cfg["params"]["tank_capacity"] or 0)
    return {
        "admin": {"username": adm["username"] if adm else config.ADMIN_USERNAME},
        "fields": config.GLOBAL_FIELDS,
        "params": cfg["params"],
        "species": [
            dict(sp, used=usage.get(sp["key"], 0)) for sp in cfg["species"]
        ],
        "looks": config.FISH_LOOKS,
        "defaults": {
            "params": config.DEFAULT_PARAMS,
            "species": config.DEFAULT_SPECIES,
        },
        "capacity": {"unlimited": cap <= 0, "value": cap},
    }


@app.get("/api/admin/me")
def admin_me(request: Request):
    if not is_admin(request):
        return {"logged_in": False}
    with db.session() as conn:
        adm = config.admin_row(conn)
    return {"logged_in": True, "username": adm["username"] if adm else config.ADMIN_USERNAME}


@app.post("/api/admin/login")
def admin_login(body: Credentials, response: Response):
    with db.session() as conn:
        ok = config.check_admin(conn, body.username, body.password)
    if not ok:
        raise HTTPException(400, "管理员账号或密码错误")
    response.set_cookie(ADMIN_COOKIE, make_admin_session(), max_age=ADMIN_SESSION_AGE,
                        httponly=True, samesite="lax")
    return {"ok": True}


@app.post("/api/admin/logout")
def admin_logout(response: Response):
    response.delete_cookie(ADMIN_COOKIE)
    return {"ok": True}


@app.get("/api/admin/config")
def admin_get_config(request: Request):
    require_admin(request)
    with db.session() as conn:
        return admin_payload(conn)


@app.post("/api/admin/config")
def admin_save_config(body: AdminConfigReq, request: Request):
    """保存全局参数与鱼种表；保存后立即生效（读取走每次请求的快照）。"""
    require_admin(request)
    warnings = []
    try:
        with _lock, db.session() as conn:
            config.save_params(conn, body.params)
            if body.species:
                warnings = config.save_species(conn, body.species)
            data = admin_payload(conn)
    except ValueError as exc:
        raise HTTPException(400, str(exc))
    data["ok"] = True
    data["warnings"] = warnings
    return data


@app.post("/api/admin/password")
def admin_change_password(body: AdminPwdReq, request: Request):
    require_admin(request)
    if not (6 <= len(body.new or "") <= 64):
        raise HTTPException(400, "新密码需 6-64 位")
    with _lock, db.session() as conn:
        adm = config.admin_row(conn)
        if not adm or not config.verify_password(body.old or "", adm["pwd"]):
            raise HTTPException(400, "原密码不正确")
        config.set_admin_password(conn, body.new)
    return {"ok": True}


db.init_db()
