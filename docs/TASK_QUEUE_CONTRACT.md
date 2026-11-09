# Task queue + auto-assignment + People page — shared contract

Rules as in docs/PHASE2_CONTRACT.md (own your files, re-read before editing shared files, no git/build/servers;
verify with tsc/eslint/pytest).

## Product
- **People** becomes its own page `/people` (nav item). **Team** keeps: Task queue (default tab) · Workflow · Spending (owner).
  Nav: Dashboard · War Room (owner) · Team · People · Discover · Profile.
- When the owner creates a task, the router's pick is the **assignee immediately** (context substitution: if the
  context owner is Off, the hands-on person is the best available colleague). The task shows in the queue right away
  as "Assigned to Luis · Planning".
- Task lifecycle (stage): `planning` (agents running) → `needs_ok` (waiting for owner approval) → `in_progress`
  (approved; assigned steps being done) → `done` (all assigned steps checked off) | `rejected`.
- Progress = assigned dashboard steps done / total for that task.
- Employees see the queue too: default filter "Mine" (tasks where they are assignee or have a step), toggle "All".
  They can check off their own steps; they can't approve/reject.
- Each task has its own page `/team/tasks/[id]` with the full animated mesh + workflow + drafts + steps checklist,
  replayable for finished tasks (never blank).

## API (backend)
- `coworker_tasks` gains `assignee_employee_id` (set when routing finishes; for replays from the recording's route),
  plus derived `stage` and `progress`.
- `GET /coworker-tasks?scope=mine|all` →
  `QueueTask[]` = `{id, text, created_at, mode, status, stage: "planning"|"needs_ok"|"in_progress"|"done"|"rejected",
  assignee: {id, name, initials, role} | null, covering_for: {id, name} | null, progress: {done, total},
  steps: [{task_id, text, done, assignee: {id, name, initials} | null}]}` (newest first; employees default mine).
- `GET /coworker-tasks/{id}` additionally returns the same queue fields AND guarantees `events` is non-empty for
  finished tasks: if stored events are missing (e.g. seeded history), synthesize them deterministically from
  `result` (task.read → route.chosen → route.substituted? → mesh.message* → workflow.ready → gap.found* →
  drafts.ready → approval.waiting → task.approved → task.complete).
- `PATCH /plan-tasks/{id} {done}`: employees may toggle steps assigned to them (owner any); when all steps of a
  coworker task are done, its stage becomes `done`.
- Seeded sample history: one task `in_progress` (some steps done), one `done`; plus assigned steps exist so progress shows.
