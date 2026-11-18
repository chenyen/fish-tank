"""运行参数中心：后台可配置 + 数据库持久化 + 请求级快照

设计要点
--------
1. 所有可变运行参数都落在 SQLite 里（`settings` / `species` / `admins` 三张表），
   后台保存后下一次请求调用 `load()` 就能拿到新值，**无需重启服务**。
2. `load()` 返回一个纯 dict 快照，`game.py` 只依赖这个入参，不直接读库，
   所以核心规则仍然可以脱离 Web / 数据库独立单测。
3. 管理员初始账号见下方常量，README 同步说明；登录后可在后台修改密码。
"""
import hashlib
import hmac
import json
import os
import re
import time

# ---------------------------------------------------------------- 管理员

ADMIN_USERNAME = "admin"
ADMIN_INITIAL_PASSWORD = "fishtank-admin"   # 首次启动时写入数据库，登录后可在后台修改
PASSWORD_ITER = 120_000

# ---------------------------------------------------------------- 建表

SCHEMA = """
CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS species (
    key     TEXT PRIMARY KEY,
    name    TEXT NOT NULL,
    price   REAL NOT NULL,
    size    REAL NOT NULL,
    coin    REAL NOT NULL,
    desc    TEXT NOT NULL DEFAULT '',
    sort    INTEGER NOT NULL DEFAULT 0,
    enabled INTEGER NOT NULL DEFAULT 1,
    look    TEXT NOT NULL DEFAULT 'carp'
);

CREATE TABLE IF NOT EXISTS admins (
    id      INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    pwd      TEXT NOT NULL,
    created  REAL NOT NULL
);
"""

# ---------------------------------------------------------------- 全局参数定义

