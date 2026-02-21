# Open Session

When the user says "open session", "start session", or "/open-session", perform the following steps **in order**:

---

## Step 1 — Load Context Files

Read all of the following (in parallel for speed):
1. `SESSION_LOG.md` — full file, most recent entry first
2. `PLAN.md` or `HostHampton_ClaudeCode_TODO.md` — current plan and priority order
3. `memory/MEMORY.md` — project-level memory and patterns
4. `memory/patterns.md` — technical patterns and conventions
5. `memory/schema.md` — database schema reference

---

## Step 2 — Output a Session Briefing

Print exactly this format:

---

### 🧠 Session Briefing — Host Hampton Ops

**Last Session:** Session [N] on [date]
**State:** [2-3 sentence project state from last session log]

**Known Issues / Blockers from Last Session:**
- [bullets from last Known Issues section]

**Priority TODO (in order):**
1. [top priority]
2. [second priority]
3. [third priority]

**Key Context:**
- VPS: root@5.161.88.134 — /opt/hosthampton — Docker Compose
- API: https://api.hosthampton.com
- Dashboard: https://app.hosthampton.com
- DB: Supabase (agent_tasks, content_library tables)

**Last Files Changed:**
- [list from last session log]

---

## Step 3 — Confirm Understanding

End with exactly:

> I've reviewed the session log and current plan. What would you like to work on first, or should I start on priority #1?
