"use client";
import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { api, cn } from "@/lib/api";
import type { Tool } from "@/lib/types";
import { HelpTip, Spinner } from "@/components/ui";
import { Drawer } from "./Drawer";
import type { Employee } from "./types";

const SKILL_IDEAS = ["Scheduling", "Customer calls", "Quotes", "Invoices & payments", "Repairs", "Installs", "Social media", "Reviews", "Ordering supplies", "Hiring & shifts"];

type Member = { user_id: string; name: string; email: string; role: string };

/** Add or edit an employee. Their AI coworker is built from these answers. */
export function EmployeeDrawer({
  open, onClose, onSaved, editing, catalog, adoptedIds,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: (e: Employee) => void;
  editing: Employee | null;
  catalog: Record<string, Tool>;
  adoptedIds: string[];
}) {
  const [name, setName] = useState("");
  const [role, setRole] = useState("");
  const [skills, setSkills] = useState<string[]>([]);
  const [skillText, setSkillText] = useState("");
  const [resp, setResp] = useState("");
  const [tools, setTools] = useState<string[]>([]);
  const [toolText, setToolText] = useState("");
  const [userId, setUserId] = useState<string>("");
  const [members, setMembers] = useState<Member[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setName(editing?.name || "");
    setRole(editing?.role || "");
    setSkills(editing?.skills || []);
    setResp(editing?.responsibilities || "");
    setTools(editing?.tools || []);
    setUserId(editing?.user_id || "");
    setSkillText("");
    setToolText("");
    setErr(null);
    api<{ members?: Member[] }>("/team").then((t) => setMembers(t.members || [])).catch(() => setMembers([]));
  }, [open, editing]);

  const addSkill = (s: string) => {
    const v = s.trim();
    if (v && !skills.some((x) => x.toLowerCase() === v.toLowerCase()) && skills.length < 10) setSkills([...skills, v]);
    setSkillText("");
  };
  const toggleTool = (t: string) => setTools(tools.includes(t) ? tools.filter((x) => x !== t) : [...tools, t]);
  const addToolText = () => {
    const v = toolText.trim();
    if (v && !tools.includes(v)) setTools([...tools, v]);
    setToolText("");
  };

  const save = async (ev: React.FormEvent) => {
    ev.preventDefault();
    if (!name.trim() || !role.trim()) return setErr("Add a name and a role.");
    if (!skills.length && !resp.trim()) return setErr("Add at least one skill or what they're responsible for, so their coworker knows when to step in.");
    setBusy(true);
    setErr(null);
    const body = { name: name.trim(), role: role.trim(), skills, responsibilities: resp.trim(), tools, user_id: userId || null };
    try {
      const saved = editing
        ? await api<Employee>(`/employees/${editing.id}`, { method: "PATCH", json: body })
        : await api<Employee>("/employees", { method: "POST", json: body });
      onSaved(saved);
    } catch (e) {
      setErr((e as Error).message);
    }
    setBusy(false);
  };

  const toolChoices = Array.from(new Set([...adoptedIds, ...tools.filter((t) => catalog[t])]));

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={editing ? `Edit ${editing.name}` : "Add an employee"}
      footer={
        <button form="employee-form" className="btn-primary w-full py-3" disabled={busy}>
          {busy ? <Spinner /> : editing ? "Save changes" : "Add employee"}
        </button>
      }
    >
      <form id="employee-form" onSubmit={save} className="space-y-4">
        <p className="flex items-center gap-1 text-sm text-stone-600">
          Their AI coworker learns from this.
          <HelpTip>When a task comes in, StackSmith picks the coworker whose skills and responsibilities fit best. If that person is off, their coworker still shares what they know and a colleague does the hands-on part.</HelpTip>
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="emp-name">Name</label>
            <input id="emp-name" className="input" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
          </div>
          <div>
            <label className="label" htmlFor="emp-role">Role</label>
            <input id="emp-role" className="input" placeholder="Lead technician" value={role} maxLength={80} onChange={(e) => setRole(e.target.value)} />
          </div>
        </div>

        <div>
          <label className="label" htmlFor="emp-skill">Skills</label>
          <div className="flex flex-wrap gap-1.5">
            {skills.map((s) => (
              <span key={s} className="chip border-emerald-200 bg-emerald-50 text-emerald-900">
                {s}
                <button type="button" onClick={() => setSkills(skills.filter((x) => x !== s))} aria-label={`Remove ${s}`}>
                  <X size={12} />
                </button>
              </span>
            ))}
          </div>
          <input
            id="emp-skill"
            className="input mt-2"
            placeholder="Type a skill and press Enter"
            value={skillText}
            maxLength={40}
            onChange={(e) => setSkillText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === ",") {
                e.preventDefault();
                addSkill(skillText);
              }
            }}
          />
          <div className="mt-2 flex flex-wrap gap-1">
            {SKILL_IDEAS.filter((s) => !skills.includes(s)).slice(0, 8).map((s) => (
              <button type="button" key={s} onClick={() => addSkill(s)} className="rounded-full border border-dashed border-stone-300 px-2.5 py-0.5 text-xs text-stone-600 hover:border-stone-500">
                + {s}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="label" htmlFor="emp-resp">What they handle</label>
          <textarea
            id="emp-resp"
            className="input min-h-[90px] resize-y"
            placeholder="Answers the phone, books jobs, knows our regular customers…"
            value={resp}
            maxLength={600}
            onChange={(e) => setResp(e.target.value)}
          />
        </div>

        <div>
          <span className="label">Tools they use</span>
          {toolChoices.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {toolChoices.map((t) => (
                <button
                  type="button"
                  key={t}
                  aria-pressed={tools.includes(t)}
                  onClick={() => toggleTool(t)}
                  className={cn("rounded-full border px-3 py-1 text-xs font-medium", tools.includes(t) ? "border-stone-900 bg-stone-900 text-white" : "border-stone-200 bg-white text-stone-700 hover:border-stone-400")}
                >
                  {catalog[t]?.name.replace(/ \(.*\)$/, "") || t}
                </button>
              ))}
            </div>
          )}
          <div className="mt-2 flex flex-wrap gap-1.5">
            {tools.filter((t) => !catalog[t]).map((t) => (
              <span key={t} className="chip">
                {t}
                <button type="button" onClick={() => toggleTool(t)} aria-label={`Remove ${t}`}>
                  <X size={12} />
                </button>
              </span>
            ))}
          </div>
          <div className="mt-2 flex gap-2">
            <input
              className="input"
              placeholder="Other tool, e.g. Google Sheets"
              value={toolText}
              maxLength={40}
              onChange={(e) => setToolText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addToolText();
                }
              }}
            />
            <button type="button" className="btn-secondary shrink-0" onClick={addToolText}>Add</button>
          </div>
        </div>

        {members.length > 0 && (
          <div>
            <label className="label" htmlFor="emp-member">Their StackSmith account (optional)</label>
            <select id="emp-member" className="input" value={userId} onChange={(e) => setUserId(e.target.value)}>
              <option value="">Not linked</option>
              {members.map((m) => (
                <option key={m.user_id} value={m.user_id}>
                  {m.name} ({m.email})
                </option>
              ))}
            </select>
          </div>
        )}

        {err && (
          <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">
            {err}
          </p>
        )}
      </form>
    </Drawer>
  );
}
