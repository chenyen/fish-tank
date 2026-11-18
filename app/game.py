"""虚拟养鱼 - 核心规则（纯函数，无 IO，可独立测试）

金币体系：
1. 每条鱼按「阶段」有基础产币率（币/小时，100% 产能）；
2. 产出按秒累积到「待收」，每隔「结算间隔」入账一次（后台可配，默认整点结算）；
3. 饱食度决定产能系数（阶梯），饿了产量按档位衰减，饿死为 0；
4. 鱼进阶（阶段提升）时一次性发放金币奖励，立即入账；
5. 离线时间按固定步长模拟，单次最多补偿 24 小时。

运行参数（结算间隔、饲料包、投喂量、自然恢复、初始资源、鱼缸容量）与鱼种表
（名称 / 价格 / 体型 / 产币系数 / 描述）都不再写死在这里，而是由 `app/config.py`
从数据库读出快照后以 `cfg` 入参传入；不传 `cfg` 时退回下方默认值，方便单测。
"""
import math

MAX_OFFLINE = 24 * 3600          # 单次最多补偿 24 小时
SIM_STEP = 30                    # 模拟步长（秒）

# 数值设定（饥饿曲线为固定规则；成长曲线由后台参数驱动，见下方 DEFAULT_PARAMS）
HUNGER_DECAY_PER_SEC = 1 / 180   # 每 3 分钟饿 1 点，满饱食可撑 5 小时
GROWTH_PER_SEC = 1 / 75          # 兼容旧名：默认「正常」档每分钟成长 0.8 点（约 48/小时）
GROWTH_HUNGER_MIN = 1            # 兼容旧名：真正的停止阈值现在由 growth_hunger_stall 决定

# 饱食度 → 成长档位（阈值 / 系数全部可在后台配置）
# (档位 key, 显示名, 阈值参数键, 系数参数键, 出厂阈值, 出厂系数)
GROWTH_TIERS = [
    ("full", "生长加成", "growth_hunger_full", "growth_rate_full", 80.0, 1.2),
    ("normal", "正常", "growth_hunger_normal", "growth_rate_normal", 60.0, 1.0),
    ("low", "缓慢", "growth_hunger_low", "growth_rate_low", 30.0, 0.6),
    ("stall", "停滞", "growth_hunger_stall", "growth_rate_stall", 10.0, 0.25),
]
# 低于最低档阈值时的状态（完全停止生长）
GROWTH_STOP_KEY = "stop"
GROWTH_STOP_LABEL = "停止成长"

# ---------------------------------------------------------------- 默认运行参数
# 与 app/config.py 的出厂值保持一致；后台保存后以数据库为准。
DEFAULT_PARAMS = {
    "payout_interval": 3600,     # 产币结算间隔（秒），3600 = 每小时整点
    "food_pack_size": 5,         # 一份饲料包数量
    "food_pack_price": 8.0,      # 一份饲料包价格
    "feed_amount": 20.0,         # 每次投喂恢复的饱食度
    "food_regen_sec": 900,       # 饲料自然恢复间隔（秒），0 = 不自然恢复
    "initial_coins": 30.0,       # 新玩家初始金币
    "initial_food": 5,           # 新玩家初始饲料
    "tank_capacity": 0,          # 鱼缸容量上限，0 = 不限
    "growth_per_sec": 0.0133,    # 「正常」档每秒成长值（约 48 点/小时）
    "growth_hunger_full": 80.0,      # 饱食度 ≥ 该值：成长 ×growth_rate_full
    "growth_hunger_normal": 60.0,    # 饱食度 ≥ 该值：成长 ×growth_rate_normal
    "growth_hunger_low": 30.0,       # 饱食度 ≥ 该值：成长 ×growth_rate_low
    "growth_hunger_stall": 10.0,     # 饱食度 ≥ 该值：成长 ×growth_rate_stall
    "growth_rate_full": 1.2,         # 饱满档成长倍率
    "growth_rate_normal": 1.0,       # 正常档成长倍率
    "growth_rate_low": 0.6,          # 偏低档成长倍率
    "growth_rate_stall": 0.25,       # 停滞档成长倍率（低于停滞阈值直接停长）
}

# 兼容旧代码/单测的模块级常量（仅代表默认值）
PAYOUT_INTERVAL = DEFAULT_PARAMS["payout_interval"]
FOOD_PACK = DEFAULT_PARAMS["food_pack_size"]
FOOD_PACK_PRICE = DEFAULT_PARAMS["food_pack_price"]
FEED_AMOUNT = DEFAULT_PARAMS["feed_amount"]
FOOD_REGEN_SEC = DEFAULT_PARAMS["food_regen_sec"]
TANK_CAP = DEFAULT_PARAMS["tank_capacity"]

