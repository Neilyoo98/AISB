"use client";
import { useEffect, useState } from "react";
import { Check, Copy, Link2, X } from "lucide-react";
import { api, cn } from "@/lib/api";
import type { Tool } from "@/lib/types";
import { HelpTip, Spinner } from "@/components/ui";
import { Drawer } from "@/components/coworkers/Drawer";
import { copyText, fullUrl, type Person } from "./types";

const SKILL_IDEAS = ["Scheduling", "Customer calls", "Quotes", "Invoices & payments", "Repairs", "Installs", "Social media", "Reviews", "Ordering supplies", "Hiring & shifts"];

/** Add (or edit) a person once: their profile builds their AI coworker, and an optional invite link gives them a login. */
export function AddPersonDrawer({
  open, onClose, onSaved, editing, catalog, adoptedIds,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: (p: Person) => void;
  editing: Person | null;
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
  const [invite, setInvite] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(editing?.name || "");
    setRole(editing?.role || "");
    setSkills(editing?.skills || []);
    setResp(editing?.responsibilities || "");
    setTools(editing?.tools || editing?.ai_tools.filter((t) => t.source === "uses").map((t) => t.tool_id || t.name) || []);
    setInvite(!editing);
    setSkillText("");
    setToolText("");
    setErr(null);
    setLink(null);
    setCopied(false);
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
    if (!skills.length && !resp.trim()) return setErr("Add at least one skill or what they handle, so their AI coworker knows when to step in.");
    setBusy(true);
    setErr(null);
    const body = { name: name.trim(), role: role.trim(), skills, responsibilities: resp.trim(), tools };
    try {
      if (editing) {
        const saved = await api<Person>(`/people/${editing.id}`, { method: "PATCH", json: body });
        onSaved(saved);
      } else {
        const r = await api<{ person: Person; invite_url: string | null }>("/people", { method: "POST", json: { ...body, invite } });
        onSaved(r.person);
        if (r.invite_url) {
          setLink(r.invite_url);
          setBusy(false);
          return; // keep the drawer open so the owner can copy the link
        }
        onClose();
      }
    } catch (e) {
      setErr((e as Error).message);
    }
    setBusy(false);
  };

  const toolChoices = Array.from(new Set([...adoptedIds, ...tools.filter((t) => catalog[t])]));

  if (link)
    return (
      <Drawer open={open} onClose={onClose} title={`${name} is on your team`}
        footer={<button className="btn-primary w-full py-3" onClick={onClose}>Done</button>}>
        <div className="space-y-3">
          <p className="text-sm text-stone-700">Send this link so {name.split(" ")[0]} can log in, request tools and see their tasks. It works once and expires in 14 days.</p>
          <div className="flex flex-col gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3">
            <span className="flex items-start gap-2 text-sm text-emerald-900">
              <Link2 size={16} className="mt-0.5 shrink-0" />
              <code className="break-all">{fullUrl(link)}</code>
            </span>
            <button
              className="btn-secondary self-start py-1.5 text-xs"
              onClick={async () => {
                if (await copyText(fullUrl(link))) {
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1800);
                }
              }}
            >
              {copied ? <><Check size={14} /> Copied</> : <><Copy size={14} /> Copy link</>}
            </button>
          </div>
        </div>
      </Drawer>
    );

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={editing ? `Edit ${editing.name}` : "Add a person"}
      footer={
        <button form="person-form" className="btn-primary w-full py-3" disabled={busy}>
          {busy ? <Spinner /> : editing ? "Save changes" : "Add to team"}
        </button>
      }
    >
      <form id="person-form" onSubmit={save} className="space-y-4">
        <p className="flex items-center gap-1 text-sm text-stone-600">
          Add them once. Their AI coworker learns from this.
          <HelpTip>When you hand the team a task, the coworker whose skills fit best takes the lead. If that person is off today, their coworker still shares what they know and a colleague does the hands-on part.</HelpTip>
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="p-name">Name</label>
            <input id="p-name" className="input" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
          </div>
          <div>
            <label className="label" htmlFor="p-role">Role</label>
            <input id="p-role" className="input" placeholder="Lead technician" value={role} maxLength={80} onChange={(e) => setRole(e.target.value)} />
          </div>
        </div>

        <div>
          <label className="label" htmlFor="p-skill">Skills</label>
          {skills.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-1.5">
              {skills.map((s) => (
                <span key={s} className="chip border-emerald-200 bg-emerald-50 text-emerald-900">
                  {s}
                  <button type="button" onClick={() => setSkills(skills.filter((x) => x !== s))} aria-label={`Remove ${s}`}><X size={12} /></button>
                </span>
              ))}
            </div>
          )}
          <input
            id="p-skill"
            className="input"
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
              <button type="button" key={s} onClick={() => addSkill(s)} className="rounded-full border border-dashed border-stone-300 px-2.5 py-0.5 text-xs text-stone-600 hover:border-stone-500">+ {s}</button>
            ))}
          </div>
        </div>

        <div>
          <label className="label" htmlFor="p-resp">What they handle</label>
          <textarea id="p-resp" className="input min-h-[90px] resize-y" placeholder="Answers the phone, books jobs, knows our regular customers…" value={resp} maxLength={600} onChange={(e) => setResp(e.target.value)} />
        </div>

        <div>
          <span className="label">AI tools they use</span>
          {toolChoices.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {toolChoices.map((t) => (
                <button type="button" key={t} aria-pressed={tools.includes(t)} onClick={() => toggleTool(t)}
                  className={cn("rounded-full border px-3 py-1 text-xs font-medium", tools.includes(t) ? "border-stone-900 bg-stone-900 text-white" : "border-stone-200 bg-white text-stone-700 hover:border-stone-400")}>
                  {catalog[t]?.name.replace(/ \(.*\)$/, "") || t}
                </button>
              ))}
            </div>
          )}
          {tools.filter((t) => !catalog[t]).length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {tools.filter((t) => !catalog[t]).map((t) => (
                <span key={t} className="chip">{t}<button type="button" onClick={() => toggleTool(t)} aria-label={`Remove ${t}`}><X size={12} /></button></span>
              ))}
            </div>
          )}
          <div className="mt-2 flex gap-2">
            <input className="input" placeholder="Other tool, e.g. Google Sheets" value={toolText} maxLength={40} onChange={(e) => setToolText(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addToolText(); } }} />
            <button type="button" className="btn-secondary shrink-0" onClick={addToolText}>Add</button>
          </div>
        </div>

        {!editing && (
          <label className="flex items-start gap-2.5 rounded-xl border border-stone-200 p-3 text-sm">
            <input type="checkbox" className="mt-0.5 h-4 w-4 accent-emerald-700" checked={invite} onChange={(e) => setInvite(e.target.checked)} />
            <span>
              <span className="font-medium">Send them an invite link so they can log in</span>
              <span className="block text-xs text-stone-500">They can then request tools and see their tasks.</span>
            </span>
          </label>
        )}

        {err && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{err}</p>}
      </form>
    </Drawer>
  );
}
