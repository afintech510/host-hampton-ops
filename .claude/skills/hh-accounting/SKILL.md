---
name: hh-accounting
description: Host Hampton bookkeeping - P&Ls, expense ledgers, check registers, Venmo/bank/card rulings, 1099 worksheets, sales tax, and the accountant packet/email. Use whenever the user mentions the books, financials, the accountant, P&L, net income/profit, expenses, revenue by channel, checks or a check register, Venmo payments out, card charges, 1099s, class/event margins, or drops a new bank/Venmo/HoneyBook/GoDaddy/Stripe/Squarespace/supplier export into revenue/ or expenses/.
---

# Host Hampton accounting

The books live in `expenses/` and `revenue/`. Both are **local-only git repos with no
remote**, ignored by this (public) repository, because they hold customer and contractor
names and money. This skill is the process; the specifics live in the books:

| Read first | What it is |
|---|---|
| `expenses/OPEN_ITEMS.md` | what is unfinished — start every session here |
| `expenses/README.md` | file map, every script, where each kind of ruling goes, accountant contact |
| `expenses/BOOKS_LOG.md` | every change, with P&L before/after |
| `expenses/categories.md` | chart of accounts → Schedule C lines, ledger rules |

## Hard rules

1. **Never copy books data into the main repo** — not into code, docs, tests, this skill,
   memory files that get committed, or a commit message. Never add a git remote to
   `expenses/` or `revenue/`. `books.py` refuses to commit to a repo that has one.
2. **Everything goes through `python expenses/books.py`** — it logs and commits. Don't run
   pipeline scripts one by one except to debug.
3. **A ruling is code or data, never a hand edit to a generated file.** The 2026 ledger is
   regenerated every run; README.md "Where a ruling goes" says where each ruling lives.
4. **Match on two keys** (check number AND amount; Venmo date+payee+amount or id). Rulings
   that fail to match must stop the build.
5. **Re-classifying must not move net income.** If it does, stop and explain why.
6. **Never infer silently.** Label inferred bookings INFERRED in the row's note and list
   them in OPEN_ITEMS.md until the owner confirms.
7. **Nothing reaches the accountant without the owner.** Draft the email; never send it.
8. **Dry-run before writing**: `books.py revenue` (no flag) runs the revenue chain on a copy.

## Commands

```
cd expenses
python books.py status                  # start here: unruled rows, pending lists, stale exports
python books.py rebuild 2025|2026|all   # pipeline → P&L; logs before/after; commits
python books.py revenue [--apply]       # revenue chain on a copy; --apply writes + logs
python books.py packet to_christine_<YYYY-MM-DD>
python books.py log "Owner ruled …; received …; emailed …"
```

## Workflows

**New export lands** (bank, Venmo statement, HoneyBook, GoDaddy, Stripe, supplier):
put it in `revenue/` (or `expenses/` for supplier orders) → `books.py revenue` (dry run) →
read the adds/removes, look for overlap with an existing export → `--apply` →
`books.py rebuild all` → update OPEN_ITEMS.md.

**Unidentified checks**: the bank export has check numbers, not payees. Ask the owner for
the check register / check images; transcribe to `CHECK_REGISTER_<year>.csv`
(`check_no, posted, payee, memo, amount, category, role`); payees already identified in
an earlier year keep their role. Ask only about new names, in one structured prompt with
your best guesses pre-filled (match Squarespace event sale dates to payment dates).

**Business Venmo payments out**: `python venmo_out.py <year>` writes a list with the
ruling column first, pre-filled from last year. The owner marks business/personal.
Read the whole file back — rulings have landed in an unexpected column before.

**Card charges**: list them with bank description, date, amount; ask in one prompt;
book in the year's ruling location.

**Accountant packet**: `books.py rebuild all` → `books.py packet …` → give the owner the
folder path, a one-line quoted file list for the attach dialog, and the email body in
separate copy blocks (To / Subject / Body). Figures in the email come from `PNL_*.md`.

**Analysis requests** (margins, "what if we removed a channel", contractor breakdowns):
read-only. Compute from the ledgers and `revenue/square-space_orders.csv`; show the
arithmetic; change nothing unless asked.

## Asking the owner

Use one `PromptForUserInput` with an `editText` field pre-filled with
`item = my best guess` lines, so the owner edits in place. State what each answer changes.
When the owner leaves a line blank, it stays open — don't guess it in.

## Before you finish

- `python books.py status` and update `expenses/OPEN_ITEMS.md`.
- Log anything that wasn't a `books.py` command (`books.py log "…"`).
- Report net income before → after, and what's still open.
