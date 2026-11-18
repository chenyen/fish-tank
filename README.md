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

## 中后台管理（/admin）

所有鱼缸运行参数不再写死在代码里，统一由后台配置并持久化到 SQLite，**保存后无需重启服务即生效**。

- 入口：<http://localhost:8848/admin>（登录页也有「中后台管理」链接）
- 初始账号：`admin`
- 初始密码：`fishtank-admin`（常量定义在 `app/config.py` 的 `ADMIN_INITIAL_PASSWORD`，首次建库时写入 `admins` 表）
- 登录后可自助修改密码（原密码 + 新密码），改完下次登录用新密码；未登录访问任何后台接口返回 401

可配置项：

| 分组 | 字段 | 说明 |
|---|---|---|
| 全局 | `payout_interval` | 产币结算间隔（秒），默认 3600 |
| 全局 | `initial_coins` | 新玩家初始金币 |
| 全局 | `food_pack_size` / `food_pack_price` | 每包饲料份数 / 每包价格 |
| 全局 | `feed_amount` | 每次投喂恢复的饱食点 |
| 全局 | `food_regen_sec` | 饲料自然恢复间隔（秒），0 = 不恢复 |
| 全局 | `initial_food` | 新玩家初始饲料份数 |
| 全局 | `tank_capacity` | 鱼缸容量上限，**0 = 不限**（默认 0） |
| 鱼种 | 名称 / 价格 / 体型系数 / 产币系数 / 描述 / 上架 | 五个内置鱼种可改，也可新增、删除 |

鱼种增删规则：

- 标识 `key` 为小写字母开头、2-24 位的字母数字下划线，被现有鱼使用的鱼种标识锁定不可改；
- 删除仍有鱼在使用的鱼种 → 自动改为「下架」（不再出现在购买列表，已有鱼照常成长产出）；
- 新增的鱼种若没有对应的绘制分支，前台按鲤鱼外观兜底绘制，不会报错。

## 玩法与数值

> 下表为**出厂默认值**，实际运行值以后台 `/admin` 配置为准。

| 项目 | 设定 |
|---|---|
| 初始资源 | 30 金币、5 份饲料、1 条鱼苗 |
| 饥饿衰减 | 每 3 分钟 -1 点，满饱食可撑 5 小时 |
| 每份饲料 | +20 点饱食（约 1 小时） |
| 成长速度 | 基础 48 点/小时，按饱食度分四档倍率（见下节）；后台可调 |
| 阶段门槛 | 鱼苗 0 → 幼鱼 150 → 成鱼 500 → 锦鲤 1200 |
| 产币率 | 鱼苗 2 ／幼鱼 5 ／成鱼 10 ／锦鲤 20 币每小时（100% 产能时，再乘鱼种产币系数） |
| 结算节奏 | 产出按秒累积成「待收」，按后台配置的间隔结算入账（默认每小时一次） |
| 饱食度产能 | ≥80 → 100%，50-79 → 80%，20-49 → 50%，1-19 → 25%，0 → 停产 |
| 进阶奖励 | 幼鱼 +15 ／成鱼 +40 ／锦鲤 +120 金币（立即到账，不参与结算） |
| 饲料自然恢复 | 每 15 分钟 +1 份 |
| 商店 | 鱼苗按鱼种价格售卖（默认 12-60 币）／饲料包 5 份 8 币；**缸内养鱼数量不设上限** |
| 离线补偿 | 单次最多 24 小时，跨过的结算点合并结算一次 |
| 死亡机制 | 无。饿了只会暂停成长与产币 |

### 成长速度与饱食度

鱼的成长速度由饱食度分档决定，四条阈值 + 四个系数 + 每秒基础成长值都在后台
`/admin` 的「成长（饱食度）」分组里可改，保存即生效（无需重启）。

| 档位 | 饱食度 | 倍率 | 实际速度（按默认基础 48 点/小时） |
|---|---|---|---|
| 饱满（生长加成） | ≥ 80 | ×1.2 | 约 57.5 点/小时 |
| 正常 | ≥ 60 | ×1.0 | 约 47.9 点/小时 |
| 偏低（缓慢） | ≥ 30 | ×0.6 | 约 28.7 点/小时 |
| 停滞 | ≥ 10 | ×0.25 | 约 12.0 点/小时 |
| 停止 | < 10 | ×0 | 不成长，喂食后即恢复 |

