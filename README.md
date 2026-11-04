# Sakiyomi (サキヨミ)

**A production-planning assistant for small factories that plan in Excel. It plans what is needed this month first and tells whether the plan meets every due date, keeps stock from running out, and what this month's gross profit will be. Tell it what just happened — "the material for order 1045 is two days late" — and it shows which shipments slip and lays out ways to recover, each with its effect on profit.**

日本語版: [README.ja.md](README.ja.md)

Built during the hackathon "Built with Claude: Japan 2026" (2026-11-02 to 11-10).

## Why

In a small job shop, the plan lives in a spreadsheet and the know-how lives in one veteran's head. When material is late, an order grows, or a machine goes down, only that person can tell which shipments will slip and what to rearrange. Sakiyomi lets anyone ask, see the effect on every order, and keep a record of why a decision was made.

## What it does

- **This month** — open orders are classed from stock and monthly shipments as A (needed this month), B (next month) or C (later), and planned in that order. The tab shows this month's gross profit (revenue of what is finished this month minus material, labor and machine running cost), orders that will miss their due date, stock shortages through the end of next month, and overtime and holiday hours, together with the build order, how many people of each crew are on machines each day, and the stock outlook per part. Where stock and every open order still fall short of shipments through the end of next month, the outlook shows how many to make and by when, and whether material on hand can start them; one click adds them to the plan as an open order.
- **Progress** — at the top, where the work sits now: processes grouped by crew across, from pieces not yet released to finished lots, and down, this month's orders needed because stock runs out, those needed by their due date, next month's and later ones. Each cell shows pieces and lots, and each process shows how much of this month's work has passed it. Below, every open order, or every part number, with one chip per process step. Each chip shows how far the step is done, how many pieces and lots sit there, and a warning for lots that have not moved for days. Click a cell, a process, the overall column or any chip for the list of work-in-progress lots and when each one is planned to run next. Each order row shows the day it is needed by, marked when stock running out sets that day, and its due date opens the customer orders it fills, each promised date set against the forecast. By part number, the progress shows the stockout outlook and how far back in the route this month's shipments reach (to which step's lots, into the pieces not yet released, or how many are short, with whether material on hand covers them). Any lot opens the record of the steps it has been through. The list can be searched by order, part number or lot, can hide finished orders or show only those with lots that have stopped, and sorts by due date, forecast finish or overall progress.
- **Gantt** — equipment × time. A deterministic scheduler places every lot and the not-yet-released quantity on the machines, with working hours, weekends, setup time from one shape to another, transfer time between steps (none when the next step stays on the same machine), material arrival dates and the people at work in each crew (one person per running machine). A machine can take several processes, as a multi-tasking machine does, and runs at its own speed against the route's minutes per piece. Each machine starts from the part it ran last, so its first setup is counted too. Each bar shows its lot, part, shape and pieces; the quantity not yet released runs under the Lot number it will get. Bars turn amber or red when an order is close to or past its due date. Click a machine for everything it runs in time order, with each setup from shape to shape, or click a bar for how its lot flows from step to step. A line marks the time now on the first day; hovering over a bar or moving keyboard focus to it shows its details, and a machine's list counts its setups and running hours. Steps a lot has already been through show where and when they were run, and the lot's flow links to its row in the progress tab.
- **Ask Claude** — describe an event in plain Japanese. Claude reads the plan, simulates the event, finds where the work is stuck and tries countermeasures (overtime, holiday work, expediting, help from another crew). It then puts two or three options on the screen. The effect shown on each card — late orders, this month's gross profit, overtime and holiday hours — is recomputed by the scheduler, not taken from Claude's text.
- **Decision log** — adopting an option asks for an optional note on why. The change, Claude's reasoning, the trade-off and the planner's note are kept together, so the next person can see how the call was made. Any decision can be undone.
- **Settings and data** — working hours and days, the due-date vs setup balance, transfer time, labor rate and overtime and holiday premiums, price, material cost, stock and shipments per part, the speed and setup time of each machine, running cost per machine hour and the part each machine ran last, stopping a machine, and the usual and daily headcount of each crew. Data can be exported to and imported from an Excel workbook with ten sheets (parts with the material on hand, routes, equipment, setups, crews, attendance, open orders, lots, the steps each lot has been through, and the customer orders behind each open order); crews, attendance and the last two are optional (see [Try it with your own data](#try-it-with-your-own-data)).

## How Claude is used

The core of the app is a tool-use loop with Claude Opus 5.5 (`claude-opus-5-5`, adaptive thinking) through the Messages API:

| Tool | What it does |
| --- | --- |
| `get_situation` | Today's plan: this month's outlook, parts, setup rules, crews and headcount, equipment load, and each order's class, need date and forecast finish |
| `get_order_plan` | When and on which machine each lot of one order is planned, including work that waited for a person, in the current plan or with what-if changes applied |
| `simulate_changes` | Applies what-if changes and returns how every order's finish date and time, this month's gross profit and overtime and holiday hours move |
| `present_options` | Shows option cards; the reported event and the countermeasures are kept apart |

The tools run in the browser against the same scheduler that draws the screens, so Claude's numbers always match what the planner sees. The Cloudflare Worker only relays: it fixes the model, system prompt, tool definitions and output length, accepts only user and assistant turns, limits requests per visitor and enables server-side refusal fallbacks. The API key never reaches the browser.

## Try it locally

Requires Node.js 22 or later.

```bash
npm install
cp .dev.vars.example .dev.vars   # then put your Anthropic API key in .dev.vars
npm run dev
```

Open http://localhost:5173. Progress, Gantt, settings and Excel work without a key; only "Ask Claude" needs one. The app starts with fictional sample data. Try the first suggested message, "注番1045の材料が2日遅れると連絡がありました" (the material for order 1045 is two days late).

Tests for the scheduler, the tools and the Excel round trip: `npm test`.

## Try it with your own data

There is no database and no sign-in. Plant data goes in and out as one Excel workbook.

1. In Settings and data (設定とデータ), press Excel に書き出す (export). The sample comes out as `sakiyomi-data.xlsx`; use it as the template.
2. Replace the rows from row 2 down on each sheet with your plant's values. Keep the headers in row 1 as they are.
3. Press Excel を読み込む (import). If anything is wrong, nothing is replaced and every problem is listed with its sheet and row, such as 注残の5行目：納期を日付で入れてください (open orders, row 5: enter the due date as a date).

| Sheet | Columns |
| --- | --- |
| 品目 parts | 型番 part number, 形状 shape, 売価 price, 材料費 material cost, 在庫 stock, 月間の出荷数 monthly shipments, 材料在庫 material on hand (leave empty if you do not track it) |
| 工程表 routes | 型番 part number, 順番 order, 工程名 process, 1個あたりの分 minutes per piece |
| 設備 equipment | 設備ID machine ID, 設備名 name, 担当工程 processes (a multi-tasking machine lists several, written 切削、タップ, all in one crew), 速さ speed (0.1 to 10: 1 for the route's minutes, 1.2 for 20% faster; empty is 1), 段取りの分 setup minutes, 1時間の運転費 running cost per hour, 直前の型番 part it ran last |
| 段取り setups | 工程名 process, 前の形状 from shape, 次の形状 to shape, 段取りの分 setup minutes |
| 注残 open orders | 注番 order, 型番 part number, 数量 quantity, 納期 due date, 材料入荷日 material arrival date |
| Lot lots | Lot番号 lot, 注番 order, 数量 quantity, 今の工程番号 current step number (完了 when finished), その工程に着いた日 date it reached that step |
| 班 crews | 班名 crew, 担当工程 processes (written 切断、曲げ), 人数 people |
| 出勤 attendance | 班名 crew, 日付 date, 人数 people |
| 実績 step records | Lot番号 lot, 工程番号 step number, 設備ID machine ID, 開始 start, 終了 end, 良品数 good pieces, 不良数 defects |
| 受注 customer orders | 受注番号 customer order, 注番 order, 取引先 customer, 数量 quantity, 希望納期 requested date, 回答納期 promised date |

The first six sheets are required. Without crews and attendance the plan has no limit on people; without step records and customer orders the plan is the same, and only the lot history and promised dates are missing. Dates are written 2026-11-12 or 2026/11/12, and the start and end of a step 2026-11-12 09:30; Excel date cells work too. A CSV file can be opened in Excel and saved as .xlsx first. Working hours, labor rate and the other settings are not in the workbook; set them on the same screen. Importing clears the decision log.

Where the data goes:

- The data, settings and decision log are kept only in this browser's localStorage. No server stores them.
- Only when you use Ask Claude, the conversation and the tool results Claude asks for go through the Worker to the Anthropic API. These carry the contents of the plan: orders, part numbers, quantities, due dates, lots, machines, prices and material costs, the labor rate and customer names. The Worker does not store them. How Anthropic handles them is set by the Anthropic API terms.

## Data

The sample data in [sample-data/sample.ts](sample-data/sample.ts) was made up for this project. Part numbers, machines and quantities do not come from any real plant, and there is no personal data. Dates are relative to the day the app is opened.

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
