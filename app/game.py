"""虚拟养鱼 - 核心规则（纯函数，无 IO，可独立测试）

金币体系：
1. 每条鱼按「阶段」有基础产币率（币/小时，100% 产能）；
2. 产出按秒累积到「待收」，每到整点结算一次并入账；
3. 饱食度决定产能系数（阶梯），饿了产量按档位衰减，饿死为 0；
4. 鱼进阶（阶段提升）时一次性发放金币奖励，立即入账；
5. 离线时间按固定步长模拟，单次最多补偿 24 小时。
"""
import math

MAX_OFFLINE = 24 * 3600          # 单次最多补偿 24 小时
SIM_STEP = 30                    # 模拟步长（秒）

# 数值设定
HUNGER_DECAY_PER_SEC = 1 / 180   # 每 3 分钟饿 1 点，满饱食可撑 5 小时
GROWTH_PER_SEC = 1 / 75          # 饱食状态下每分钟成长 0.8 点（约 48/小时）
GROWTH_HUNGER_MIN = 1            # 低于该饱食度停止成长

FOOD_REGEN_SEC = 900             # 每 15 分钟自然补充 1 份饲料
FOOD_CAP = 10                    # 饲料上限
FEED_AMOUNT = 20                 # 每次喂食恢复饱食度

TANK_CAP = 6                     # 鱼缸容量
FISH_PRICE = 20                  # 买一条鱼苗
FOOD_PACK = 5                    # 一份饲料包数量
FOOD_PACK_PRICE = 8              # 一份饲料包价格

PAYOUT_INTERVAL = 3600           # 每小时整点结算一次

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


def coin_rate(growth: float, hunger: float) -> float:
    """该鱼当前的实际产币速度（金币/小时）。"""
    base = COIN_RATES[STAGES[stage_index(growth)]["key"]]
    return base * efficiency(hunger)


def is_adult(fish: dict) -> bool:
    return fish["growth"] >= STAGES[2]["at"]


def next_hour_boundary(now: float) -> float:
    """下一个整点时间戳（UTC 整点，容器 TZ 只影响显示）。"""
    return math.ceil(now / PAYOUT_INTERVAL) * PAYOUT_INTERVAL


def empty_summary() -> dict:
    return {
        "seconds": 0,
        "payout_count": 0,
        "payout_amount": 0.0,
        "advances": [],
        "pending": 0.0,
    }


def tick(tank: dict, fish_list: list, now: float) -> dict:
    """推进世界时间。原地修改 tank / fish_list，返回本段时间的产出摘要。

    tank 字段：coins, food, food_acc, last_tick, pending, next_payout
    fish 字段：growth, hunger, name
    """
    # 兼容旧数据
    if tank.get("pending") is None:
        tank["pending"] = 0.0
    if not tank.get("next_payout"):
        tank["next_payout"] = next_hour_boundary(now)

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

        # 饲料自然恢复
        tank["food_acc"] += d
        while tank["food_acc"] >= FOOD_REGEN_SEC and tank["food"] < FOOD_CAP:
            tank["food_acc"] -= FOOD_REGEN_SEC
            tank["food"] += 1
        if tank["food"] >= FOOD_CAP:
            tank["food_acc"] = 0.0

        for f in fish_list:
            before_idx = stage_index(f["growth"])

            # 成长（只在有饱食度时）
            if f["hunger"] > GROWTH_HUNGER_MIN:
                f["growth"] += GROWTH_PER_SEC * d
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
            tank["pending"] += coin_rate(f["growth"], f["hunger"]) / 3600 * d

            # 饥饿衰减
            f["hunger"] = max(0.0, f["hunger"] - HUNGER_DECAY_PER_SEC * d)

        elapsed += d

    # 整点结算：只有跨过整点才把待收金币入账，否则继续累积
    payout_count = 0
    payout_amount = 0.0
    if now >= tank["next_payout"]:
        payout_count = int((now - tank["next_payout"]) // PAYOUT_INTERVAL) + 1
        payout_count = min(payout_count, 240)  # 防御性上限
        tank["next_payout"] += payout_count * PAYOUT_INTERVAL
        payout_amount = round(tank["pending"], 2)
        tank["pending"] = 0.0

    # 进阶奖励立即入账，不参与整点结算
    tank["coins"] += payout_amount + reward_total

    return {
        "seconds": int(dt_total),
        "payout_count": payout_count,
        "payout_amount": payout_amount,
        "advances": advances,
        "pending": round(tank["pending"], 2),
        "reward_total": round(reward_total, 2),
    }