前端「我的鱼」列表里每条鱼右上角会显示当前档位标签（生长加成／正常／缓慢／停滞／停止），
成长进度条按档位着色，停滞与停止分别为冷蓝与警示红；悬停标签可看到原因与提速提示。
离线补偿同样按该曲线逐段模拟，不会按满速补齐。

### 金币是怎么来的

1. **鱼产金币**：每条鱼按当前阶段的基础产币率持续产出，产出速度 × 饱食度产能系数 × 鱼种产币系数。
   6 条成鱼满饱食 = 60 币/小时；一条鱼苗满饱食 = 2 币/小时。
2. **定期结算**：界面上金币旁显示 `+x.x` 的待收金额，实时增长；每到结算点自动入账并提示。
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
│   ├── main.py            # 路由、认证、会话、后台接口
│   ├── config.py          # 参数中心：建表 / 默认值 / 读写 / 管理员鉴权
│   ├── db.py              # SQLite 建表 / 连接（启动时播种参数与管理员）
│   ├── game.py            # 游戏规则（纯函数，参数由配置快照驱动）
│   └── static/            # index.html / app.js / style.css
│       └── admin.html / admin.js / admin.css   # 中后台管理页
└── data/tank.db           # 运行时生成，挂载到宿主机
```

关键设计：`game.py` 里 `tick(tank, fish_list, now, cfg)` 是纯函数，不依赖定时器，
所有状态推进都由它按时间差计算，因此「在线」和「离线」走同一套逻辑；
`cfg` 是每次请求从 `config.load(conn)` 读出的参数快照（含全局参数与鱼种表），
所以后台一保存，下一次请求就按新参数运行，不需要重启。

## 接口

玩家接口：

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/register` | 注册，自动创建鱼缸和一条初始鱼 |
| POST | `/api/login` | 登录，下发 HttpOnly 签名 Cookie |
| POST | `/api/logout` | 退出 |
| GET | `/api/me` | 当前登录状态 |
| GET | `/api/state` | 结算时间差 + 返回鱼缸快照（`capacity` 为 `null` 表示不限） |
| POST | `/api/fish` | 买一条鱼（无容量限制） |
| POST | `/api/feed` | 喂食 `{fish_id}` |
| POST | `/api/food` | 换购饲料 |
| GET | `/api/leaderboard` | 成长排行榜 |

中后台接口（除登录外均需管理员 Cookie，未登录返回 401）：

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/admin` | 后台管理页面 |
| POST | `/api/admin/login` | 管理员登录 `{username, password}` |
| GET | `/api/admin/me` | 当前管理员会话状态 |
| POST | `/api/admin/logout` | 退出后台 |
| GET | `/api/admin/config` | 读取字段定义 + 当前参数 + 鱼种表 + 出厂默认值 |
| POST | `/api/admin/config` | 保存参数 `{params, species}`，即时生效，返回最新配置与提示 |
| POST | `/api/admin/password` | 修改密码 `{old, new}` |

## 生产自动更新（GHCR + 1Panel 轮询）

代码和前端都打在镜像里，所以**改了代码的发版必须更新镜像 + 重启容器**才能生效
（只在后台改参数不用，保存即生效）。数据在 `./data` 卷里，重建不会丢。

发版链路：`git push` → GitHub Actions 自动构建镜像并推送到 GHCR → NAS 定时拉取，
有新镜像才重建容器。NAS 上**不需要放源码**，只要 `docker-compose.yml`、`deploy/auto-update.sh` 和 `./data`。
日志写在 `logs/auto-update.log`。

### 首次准备（只需一次）

1. **让 Actions 能推镜像**：GitHub 仓库 → Settings → Actions → General → Workflow permissions，
   选「Read and write permissions」并保存（工作流已声明 `packages: write`）。
2. **把 GHCR 包设为公开**（否则 NAS 拉取要登录）：推一次镜像后，
   打开 <https://github.com/orgs/chenyen/packages> → 找到 `fish-tank` → Package settings →
   Change visibility → Public。想保持私有也可以，见下方「私有镜像」。
3. 在 NAS 上准备一个目录，放入两样东西：`docker-compose.yml`、`deploy/auto-update.sh`
   （`./data` 留空即可，首次启动会自动建库）。
4. 给脚本执行权限：在 1Panel 终端里执行 `chmod +x deploy/auto-update.sh`。
5. 首次部署：`docker compose up -d`，确认 `http://NAS_IP:8848` 能打开。