# type: int / float；min / max 为允许区间；default 为出厂值。
GLOBAL_FIELDS = [
    {"key": "payout_interval", "label": "产币结算间隔", "type": "int", "min": 10,
     "max": 86400, "step": 1, "unit": "秒", "default": 3600,
     "hint": "产出每秒累积到「待收」，每隔这么久入账一次；3600 = 每小时整点结算",
     "group": "产币与经济"},
    {"key": "initial_coins", "label": "初始金币", "type": "float", "min": 0,
     "max": 100000, "step": 1, "unit": "金币", "default": 30.0,
     "hint": "新玩家注册时发放的金币", "group": "产币与经济"},
    {"key": "food_pack_size", "label": "每包饲料份数", "type": "int", "min": 1,
     "max": 999, "step": 1, "unit": "份", "default": 5,
     "hint": "购买一次得到多少份饲料", "group": "饲料"},
    {"key": "food_pack_price", "label": "每包饲料价格", "type": "float", "min": 0,
     "max": 99999, "step": 1, "unit": "金币", "default": 8.0,
     "hint": "购买一包饲料花费的金币", "group": "饲料"},
    {"key": "feed_amount", "label": "每次投喂恢复", "type": "float", "min": 1,
     "max": 100, "step": 1, "unit": "饱食点", "default": 20.0,
     "hint": "点一次喂食恢复的饱食度，满值是 100；一键投喂把饱食不高于 80% 的鱼喂到 80% 以上，按需可喂多包", "group": "饲料"},
    {"key": "food_regen_sec", "label": "饲料自然恢复间隔", "type": "int", "min": 0,
     "max": 86400, "step": 1, "unit": "秒", "default": 900,
     "hint": "每隔这么久自然 +1 份饲料；填 0 表示不再自然恢复（饲料不设上限，可以一直囤）",
     "group": "饲料"},
    {"key": "initial_food", "label": "初始饲料", "type": "int", "min": 0,
     "max": 999, "step": 1, "unit": "份", "default": 5,
     "hint": "新玩家注册时发放的饲料", "group": "鱼缸"},
    {"key": "tank_capacity", "label": "鱼缸容量上限", "type": "int", "min": 0,
     "max": 999, "step": 1, "unit": "条", "default": 0,
     "hint": "0 = 不限（默认，缸内养鱼数量取消上限）；填大于 0 才按上限限制购鱼",
     "group": "鱼缸"},
    {"key": "growth_per_sec", "label": "每秒基础成长", "type": "float", "min": 0,
     "max": 5, "step": 0.001, "unit": "点/秒", "default": 0.0133, "decimals": 4,
     "hint": "「正常」档的成长速度；0.0133 约等于每分钟 0.8 点（每小时 48 点），实际速度再乘下面的档位系数",
     "group": "成长（饱食度）"},
    {"key": "growth_hunger_full", "label": "饱满阈值", "type": "float", "min": 0,
     "max": 100, "step": 1, "unit": "饱食", "default": 80.0,
     "hint": "饱食度 ≥ 该值时按「饱满」档成长；4 个阈值从高到低依次判定",
     "group": "成长（饱食度）"},
    {"key": "growth_hunger_normal", "label": "正常阈值", "type": "float", "min": 0,
     "max": 100, "step": 1, "unit": "饱食", "default": 60.0,
     "hint": "饱食度 ≥ 该值（但没到饱满）时按「正常」档成长",
     "group": "成长（饱食度）"},
    {"key": "growth_hunger_low", "label": "偏低阈值", "type": "float", "min": 0,
     "max": 100, "step": 1, "unit": "饱食", "default": 30.0,
     "hint": "饱食度 ≥ 该值时按「缓慢」档成长",
     "group": "成长（饱食度）"},
    {"key": "growth_hunger_stall", "label": "停滞阈值", "type": "float", "min": 0,
     "max": 100, "step": 1, "unit": "饱食", "default": 10.0,
     "hint": "饱食度 ≥ 该值时按「停滞」档成长；低于该值完全停止生长（喂食后自动恢复）",
     "group": "成长（饱食度）"},
    {"key": "growth_rate_full", "label": "饱满成长系数", "type": "float", "min": 0,
     "max": 5, "step": 0.05, "unit": "倍", "default": 1.2,
     "hint": "饱食度 ≥ 饱满阈值时的成长倍率",
     "group": "成长（饱食度）"},
    {"key": "growth_rate_normal", "label": "正常成长系数", "type": "float", "min": 0,
     "max": 5, "step": 0.05, "unit": "倍", "default": 1.0,
     "hint": "饱食度在「正常」档时的成长倍率，1 倍 = 每秒基础成长",
     "group": "成长（饱食度）"},
    {"key": "growth_rate_low", "label": "缓慢成长系数", "type": "float", "min": 0,
     "max": 5, "step": 0.05, "unit": "倍", "default": 0.6,
     "hint": "饱食度在「缓慢」档时的成长倍率",
     "group": "成长（饱食度）"},
    {"key": "growth_rate_stall", "label": "停滞成长系数", "type": "float", "min": 0,
     "max": 5, "step": 0.05, "unit": "倍", "default": 0.25,
     "hint": "饱食度在「停滞」档时的成长倍率；填 0 等同于该档也停止生长",
     "group": "成长（饱食度）"},
]

DEFAULT_PARAMS = {f["key"]: f["default"] for f in GLOBAL_FIELDS}
PARAM_FIELDS = {f["key"]: f for f in GLOBAL_FIELDS}

# ---------------------------------------------------------------- 鱼种定义

DEFAULT_SPECIES = [
    {"key": "carp", "name": "鲤鱼", "price": 20.0, "size": 0.85, "coin": 1.0,
     "look": "carp", "desc": "好养活的常规鱼苗，游动活跃，产币稳定", "sort": 0, "enabled": 1},
    {"key": "clown", "name": "小丑鱼", "price": 30.0, "size": 0.75, "coin": 1.25,
     "look": "clown", "desc": "橙白条纹的小家伙，爱在中层来回穿梭，灵活又耐看", "sort": 1, "enabled": 1},
    {"key": "shark", "name": "鲨鱼", "price": 60.0, "size": 1.9, "coin": 1.8,
     "look": "shark", "desc": "缸里体型最大的家伙，巡游范围广、产币最多，价格也最贵", "sort": 2, "enabled": 1},
    {"key": "shrimp", "name": "小虾", "price": 12.0, "size": 0.55, "coin": 0.5,
     "look": "shrimp", "desc": "只贴着缸底短距离挪动，大部分时间趴着不动", "sort": 3, "enabled": 1},
    {"key": "clam", "name": "砗磲", "price": 35.0, "size": 1.0, "coin": 0.8,
     "look": "clam", "desc": "基本不移动，安静地一张一合扇动贝壳", "sort": 4, "enabled": 1},
]

# ---------------------------------------------------------------- 外观造型库