# ---------------------------------------------------------------- 鱼种默认表
SPECIES = {
    "carp": {
        "key": "carp", "name": "鲤鱼", "price": 20, "size": 0.85, "coin": 1.0,
        "desc": "好养活的常规鱼苗，游动活跃，产币稳定",
    },
    "shark": {
        "key": "shark", "name": "鲨鱼", "price": 60, "size": 1.9, "coin": 1.8,
        "desc": "缸里体型最大的家伙，巡游范围广、产币最多，价格也最贵",
    },
    "clown": {
        "key": "clown", "name": "小丑鱼", "price": 30, "size": 0.75, "coin": 1.25,
        "desc": "橙白条纹的小家伙，爱在中层来回穿梭，灵活又耐看",
    },
    "shrimp": {
        "key": "shrimp", "name": "小虾", "price": 12, "size": 0.55, "coin": 0.5,
        "desc": "只贴着缸底短距离挪动，大部分时间趴着不动",
    },
    "clam": {
        "key": "clam", "name": "砗磲", "price": 35, "size": 1.0, "coin": 0.8,
        "desc": "基本不移动，安静地一张一合扇动贝壳",
    },
}
SPECIES_ORDER = ["carp", "clown", "shark", "shrimp", "clam"]
DEFAULT_SPECIES = "carp"
FISH_PRICE = SPECIES[DEFAULT_SPECIES]["price"]   # 默认鱼苗价格

STAGES = [
    {"key": "fry", "name": "鱼苗", "at": 0, "scale": 0.55},
    {"key": "juvenile", "name": "幼鱼", "at": 150, "scale": 0.75},
    {"key": "adult", "name": "成鱼", "at": 500, "scale": 1.0},
    {"key": "koi", "name": "锦鲤", "at": 1200, "scale": 1.2},
]

# 各阶段基础产币率（金币/小时，产能 100% 时）
COIN_RATES = {"fry": 2.0, "juvenile": 5.0, "adult": 10.0, "koi": 20.0}

# 进阶奖励（一次性，立即入账）
ADVANCE_REWARD = {"juvenile": 15.0, "adult": 40.0, "koi": 120.0}

# 饱食度 → 产能系数（阶梯）
HUNGER_TIERS = [(80, 1.0), (50, 0.8), (20, 0.5)]
HUNGER_MIN_FACTOR = 0.25


# ---------------------------------------------------------------- 参数取值

def params(cfg: dict | None = None) -> dict:
    """取全局参数快照，缺项用默认值补齐。"""
    merged = dict(DEFAULT_PARAMS)
    if cfg:
        merged.update(cfg.get("params") or {})
    return merged


def param(cfg: dict | None, key: str):
    value = params(cfg).get(key)
    return DEFAULT_PARAMS[key] if value is None else value


def payout_interval(cfg: dict | None = None) -> float:
    value = float(param(cfg, "payout_interval") or 0)
    return value if value > 0 else float(PAYOUT_INTERVAL)


# ---------------------------------------------------------------- 鱼种

def species_table(cfg: dict | None = None) -> dict:
    """key -> 鱼种信息；含已下架的鱼种，保证老鱼外观/数值不丢。"""
    if cfg and cfg.get("species_map"):
        return cfg["species_map"]
    return SPECIES


def shop_catalog(cfg: dict | None = None) -> list:
    """可购买的鱼种列表（已按后台排序）。"""
    if cfg and cfg.get("shop"):
        return [dict(s) for s in cfg["shop"]]
    return [dict(SPECIES[k]) for k in SPECIES_ORDER]


def default_species(cfg: dict | None = None) -> str:
    catalog = shop_catalog(cfg)
    return catalog[0]["key"] if catalog else DEFAULT_SPECIES


def species_of(fish: dict, cfg: dict | None = None) -> str:
    """取鱼种类，缺失或未知一律回落到默认鱼种。"""
    table = species_table(cfg)
    key = (fish or {}).get("species") or default_species(cfg)
    if key in table:
        return key
    return default_species(cfg) if default_species(cfg) in table else DEFAULT_SPECIES


def species_meta(key: str | None, cfg: dict | None = None) -> dict:
    table = species_table(cfg)
    if key and key in table:
        return table[key]
    fallback = default_species(cfg)
    return table.get(fallback) or table.get(DEFAULT_SPECIES) or SPECIES[DEFAULT_SPECIES]