> 之后每次 `git push`，最多等一个轮询周期就自动更新，NAS 上无需任何手动操作。
> 前端资源带 mtime 版本号，更新后浏览器会自动拉新，不用手动清缓存。

### 在 1Panel 里配置计划任务（图形界面）

1. 打开 1Panel → 左侧「计划任务」→「创建任务」。
2. 任务类型选 **Shell 脚本**。
3. 任务名称随意，如 `鱼缸自动更新`。
4. 执行周期按需要选，例如「每 10 分钟」或「每小时」。
5. 脚本内容填下面这一行（路径换成你 NAS 上项目的实际路径）：

   ```bash
   bash /你的路径/fish-tank/deploy/auto-update.sh
   ```

6. 保存后，可在任务列表点「执行」手动测一次，再去 `logs/auto-update.log` 看结果。

### 手动触发 / 立刻生效

- 在 1Panel 计划任务里手动「执行」一次，或在终端运行 `bash deploy/auto-update.sh`。
- 想完全不自动：不创建计划任务即可。
- 想本地调试构建：把 compose 里的 `image:` 换回 `build: .` 再 `docker compose up -d --build`。

### 私有镜像（可选）

若 GHCR 包保持私有，NAS 需先登录一次（token 在 GitHub → Settings → Developer settings →
Personal access tokens，勾选 `read:packages`）：

```bash
echo "<你的token>" | docker login ghcr.io -u chenyen --password-stdin
```

登录信息会持久保存，之后脚本可正常拉取。

### 回滚到旧版本

镜像同时打了 commit sha 标签。在 GHCR 的包页面复制某个旧 sha 标签，改 compose 的
`image:` 为 `ghcr.io/chenyen/fish-tank:sha-xxxxxxx`，再 `docker compose up -d --force-recreate`；
或直接 `docker compose pull` 让脚本重建。

### 国内拉取慢 / 拉不动

ghcr.io 在国内偶尔不稳定。若 NAS 拉取频繁失败，可改用阿里云容器镜像服务（ACR）做加速：
把 Actions 的推送目标换成阿里云仓库，compose 的 `image:` 同步改成阿里云地址即可，
更新脚本无需改动（它只认 compose 里的镜像）。

### 注意事项

- 更新失败（网络 / 拉取 / 重建 / 健康检查）都会写进 `logs/auto-update.log`，先查这里。
- 健康检查访问 `127.0.0.1:8848`，若你改过端口，同步改脚本末尾的地址。
- 脚本会清理悬空旧镜像（`docker image prune -f`），避免长期占满磁盘。

## 数据与安全

- 数据落在 `./data/tank.db`（SQLite，WAL 模式），删除该目录即重置全部玩家数据。
- 密码使用 PBKDF2-HMAC-SHA256（12 万轮 + 随机盐）存储。
- 会话为 HMAC-SHA256 签名的 Cookie（30 天有效，HttpOnly + SameSite=Lax）。
- **上线前请修改** `docker-compose.yml` 里的 `FT_SECRET`，它决定会话签名密钥。
- 单 worker 运行 + 全局写锁，适合小规模自用；要高并发可换 PostgreSQL + 多 worker。

## 调数值

全部参数都在**中后台** <http://localhost:8848/admin> 里改，保存即写入 `data/tank.db`，
下一次请求生效，无需重启、无需重新构建镜像。

- 唯一需要改代码的只有管理员初始账号密码：`app/config.py` 的 `ADMIN_USERNAME` / `ADMIN_INITIAL_PASSWORD`。
  它们只在**首次建库**时写入数据库；库已存在时想重置管理员，可执行：
  ```sql
  DELETE FROM admins;   -- 重启服务后会按代码里的常量重新播种
  ```
  或者直接登录后台用「修改密码」改。
- 数据库新增三张表：`settings`（全局参数键值对）、`species`（鱼种表）、`admins`（管理员）。
  老库升级不需要手工迁移，服务启动时 `config.ensure_seed()` 会自动建表并补默认值。
*（内容由AI生成，仅供参考）*