# 鱼种「外观」可选项：同一套 key 前后台共用，后台选择后前台按此造型绘制。
# hue 是外观库的预览底色，缸内每条鱼的 hue 仍由个体随机值决定。
FISH_LOOKS = [
    {"key": "carp", "label": "鲤鱼", "icon": "🐟", "hue": 28,
     "desc": "圆润身体 + 扇尾，最通用的小鱼"},
    {"key": "clown", "label": "小丑鱼", "icon": "🐠", "hue": 22,
     "desc": "橙底白纹，中层穿梭很灵动"},
    {"key": "shark", "label": "鲨鱼", "icon": "🦈", "hue": 205,
     "desc": "尖吻大背鳍，巡游范围广"},
    {"key": "shrimp", "label": "小虾", "icon": "🦐", "hue": 12,
     "desc": "分节身体和长触须，贴底爬行"},
    {"key": "clam", "label": "砗磲", "icon": "🐚", "hue": 186,
     "desc": "落底不动，两片壳慢慢开合"},
    {"key": "goldfish", "label": "金鱼", "icon": "🐡", "hue": 35,
     "desc": "鼓眼睛 + 双纱尾，慢悠悠地摆动"},
    {"key": "koi", "label": "锦鲤", "icon": "🐟", "hue": 8,
     "desc": "白底红斑的宽尾锦鲤，气定神闲"},
    {"key": "guppy", "label": "孔雀鱼", "icon": "🐠", "hue": 168,
     "desc": "小巧身体拖着彩色大尾巴"},
    {"key": "angelfish", "label": "神仙鱼", "icon": "🐟", "hue": 46,
     "desc": "三角侧扁身体，长鳍优雅漂游"},
    {"key": "tetra", "label": "灯鱼", "icon": "🐟", "hue": 190,
     "desc": "细长身形，侧边一条霓虹灯带"},
    {"key": "puffer", "label": "河豚", "icon": "🐡", "hue": 46,
     "desc": "圆鼓鼓的身体，小鳍快速扑腾"},
    {"key": "seahorse", "label": "海马", "icon": "🐴", "hue": 150,
     "desc": "卷曲尾巴，悬停在水中微微起伏"},
]
LOOK_KEYS = {look["key"] for look in FISH_LOOKS}


def normalize_look(value, key=None) -> str:
    """外观值必须是造型库中的 key；缺省时按鱼种标识猜测，再回落到鲤鱼。"""
    look = str(value or "").strip().lower()
    if look in LOOK_KEYS:
        return look
    if key in LOOK_KEYS:
        return key
    return "carp"


KEY_RE = re.compile(r"^[a-z][a-z0-9_]{1,23}$")


# ---------------------------------------------------------------- 口令

def hash_password(pwd: str) -> str:
    salt = os.urandom(16).hex()
    dk = hashlib.pbkdf2_hmac("sha256", pwd.encode(), salt.encode(), PASSWORD_ITER).hex()
    return f"{salt}${dk}"


def verify_password(pwd: str, stored: str) -> bool:
    try:
        salt, dk = (stored or "").split("$", 1)
    except ValueError:
        return False
    calc = hashlib.pbkdf2_hmac("sha256", pwd.encode(), salt.encode(), PASSWORD_ITER).hex()
    return hmac.compare_digest(calc, dk)


# ---------------------------------------------------------------- 初始化

def ensure_seed(conn) -> None:
    """建表 + 首次写入出厂参数、默认鱼种、管理员账号。"""
    conn.executescript(SCHEMA)
    # 老库兼容：早期 species 表没有 look 列，补列后把原有鱼种映射到同名造型
    cols = {row["name"] for row in conn.execute("PRAGMA table_info(species)").fetchall()}
    if "look" not in cols:
        conn.execute("ALTER TABLE species ADD COLUMN look TEXT NOT NULL DEFAULT 'carp'")
        for key in LOOK_KEYS:
            conn.execute("UPDATE species SET look=? WHERE key=?", (key, key))
    if not conn.execute("SELECT 1 FROM settings WHERE key='global'").fetchone():
        conn.execute(
            "INSERT INTO settings(key, value) VALUES('global', ?)",
            (json.dumps(DEFAULT_PARAMS, ensure_ascii=False),),
        )
    if not conn.execute("SELECT COUNT(*) AS c FROM species").fetchone()["c"]:
        for sp in DEFAULT_SPECIES:
            _insert_species(conn, sp)
    if not conn.execute("SELECT COUNT(*) AS c FROM admins").fetchone()["c"]:
        conn.execute(
            "INSERT INTO admins(username, pwd, created) VALUES(?,?,?)",
            (ADMIN_USERNAME, hash_password(ADMIN_INITIAL_PASSWORD), time.time()),
        )
    conn.commit()