def species_price(key: str | None, cfg: dict | None = None) -> float:
    return species_meta(key, cfg)["price"]


def species_catalog(cfg: dict | None = None) -> list:
    """完整鱼种表（含下架），供前端还原老鱼外观。"""
    if cfg and cfg.get("species"):
        return [dict(s) for s in cfg["species"]]
    return [SPECIES[k] for k in SPECIES_ORDER]


# ---------------------------------------------------------------- 阶段 / 产能

def stage_index(growth: float) -> int:
    idx = 0
    for i, s in enumerate(STAGES):
        if growth >= s["at"]:
            idx = i
    return idx


def stage_of(growth: float) -> dict:
    """返回当前成长阶段信息（含到下一阶段的进度）。"""
    idx = stage_index(growth)
    cur = STAGES[idx]
    nxt = STAGES[idx + 1] if idx + 1 < len(STAGES) else None
    return {
        "key": cur["key"],
        "name": cur["name"],
        "scale": cur["scale"],
        "next_at": nxt["at"] if nxt else None,
        "next_name": nxt["name"] if nxt else None,
        "progress": (
            min(1.0, (growth - cur["at"]) / (nxt["at"] - cur["at"]))
            if nxt else 1.0
        ),
    }


def efficiency(hunger: float) -> float:
    """饱食度 → 产币产能系数。"""
    if hunger <= 0:
        return 0.0
    for threshold, factor in HUNGER_TIERS:
        if hunger >= threshold:
            return factor
    return HUNGER_MIN_FACTOR


def _num(value, fallback: float) -> float:
    """把任意输入转成有限数值，非法值回落到出厂值。"""
    try:
        num = float(value)
    except (TypeError, ValueError):
        return float(fallback)
    if num != num or num in (float("inf"), float("-inf")):
        return float(fallback)
    return num


def growth_profile(cfg: dict | None = None) -> dict:
    """读取成长曲线配置：每秒基础成长 + 四档（饱食阈值, 成长系数）。

    阈值统一夹到 0~100 并按从高到低排序，避免后台把阈值填成倒序时出现空档。
    """
    p = params(cfg)
    per_sec = max(0.0, _num(p.get("growth_per_sec"), GROWTH_PER_SEC))
    tiers = []
    for key, label, tkey, fkey, tdef, fdef in GROWTH_TIERS:
        threshold = min(100.0, max(0.0, _num(p.get(tkey), tdef)))
        factor = max(0.0, _num(p.get(fkey), fdef))
        tiers.append({
            "key": key,
            "label": label,
            "threshold": threshold,
            "factor": factor,
        })
    tiers.sort(key=lambda t: t["threshold"], reverse=True)
    return {"per_sec": per_sec, "tiers": tiers}


def growth_state(hunger: float, cfg: dict | None = None,
                 profile: dict | None = None) -> dict:
    """饱食度 → 成长档位状态（供前端展示「生长加成 / 正常 / 缓慢 / 停滞」）。"""
    prof = profile or growth_profile(cfg)
    h = _num(hunger, 0.0)
    tiers = prof["tiers"]
    for i, tier in enumerate(tiers):
        if h >= tier["threshold"]:
            return {
                "key": tier["key"],
                "label": tier["label"],
                "factor": round(tier["factor"], 2),
                "threshold": tier["threshold"],
                "next_threshold": tiers[i - 1]["threshold"] if i > 0 else None,
                "per_hour": round(prof["per_sec"] * tier["factor"] * 3600, 1),
            }
    floor = tiers[-1]["threshold"] if tiers else 0.0
    return {
        "key": GROWTH_STOP_KEY,
        "label": GROWTH_STOP_LABEL,
        "factor": 0.0,
        "threshold": floor,
        "next_threshold": floor,
        "per_hour": 0.0,
    }


def growth_factor(hunger: float, cfg: dict | None = None,
                  profile: dict | None = None) -> float:
    """饱食度 → 成长倍率；低于最低档阈值返回 0（停止生长）。"""
    return growth_state(hunger, cfg, profile)["factor"]


def coin_rate(growth: float, hunger: float, species: str | None = None,
              cfg: dict | None = None) -> float:
    """该鱼当前的实际产币速度（金币/小时）。鱼种自带产币系数。"""
    base = COIN_RATES[STAGES[stage_index(growth)]["key"]]
    return base * efficiency(hunger) * float(species_meta(species, cfg)["coin"])


