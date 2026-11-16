---
AIGC:
    Label: "1"
    ContentProducer: 001191440300708461136T1XGW3
    ProduceID: b6ce3e92598344fe613f641b4ebb82df_f89a85cde18711f189bc525400248c00
    ReservedCode1: w3pmD84+yd4hiN+Eu3FfOZ+Z1Bpsuf8ooiFhJ2pYCt4awyTlVxlhUzgRolVu6NjHlrPAceZ9YsWNDdzoMFWDmlMgRUGckuZ7d1LJV6SquViXOrdz1g0H7qWRpBJtkV1KjZVuWjqbWHWfhrcITD5FRJtf8JLmI8cON6IEI55e9mdHsA81NWjNxvv9y+w=
    ContentPropagator: 001191440300708461136T1XGW3
    PropagateID: b6ce3e92598344fe613f641b4ebb82df_f89a85cde18711f189bc525400248c00
    ReservedCode2: w3pmD84+yd4hiN+Eu3FfOZ+Z1Bpsuf8ooiFhJ2pYCt4awyTlVxlhUzgRolVu6NjHlrPAceZ9YsWNDdzoMFWDmlMgRUGckuZ7d1LJV6SquViXOrdz1g0H7qWRpBJtkV1KjZVuWjqbWHWfhrcITD5FRJtf8JLmI8cON6IEI55e9mdHsA81NWjNxvv9y+w=
---

# 虚拟养鱼（Fish Tank）

一个跑在 Docker 里的多用户放置类养鱼小游戏。零素材依赖（鱼由 Canvas 手绘），
离线期间鱼也在成长，重新进来自动补偿。

## 快速开始

```bash
cd fish-tank
docker compose up -d --build
```

打开 <http://localhost:8848>，注册账号就能开始。

### 本地开发（不用 Docker，热重载）

```powershell
.\start-dev.ps1          # 首次会自动创建 .venv 并装依赖
```

或手动：

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
$env:DB_PATH="D:\dockers\fish-tank\data\tank.db"; $env:FT_SECRET="fish-tank-dev-secret"
cd app; ..\.venv\Scripts\python.exe -m uvicorn main:app --host 127.0.0.1 --port 8848 --reload
```

本地库落在 `./data/tank.db`（与容器内 `/data/tank.db` 同一份结构），改完代码保存即生效。

停止 / 卸载：

```bash
docker compose down            # 停止并移除容器（数据保留）
docker compose down && rm -rf data   # 连数据一起清空
```

## 玩法与数值

| 项目 | 设定 |
|---|---|
| 初始资源 | 30 金币、5 份饲料、1 条鱼苗 |
| 饥饿衰减 | 每 3 分钟 -1 点，满饱食可撑 5 小时 |
| 每份饲料 | +20 点饱食（约 1 小时） |
| 成长速度 | 饱食状态下约 48 点/小时 |
| 阶段门槛 | 鱼苗 0 → 幼鱼 150 → 成鱼 500 → 锦鲤 1200 |
| 产币率 | 鱼苗 2 ／幼鱼 5 ／成鱼 10 ／锦鲤 20 币每小时（100% 产能时） |
| 结算节奏 | 产出按秒累积成「待收」，**每小时整点结算一次**入账 |
| 饱食度产能 | ≥80 → 100%，50-79 → 80%，20-49 → 50%，1-19 → 25%，0 → 停产 |
| 进阶奖励 | 幼鱼 +15 ／成鱼 +40 ／锦鲤 +120 金币（立即到账，不参与整点结算） |
| 饲料自然恢复 | 每 15 分钟 +1 份，上限 10 份 |
| 商店 | 买鱼苗 20 币（上限 6 条）／饲料包 5 份 8 币 |
| 离线补偿 | 单次最多 24 小时，跨过的整点合并结算一次 |
| 死亡机制 | 无。饿了只会暂停成长与产币 |

### 金币是怎么来的

1. **鱼产金币**：每条鱼按当前阶段的基础产币率持续产出，产出速度 × 饱食度产能系数。
   满缸 6 条成鱼满饱食 = 60 币/小时；一条鱼苗满饱食 = 2 币/小时。
2. **整点结算**：界面上金币旁显示 `+x.x` 的待收金额，实时增长；每到整点自动入账并提示。
   离线多时，回来一次补齐（最多 24 小时）。
3. **进阶奖励**：鱼每升一个阶段，立刻发放一次性金币，是前期主要启动资金。
4. **饱食度惩罚**：饿到 80 以下产能就下降，饿死（0）不产出，所以「喂食 = 投资」。
   维持一条成鱼满饱食，每小时约耗 1 份饲料（1.6 币），产出 10 币，净赚约 8.4 币。

理论满饱食节奏：3 小时鱼苗 → 幼鱼（+15） → 10 小时成鱼（+40） → 25 小时锦鲤（+120），
实际因喂养间隔约需 2-3 天。

## 架构

```
fish-tank/
├── docker-compose.yml     # web 服务 + ./data 数据卷
├── Dockerfile             # python:3.12-slim
├── requirements.txt       # fastapi / uvicorn / pydantic
├── app/
│   ├── main.py            # 路由、认证、会话
│   ├── db.py              # SQLite 建表 / 连接
│   ├── game.py            # 游戏规则（纯函数，可独立单测）
│   └── static/            # index.html / app.js / style.css
└── data/tank.db           # 运行时生成，挂载到宿主机
```

关键设计：`game.py` 里 `tick(tank, fish_list, now)` 是纯函数，不依赖定时器，
所有状态推进都由它按时间差计算，因此「在线」和「离线」走同一套逻辑。

## 接口

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/register` | 注册，自动创建鱼缸和一条初始鱼 |
| POST | `/api/login` | 登录，下发 HttpOnly 签名 Cookie |
| POST | `/api/logout` | 退出 |
| GET | `/api/me` | 当前登录状态 |
| GET | `/api/state` | 结算时间差 + 返回鱼缸快照 |
| POST | `/api/fish` | 买一条鱼 |
| POST | `/api/feed` | 喂食 `{fish_id}` |
| POST | `/api/food` | 换购饲料 |
| GET | `/api/leaderboard` | 成长排行榜 |

## 数据与安全

- 数据落在 `./data/tank.db`（SQLite，WAL 模式），删除该目录即重置全部玩家数据。
- 密码使用 PBKDF2-HMAC-SHA256（12 万轮 + 随机盐）存储。
- 会话为 HMAC-SHA256 签名的 Cookie（30 天有效，HttpOnly + SameSite=Lax）。
- **上线前请修改** `docker-compose.yml` 里的 `FT_SECRET`，它决定会话签名密钥。
- 单 worker 运行 + 全局写锁，适合小规模自用；要高并发可换 PostgreSQL + 多 worker。

## 调数值

所有可调参数集中在 `app/game.py` 顶部常量区，改完 `docker compose up -d --build` 生效。
*（内容由AI生成，仅供参考）*