def _insert_species(conn, sp: dict) -> None:
    conn.execute(
        """INSERT INTO species(key, name, price, size, coin, desc, sort, enabled, look)
           VALUES(?,?,?,?,?,?,?,?,?)
           ON CONFLICT(key) DO UPDATE SET name=excluded.name, price=excluded.price,
             size=excluded.size, coin=excluded.coin, desc=excluded.desc,
             sort=excluded.sort, enabled=excluded.enabled, look=excluded.look""",
        (sp["key"], sp["name"], float(sp["price"]), float(sp["size"]),
         float(sp["coin"]), sp.get("desc", ""), int(sp.get("sort", 0)),
         1 if sp.get("enabled", 1) else 0, normalize_look(sp.get("look"), sp["key"])),
    )


# ---------------------------------------------------------------- 读快照

def load(conn) -> dict:
    """读取一份参数快照（每次请求调用，保证后台改完立即生效）。"""
    raw = {}
    for row in conn.execute("SELECT key, value FROM settings").fetchall():
        raw[row["key"]] = row["value"]

    params = dict(DEFAULT_PARAMS)
    try:
        stored = json.loads(raw.get("global") or "{}")
    except (ValueError, TypeError):
        stored = {}
    if isinstance(stored, dict):
        for key, field in PARAM_FIELDS.items():
            if key not in stored:
                continue
            try:
                num = float(stored[key])
            except (TypeError, ValueError):
                continue
            num = max(field["min"], min(field["max"], num))
            params[key] = int(round(num)) if field["type"] == "int" else round(num, field.get("decimals", 2))

    species = []
    for row in conn.execute("SELECT * FROM species ORDER BY sort, key").fetchall():
        species.append({
            "key": row["key"],
            "name": row["name"],
            "price": float(row["price"]),
            "size": float(row["size"]),
            "coin": float(row["coin"]),
            "desc": row["desc"] or "",
            "sort": int(row["sort"]),
            "enabled": int(row["enabled"]),
            "look": normalize_look(row["look"] if "look" in row.keys() else "", row["key"]),
        })
    if not species:
        species = [dict(s) for s in DEFAULT_SPECIES]

    shop = [s for s in species if s["enabled"]]
    if not shop:
        shop = [species[0]]

    return {
        "params": params,
        "species": species,                                  # 含已下架，供老鱼还原外观
        "species_map": {s["key"]: s for s in species},
        "shop": shop,                                        # 仅上架，供购买列表
        "default": shop[0]["key"],
    }


# ---------------------------------------------------------------- 写全局参数

def clean_params(raw, base=None) -> dict:
    out = dict(base or DEFAULT_PARAMS)
    if raw is None:
        return out
    if not isinstance(raw, dict):
        raise ValueError("参数格式不正确")
    for key, value in raw.items():
        field = PARAM_FIELDS.get(key)
        if not field:
            continue                     # 未知键直接忽略，避免脏数据入库
        try:
            num = float(value)
        except (TypeError, ValueError):
            raise ValueError(f"「{field['label']}」必须是数字")
        if num < field["min"] or num > field["max"]:
            raise ValueError(
                f"「{field['label']}」需在 {field['min']} ~ {field['max']} 之间"
            )
        out[key] = int(round(num)) if field["type"] == "int" else round(num, field.get("decimals", 2))
    return out


def save_params(conn, raw) -> dict:
    # 以库中当前值为基底，只覆盖本次提交的键，避免部分提交把其它参数打回默认值
    base = dict(DEFAULT_PARAMS)
    row = conn.execute("SELECT value FROM settings WHERE key='global'").fetchone()
    if row and row["value"]:
        try:
            saved = json.loads(row["value"])
            if isinstance(saved, dict):
                base.update({k: v for k, v in saved.items() if k in PARAM_FIELDS})
        except (ValueError, TypeError):
            pass
    params = clean_params(raw, base)
    conn.execute(
        "INSERT INTO settings(key, value) VALUES('global', ?) "
        "ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        (json.dumps(params, ensure_ascii=False),),
    )
    conn.commit()
    return params


