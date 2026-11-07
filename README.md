# Sakiyomi (サキヨミ)

**A production-planning assistant for small factories that plan in Excel. It plans what is needed this month first and tells whether the plan meets every due date, keeps stock from running out, and what this month's gross profit will be. Tell it what just happened — "the material for order 1045 is two days late" — and it shows which shipments slip and lays out ways to recover, each with its effect on profit.**

日本語版: [README.ja.md](README.ja.md)

Built during the hackathon "Built with Claude: Japan 2026" (2026-11-02 to 11-10).

## Why

In a small job shop, the plan lives in a spreadsheet and the know-how lives in one veteran's head. When material is late, an order grows, or a machine goes down, only that person can tell which shipments will slip and what to rearrange. Sakiyomi lets anyone ask, see the effect on every order, and keep a record of why a decision was made.

## What it does

The header starts with the role: **Production** (製造), **Sales** (営業) or **Head office** (本部), and only that role's screens line up as tabs. Production has This month, Progress, Shop floor, Gantt and Decision log; Sales has Deals; Head office has Distributor stock and Demand forecast, with the handover to the plan. The app remembers the last role and the screen each role had open. Ask Claude and Settings and data (the gear) stay at the top right whatever the role; on a phone, Settings and data is at the end of the menu.

- **This month** — at the top, what to act on today, worked out from the plan, each item leading to where it is dealt with: material to order before its last day, orders that miss their due date, distributors about to order, promises to customers the plan breaks and stock running out within a week. Open orders are classed from stock and monthly shipments as A (needed this month), B (next month) or C (later), and planned in that order. A timeline shows each order's bar from today to its forecast finish against its due date, with the days a part's stock runs short and when its material comes. The tab also shows this month's gross profit (revenue of what is finished this month minus the costs the plan moves: material, machine running cost and the pay for overtime and holiday work; the base pay of the regular shifts stays the same whatever the plan does and is not taken off), orders that will miss their due date, stock shortages through the end of next month, and overtime hours (pieces finished this month on shift work) and holiday hours, together with the build order, how many people of each crew are on machines each day, and the stock outlook per part. Where stock and every open order still fall short of shipments through the end of next month, the outlook shows how many to make and by when, whether material on hand can start them, when the plan would start them and the day to order their material by, given its lead time; one click adds them to the plan as an open order.
- **Progress** — at the top, where the work sits now: processes grouped by crew across, from pieces not yet released to finished lots, and down, this month's orders needed because stock runs out, those needed by their due date, next month's and later ones. Each cell shows pieces and lots, and each process shows how much of this month's work has passed it. Below, every open order, or every part number, with one chip per process step. Each chip shows how far the step is done, how many pieces and lots sit there, and a warning for lots that have not moved for days. Click a cell, a process, the overall column or any chip for the list of work-in-progress lots and when each one is planned to run next. Each order row shows the day it is needed by, marked when stock running out sets that day, and its due date opens the customer orders it fills, each promised date set against the forecast. By part number, the progress shows the stockout outlook and how far back in the route this month's shipments reach (to which step's lots, into the pieces not yet released, or how many are short, with whether material on hand covers them). Any lot opens the record of the steps it has been through. The list can be searched by order, part number or lot, can hide finished orders or show only those with lots that have stopped, and sorts by due date, forecast finish or overall progress.
- **Shop floor** — the floor now, in 3D: inside the building, material stands on the left, each crew's machines in its own area, finished goods and the door they leave by on the right, and a forklift runs along the aisle in front. Each machine has the lot it is running beside it and the lots waiting for it in front of it, one pallet a lot, colored as on the Gantt chart. The waiting lots stand the next one nearest the machine, in up to two rows of three (its card counts any more), and the more pieces a lot has, the higher its load, so how much work waits at each machine shows without choosing anything. Its state (running, setting up, free, off or stopped) shows on its signal lamp and as a dot by its name, and someone stands at each machine that is running or being set up. Stock shows as the height of each part's stack, with a red tag only on a part that has none. Choosing a machine opens a small card beside it: the lot it is running (part, pieces, step), how far the step has gone and when it ends (while the machine is off, when it starts again), and how many lots and pieces wait for it, listed in the order it takes them; on a phone the card shows under the floor. Choosing a pallet in a store shows how many pieces it holds; with the keyboard, the arrow keys choose on the floor once it has focus, and Escape closes the card. Out of working hours, the lights go out and the clock in the corner also says when the next shift starts. A machine at work moves as its kind does: a press brake's ram, a welding robot's arm, a drill's spindle; nothing moves when the system asks for less motion. A screen reader reads the same in words, from left to right. The machine models are made by a Blender script in this repository ([scripts/models/build_models.py](scripts/models/build_models.py)).
- **Gantt** — equipment × time. A deterministic scheduler places every lot and the not-yet-released quantity on the machines, with working hours (a day shift, or three shifts that run round the clock on working days), weekends, setup time from one shape to another, transfer time between steps (none when the next step stays on the same machine), material arrival dates and the people at work in each crew (one person per running machine; only those who can set a machine up do its setups). A machine can take several processes, as a multi-tasking machine does, and runs at its own speed against the route's minutes per piece. Each machine starts from the part it ran last, so its first setup is counted too. Each bar shows its lot, part, shape and pieces; the quantity not yet released runs under the Lot number it will get. Bars turn amber or red when an order is close to or past its due date. Click a machine for everything it runs in time order, with each setup from shape to shape, or click a bar for how its lot flows from step to step. A line marks the time now on the first day; hovering over a bar or moving keyboard focus to it shows its details, and a machine's list counts its setups and running hours. Steps a lot has already been through show where and when they were run, and the lot's flow links to its row in the progress tab.
- **Decision log** — adopting an option asks for an optional note on why. The change, Claude's reasoning, the trade-off and the planner's note are kept together, so the next person can see how the call was made. Any decision can be undone.
- **Deals** — salespeople enter deals and move them through their stages (inquiry, quote, prototype, informal volume order, won, lost), with a close date and the pieces a month once won. Moving the close date later counts a postponement, and every change is kept. The chance of winning is learned in the browser, with gradient-boosted trees, from the history of deals already won or lost; it is the chance the deal is won in the end, not by its close date. Pick a cut (70%, 80% or 90%) and the outlook shows, by part and by salesperson, the expected quantity (pieces a month times the chance) and the first order (three months of pieces), laid out month by month from the month after the close date. Other views list deals with missing data or a close date already past, look back at the chances of four weeks ago against how the deals went, compare this year's sales with the last, and show how well the model scored on deals it was not trained on and which features count. The stock outlook in This month shows what the deals would add a month and how much sooner stock and open orders would run out.
- **Distributor stock** — shipping to a distributor is not a sale. For each distributor and part, the head office sees its stock from its last report, less what it has sold since, what it has ordered and not received yet, how many days of its sales those last, and when it is expected to order again. Pressing a distributor about to order in today's focus on This month switches to the head office and marks its row.
- **Demand forecast** — from orders by month, forecasts the next one to six months per part and plant. It predicts the last three months both with the average of the three months before and with gradient-boosted trees trained on every part at once, and uses the one that missed less. Handing over to the plan sets the open orders, the demand from deals and the forecast side by side, part by part and month by month, in rows of their own; they are never added up. Each day's demand from deals and each forecast handed over is kept as a version to look back on.
- **Ask Claude** — describe an event in plain Japanese, or ask whether the plant could make it if a deal is won. Claude reads the plan, simulates the event, finds where the work is stuck and tries countermeasures (holiday work, expediting, help from another crew, and overtime where the plant works a day shift). It then puts two or three options on the screen. The effect shown on each card — late orders, this month's gross profit, overtime and holiday hours — is recomputed by the scheduler, not taken from Claude's text.
- **Settings and data** — a day shift with its hours or three shifts, and whether crews work the day shift or all three on days off, working days, the due-date vs setup balance, transfer time, labor rate and the overtime, holiday and night premiums, price, material cost, stock and shipments per part, the speed of each machine, shown beside it as the minutes per piece it comes to on each process (曲げ 12→10分/個), its setup time, running cost per machine hour and the part each machine ran last, stopping a machine, and each crew's people on a shift, on working days, how many of them can set a machine up, on days off and day by day. Data can be exported to and imported from an Excel workbook with fourteen sheets (parts with the material on hand and its lead time, routes, equipment, setups, crews, attendance, open orders, lots, the steps each lot has been through, the customer orders behind each open order, sold direct or to a distributor, what distributors report holding and selling, deals, the history of each deal, and orders by month); crews, attendance and the last six are optional (see [Try it with your own data](#try-it-with-your-own-data)).

## How Claude is used

The core of the app is a tool-use loop with Claude Opus 5.5 (`claude-opus-5-5`, adaptive thinking) through the Messages API:

| Tool | What it does |
| --- | --- |
| `get_situation` | Today's plan: this month's outlook with when to start what is short and order its material, parts, setup rules, crews and headcount with how many can set a machine up, equipment load, each order's class, need date and forecast finish, each distributor's stock and expected order, the open deals with their chances and the demand they add by month, and the demand forecast |
| `get_order_plan` | When and on which machine each lot of one order is planned, including work that waited for a person, in the current plan or with what-if changes applied |
| `simulate_changes` | Applies what-if changes and returns how every order's finish date and time, this month's gross profit and overtime, holiday and night hours move |
| `present_options` | Shows option cards; the reported event and the countermeasures are kept apart |

The tools run in the browser against the same scheduler that draws the screens, so the numbers Claude works from and the numbers on the option cards come from the same calculation as the screens. The Cloudflare Worker only relays: it fixes the model, system prompt, tool definitions and output length, accepts only user and assistant turns, limits requests per visitor and enables server-side refusal fallbacks. The API key never reaches the browser.

## Try it online

Open https://sakiyomi.shintaro-solopreneur.workers.dev and press "アプリを見る" (Open the app); https://sakiyomi.shintaro-solopreneur.workers.dev/app opens the app directly. The app starts with fictional sample data, and what you change is saved only in your browser. Open the "Claude に相談" (Ask Claude) panel at the top right (it is open already on a wide screen) and try the first suggested message, "注番1045の材料が2日遅れると連絡がありました" (the material for order 1045 is two days late).

## Try it locally

Requires Node.js 22 or later.

```bash
npm install
cp .dev.vars.example .dev.vars   # then put your Anthropic API key in .dev.vars
npm run dev
```

Open http://localhost:5173 and press "アプリを見る" (Open the app). Progress, Gantt, settings and Excel work without a key; only "Ask Claude" needs one. The app starts with fictional sample data. Open the "Claude に相談" (Ask Claude) panel at the top right and try the first suggested message, "注番1045の材料が2日遅れると連絡がありました" (the material for order 1045 is two days late).

Tests for the scheduler, the tools and the Excel round trip: `npm test`.

## Try it with your own data

There is no database and no sign-in. Plant data goes in and out as one Excel workbook.

1. Open Settings and data (設定とデータ) with the gear at the top right and press Excel に書き出す (export). The sample comes out as `sakiyomi-data.xlsx`; use it as the template.
2. Replace the rows from row 2 down on each sheet with your plant's values. Keep the headers in row 1 as they are.
3. Press Excel を読み込む (import). If anything is wrong, nothing is replaced and every problem is listed with its sheet and row, such as 注残の5行目：納期を日付で入れてください (open orders, row 5: enter the due date as a date).

| Sheet | Columns |
| --- | --- |
| 品目 parts | 型番 part number, 形状 shape, 売価 price, 材料費 material cost, 在庫 stock, 月間の出荷数 monthly shipments, 材料在庫 material on hand (leave empty if you do not track it), 材料の調達日数 calendar days for ordered material to arrive (may be empty) |
| 工程表 routes | 型番 part number, 順番 order, 工程名 process, 1個あたりの分 minutes per piece |
| 設備 equipment | 設備ID machine ID, 設備名 name, 担当工程 processes (a multi-tasking machine lists several, written 切削、タップ, all in one crew), 速さ speed (0.1 to 10: 1 for the route's minutes, 1.2 for 20% faster; empty is 1), 段取りの分 setup minutes, 1時間の運転費 running cost per hour, 直前の型番 part it ran last |
| 段取り setups | 工程名 process, 前の形状 from shape, 次の形状 to shape, 段取りの分 setup minutes |
| 注残 open orders | 注番 order, 型番 part number, 数量 quantity, 納期 due date, 材料入荷日 material arrival date |
| Lot lots | Lot番号 lot, 注番 order, 数量 quantity, 今の工程番号 current step number (完了 when finished), その工程に着いた日 date it reached that step |
| 班 crews | 班名 crew, 担当工程 processes (written 切断、曲げ), 人数 people on one shift, 段取りできる人数 how many of them can set a machine up on their own (empty when all can; on a day fewer come, no more than come), 休日の人数 people on one shift on a day off, who come in as holiday work (empty for none) |
| 出勤 attendance | 班名 crew, 日付 date, 人数 people on one shift that day |
| 実績 step records | Lot番号 lot, 工程番号 step number, 設備ID machine ID, 開始 start, 終了 end, 良品数 good pieces, 不良数 defects |
| 受注 customer orders | 受注番号 customer order, 注番 order, 取引先 customer, 販路 channel (直販 direct or 代理店 distributor; empty is direct), 数量 quantity, 希望納期 requested date, 回答納期 promised date |
| 販売在庫 distributor stock | 取引先 distributor, 型番 part number, 基準日 date of the report, 在庫 stock, 月間の実売 sales in a month, 注文の目安の日数 days of sales left when it orders (empty is 30) |
| 商談 deals | 商談ID deal ID, 商談名 name, 取引先 customer, 担当者 salesperson, 型番 part number, ステージ stage (引き合い inquiry, 見積 quote, 試作 prototype, 量産の内示 informal volume order, 受注 won, 失注 lost), 受注予定日 close date, 量産数量（月） pieces a month once won, 取引先の種別 existing (既存) or new (新規) customer, 引き合いの経路 how the inquiry came in, 用途 what the part is for, メモ note, 登録日 date entered, ステージを変えた日 date the stage last changed and 延期回数 times the close date was moved later (both taken from the history when empty) |
| 商談の履歴 deal history | 商談ID deal ID, 項目 field (登録 for the row that records a new deal), 変える前 before, 変えた後 after, 日時 date and time (2026-11-12 09:30) |
| 月ごとの受注 monthly orders | 年月 month (2026-11), 型番 part number, 拠点 plant (empty is the plant itself), 受注数量 pieces ordered, 出荷数量 pieces shipped |

The first six sheets are required. Without crews and attendance the plan has no limit on people; without step records, customer orders, distributor stock, deals, deal history and monthly orders the plan is the same, and only the lot history, promised dates, distributors' outlook, demand from deals and the demand forecast are missing. The chance of winning is learned from the stage history of deals already won or lost, so there is none without the deal history. Dates are written 2026-11-12 or 2026/11/12, and the start and end of a step 2026-11-12 09:30; Excel date cells work too. A CSV file can be opened in Excel and saved as .xlsx first. The shift pattern (a day shift or three shifts), working days, labor rate and the other settings are not in the workbook; set them on the same screen. Importing clears the decision log.

Where the data goes:

- The data, settings and decision log are kept only in this browser's localStorage. No server stores them.
- Only when you use Ask Claude, the conversation and the tool results Claude asks for go through the Worker to the Anthropic API. These carry the contents of the plan: orders, part numbers, quantities, due dates, lots, machines, prices and material costs, the labor rate, customer names, deals (names, salespeople, close dates, quantities and chances of winning) and orders by month. The Worker does not store them. How Anthropic handles them is set by the Anthropic API terms.

## Data

The sample data in [sample-data/sample.ts](sample-data/sample.ts) was made up for this project. Part numbers, machines and quantities do not come from any real plant, and there is no personal data. Dates are relative to the day the app is opened. The sample plant works three shifts on weekdays; at the weekend one person of each crew comes in on the day shift as holiday work. In the sheet-metal and machining crews, one person on each shift can set the machines up on their own.

The meshes in [scripts/models/generated/](scripts/models/generated/) were generated for this project on 6 November 2026 with [Tripo](https://www.tripo3d.ai/), a text-to-3D service, on a paid plan that allows commercial use, from descriptions written for this project: the welding robot's arm, the truck's cab and wheels, the forklift, the band saw, the drill press, the surface grinder and the measuring machine. `npm run models` cuts, paints and fits them in Blender. Every other model, and the rest of these, is built from code in the same script.

## Layout

```
src/engine/     scheduler, progress and what-if changes (plain TypeScript, no React)
src/assistant/  Claude tool definitions, tool runners and the conversation loop
src/ui/         screens (React)
src/data/       Excel import and export
worker/         Cloudflare Worker relaying to the Claude API
sample-data/    fictional sample data
docs/           architecture notes (Japanese)
```