def is_adult(fish: dict) -> bool:
    return fish["growth"] >= STAGES[2]["at"]


def next_payout_at(now: float, cfg: dict | None = None) -> float:
    """下一个结算时间戳（按配置的结算间隔对齐）。"""
    interval = payout_interval(cfg)
    return math.ceil(now / interval) * interval


# 兼容旧名
def next_hour_boundary(now: float, interval: float | None = None) -> float:
    step = float(interval or PAYOUT_INTERVAL)
    return math.ceil(now / step) * step


# ---------------------------------------------------------------- 时间推进

def empty_summary() -> dict:
    return {
        "seconds": 0,
        "payout_count": 0,
        "payout_amount": 0.0,
        "advances": [],
        "pending": 0.0,
        "reward_total": 0.0,
    }


def tick(tank: dict, fish_list: list, now: float, cfg: dict | None = None) -> dict:
    """推进世界时间。原地修改 tank / fish_list，返回本段时间的产出摘要。

    tank 字段：coins, food, food_acc, last_tick, pending, next_payout
    fish 字段：growth, hunger, name, species
    """
    interval = payout_interval(cfg)
    regen_sec = float(param(cfg, "food_regen_sec") or 0)
    growth_cfg = growth_profile(cfg)          # 本段推进沿用的成长曲线快照

    # 兼容旧数据
    if tank.get("pending") is None:
        tank["pending"] = 0.0
    if not tank.get("next_payout"):
        tank["next_payout"] = next_hour_boundary(now, interval)
    elif tank["next_payout"] - now > interval:
        # 结算间隔被后台调小后，旧的时间点会显得太远，按新间隔重新对齐
        tank["next_payout"] = next_hour_boundary(now, interval)

    last = tank.get("last_tick") or now
    dt_total = now - last
    tank["last_tick"] = now
    if dt_total <= 0:
        summary = empty_summary()
        summary["pending"] = round(tank["pending"], 2)
        return summary

    dt_total = min(dt_total, MAX_OFFLINE)
    reward_total = 0.0
    advances = []

    elapsed = 0.0
    while elapsed < dt_total:
        d = min(SIM_STEP, dt_total - elapsed)

        # 饲料自然恢复（不设上限；间隔为 0 表示不恢复）
        if regen_sec > 0:
            tank["food_acc"] += d
            while tank["food_acc"] >= regen_sec:
                tank["food_acc"] -= regen_sec
                tank["food"] += 1
        else:
            tank["food_acc"] = 0.0

        for f in fish_list:
            before_idx = stage_index(f["growth"])

            # 成长：饱食度决定档位倍率，低于停滞阈值完全不长
            gfactor = growth_factor(f["hunger"], profile=growth_cfg)
            if gfactor > 0:
                f["growth"] += growth_cfg["per_sec"] * gfactor * d
                after_idx = stage_index(f["growth"])
                if after_idx > before_idx:
                    # 一次 tick 可能跨多级（如离线很久），每跨一级都发奖励
                    for i in range(before_idx + 1, after_idx + 1):
                        key = STAGES[i]["key"]
                        bonus = ADVANCE_REWARD.get(key, 0.0)
                        reward_total += bonus
                        advances.append({
                            "fish": f.get("name", "鱼"),
                            "stage": STAGES[i]["name"],
                            "reward": bonus,
                        })

            # 产币（按当前饱食度对应的产能，累积到待收）
            rate = coin_rate(f["growth"], f["hunger"], f.get("species"), cfg)
            tank["pending"] += rate / 3600 * d

            # 饥饿衰减
            f["hunger"] = max(0.0, f["hunger"] - HUNGER_DECAY_PER_SEC * d)

        elapsed += d

    # 结算：跨过结算点就把待收金币入账，否则继续累积
    payout_count = 0
    payout_amount = 0.0
    if now >= tank["next_payout"]:
        payout_count = int((now - tank["next_payout"]) // interval) + 1
        cap = max(1, int(math.ceil(MAX_OFFLINE / interval)) + 1)
        payout_count = min(payout_count, cap)     # 防御性上限
        tank["next_payout"] += payout_count * interval
        payout_amount = round(tank["pending"], 2)
        tank["pending"] = 0.0

    # 进阶奖励立即入账，不参与结算
    tank["coins"] += payout_amount + reward_total

    return {
        "seconds": int(dt_total),
        "payout_count": payout_count,
        "payout_amount": payout_amount,
        "advances": advances,
        "pending": round(tank["pending"], 2),
        "reward_total": round(reward_total, 2),
    }