# ---------------------------------------------------------------- 写鱼种

def clean_species_list(raw) -> list:
    if not isinstance(raw, list) or not raw:
        raise ValueError("至少要保留一个鱼种")
    out, seen = [], set()
    for i, item in enumerate(raw):
        if not isinstance(item, dict):
            raise ValueError(f"第 {i + 1} 个鱼种的数据格式不正确")
        key = str(item.get("key") or "").strip().lower()
        if not KEY_RE.match(key):
            raise ValueError(
                f"第 {i + 1} 个鱼种的标识不合法：需小写字母开头，2-24 位字母 / 数字 / 下划线"
            )
        if key in seen:
            raise ValueError(f"鱼种标识重复：{key}")
        seen.add(key)
        name = str(item.get("name") or "").strip()
        if not (1 <= len(name) <= 20):
            raise ValueError(f"「{key}」的名称需 1-20 个字符")
        try:
            price = round(float(item.get("price", 0)), 2)
            size = round(float(item.get("size", 1.0)), 2)
            coin = round(float(item.get("coin", 1.0)), 2)
        except (TypeError, ValueError):
            raise ValueError(f"「{name}」的价格 / 体型 / 产币系数必须是数字")
        if not (0 <= price <= 1_000_000):
            raise ValueError(f"「{name}」的价格需在 0 ~ 1000000 之间")
        if not (0.2 <= size <= 4):
            raise ValueError(f"「{name}」的体型系数需在 0.2 ~ 4 之间（1 = 标准体型）")
        if not (0 <= coin <= 100):
            raise ValueError(f"「{name}」的产币系数需在 0 ~ 100 之间（1 = 标准产币）")
        desc = str(item.get("desc") or "").strip()[:200]
        look = normalize_look(item.get("look"), key)
        out.append({
            "key": key, "name": name, "price": price, "size": size,
            "coin": coin, "desc": desc, "sort": i, "look": look,
            "enabled": 1 if item.get("enabled", 1) else 0,
        })
    if not any(s["enabled"] for s in out):
        raise ValueError("至少要有一个上架状态的鱼种")
    return out


def save_species(conn, raw) -> list:
    """整表保存：新增/修改直接覆盖，缺席的鱼种按「是否还被鱼使用」下架或删除。"""
    items = clean_species_list(raw)
    warnings = []
    for sp in items:
        _insert_species(conn, sp)
    keep = {s["key"] for s in items}
    for row in conn.execute("SELECT key, name FROM species").fetchall():
        if row["key"] in keep:
            continue
        used = conn.execute(
            "SELECT COUNT(*) AS c FROM fish WHERE species=?", (row["key"],)
        ).fetchone()["c"]
        if used:
            conn.execute("UPDATE species SET enabled=0 WHERE key=?", (row["key"],))
            warnings.append(
                f"「{row['name']}」还有 {used} 条鱼在用，已改为下架：不再出现在购买列表，"
                f"已有的鱼外观与数值保持不变"
            )
        else:
            conn.execute("DELETE FROM species WHERE key=?", (row["key"],))
            warnings.append(f"「{row['name']}」没有鱼在用，已从鱼种表删除")
    conn.commit()
    return warnings


def species_usage(conn) -> dict:
    rows = conn.execute("SELECT species, COUNT(*) AS c FROM fish GROUP BY species").fetchall()
    return {r["species"]: int(r["c"]) for r in rows}


# ---------------------------------------------------------------- 管理员账号

def admin_row(conn):
    return conn.execute("SELECT * FROM admins ORDER BY id LIMIT 1").fetchone()


def check_admin(conn, username: str, password: str) -> bool:
    row = conn.execute(
        "SELECT * FROM admins WHERE username=?", ((username or "").strip(),)
    ).fetchone()
    if not row:
        return False
    return verify_password(password or "", row["pwd"])


def set_admin_password(conn, new_password: str) -> None:
    row = admin_row(conn)
    if not row:
        raise ValueError("管理员账号不存在")
    conn.execute("UPDATE admins SET pwd=? WHERE id=?", (hash_password(new_password), row["id"]))
    conn.commit()
