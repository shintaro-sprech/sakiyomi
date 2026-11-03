# Sakiyomi (サキヨミ)

**A production-planning assistant for small factories that plan in Excel. Tell it what just happened — "the material for order 1045 is two days late" — and it shows which shipments slip and lays out ways to recover.**

日本語版: [README.ja.md](README.ja.md)

Built during the hackathon "Built with Claude: Japan 2026" (2026-11-02 to 11-10).

## Why

In a small job shop, the plan lives in a spreadsheet and the know-how lives in one veteran's head. When material is late, an order grows, or a machine goes down, only that person can tell which shipments will slip and what to rearrange. Sakiyomi lets anyone ask, see the effect on every order, and keep a record of why a decision was made.

## What it does

- **Progress** — every open order, or every part number, with one chip per process step. Each chip shows how far the step is done, how many pieces and lots sit there, and a warning for lots that have not moved for days. Click the overall column or any chip for the list of work-in-progress lots and when each one is planned to run next.
- **Gantt** — equipment × time. A deterministic scheduler places every lot and the not-yet-released quantity on the machines, with working hours, weekends, setup time when the part number changes, transfer time between steps and material arrival dates. Bars turn amber or red when an order is close to or past its due date.
- **Ask Claude** — describe an event in plain Japanese. Claude reads the plan, simulates the event, finds where the work is stuck and tries countermeasures (overtime, holiday work, expediting). It then puts two or three options on the screen. The effect shown on each card is recomputed by the scheduler, not taken from Claude's text.
- **Decision log** — adopting an option asks for an optional note on why. The change, Claude's reasoning, the trade-off and the planner's note are kept together, so the next person can see how the call was made. Any decision can be undone.
- **Settings and data** — working hours and days, the due-date vs setup balance, transfer time, setup time per machine, stopping a machine. Data can be exported to and imported from an Excel workbook with four sheets (routes, equipment, open orders, lots).

## How Claude is used

The core of the app is a tool-use loop with Claude Opus 5.5 (`claude-opus-5-5`, adaptive thinking) through the Messages API:

| Tool | What it does |
| --- | --- |
| `get_situation` | Today's plan: orders, progress, forecast finish dates, equipment load |
| `get_order_plan` | When and on which machine each lot of one order is planned |
| `simulate_changes` | Applies what-if changes and returns how every order's finish date moves |
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

## Data

The sample data in [sample-data/sample.ts](sample-data/sample.ts) was made up for this project. Part numbers, machines and quantities do not come from any real plant, and there is no personal data. Dates are relative to the day the app is opened. Data you load stays in your browser.

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
