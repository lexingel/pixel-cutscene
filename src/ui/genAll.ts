// "Generate all" in Needs approval: every missing piece that can be made, behind one confirm per provider with
// the whole cost written out. Pieces that need something first (a reference, a voice) are left for their own row.
import { confirmPaid, type PaidTicket } from "../ai/confirm";
import { missingReport } from "../core/missing";
import type { Project } from "../core/project";
import { sfxInto, speakInto } from "../gen/eleven";
import { balance, genAnimInto, genBackgroundInto, genFaceInto, type At } from "../gen/pixellab";
import { replaceFlames } from "./addMove";
import { isAudioTarget, targetOf } from "./approvals";
import { toast } from "./dialogs";
import { audioPlan, elevenKey } from "./eleven";
import { isRunning, track } from "./inflight";
import { genAction, genPlan, pixellabKey, words } from "./pixellab";

type Job = { label: string; run: (key: string, t: PaidTicket) => Promise<void> };
export type AllPlan = { pixellab: Job[]; eleven: Job[]; gens: { min: number; max: number }; credits: number; skipped: number };

export function planAll(p: Project): AllPlan {
  const plan: AllPlan = { pixellab: [], eleven: [], gens: { min: 0, max: 0 }, credits: 0, skipped: 0 };
  const tl = p.tl;
  if (!tl) return plan;
  const seen = new Set<string>();
  for (const r of missingReport(tl, p.kit, false, (k) => p.files.has(k))) {
    const t = r.why === "missing" ? targetOf(tl, r) : null;
    if (!t) continue;
    if (t.kind === "asset" && isAudioTarget(t)) {
      const a = audioPlan(p, r.used_by, t.asset);
      const label = a.line ? `Generate voice line ${words(t.id)}` : `Generate sound ${words(t.id)}`;
      if (a.why || seen.has(label)) { plan.skipped += a.why ? 1 : 0; continue; }
      seen.add(label);
      plan.credits += a.line ? [...a.line].length : Math.round(a.seconds! * 20);
      plan.eleven.push({ label, run: (k, tk) => (a.line ? speakInto(p, k, t.id, a.line, a.voice!, tk) : sfxInto(p, k, t.id, a.prompt!, a.seconds!, tk)) });
      continue;
    }
    const at = (t.kind === "asset" ? { kind: "asset", id: t.id } : t) as At;
    const label = genAction(at);
    if (genPlan(p, { ...at, asset: t.kind === "asset" ? t.asset : undefined }).why || seen.has(label)) { plan.skipped += seen.has(label) ? 0 : 1; continue; }
    seen.add(label);
    const posed = at.kind === "anim" && !!p.kit.chars[at.char]?.pl;
    plan.gens.min += posed ? 2 : 1;
    plan.gens.max += posed ? 4 : 1;
    plan.pixellab.push({
      label,
      run: async (k, tk) => {
        if (at.kind === "anim") {
          await genAnimInto(p, k, at.char, at.anim, "", tk);
          if (at.anim === "breathe" && p.tl) p.tl = await replaceFlames(p, p.tl, at.char);
        } else if (at.kind === "face") await genFaceInto(p, k, at.face, at.expr, tk);
        else await genBackgroundInto(p, k, at.id, `side-view game background, ${words(at.id)}`, tk);
      },
    });
  }
  return plan;
}

const pieces = (n: number) => `${n} ${n === 1 ? "piece" : "pieces"}`;

/** One confirm per provider, then each piece in turn; a piece that fails is reported and the rest go on. */
export async function generateAll(p: Project, done: () => void): Promise<void> {
  const plan = planAll(p);
  const runs: [Job[], "pixellab" | "elevenlabs", string, string][] = [];
  if (plan.pixellab.length) {
    const g = plan.gens.min === plan.gens.max ? `about ${plan.gens.min}` : `${plan.gens.min} to ${plan.gens.max}`;
    const bal = await balance(pixellabKey()!).then((b) => b.text, () => "could not be read");
    runs.push([plan.pixellab, "pixellab", pixellabKey()!, `${pieces(plan.pixellab.length)}, ${g} generations. Your balance: ${bal}.`]);
  }
  if (plan.eleven.length) runs.push([plan.eleven, "elevenlabs", elevenKey()!, `${pieces(plan.eleven.length)}, about ${plan.credits} credits.`]);
  let made = 0, failed = 0;
  for (const [jobs, provider, key, cost] of runs) {
    const t = await confirmPaid(provider, `Generate all (${pieces(jobs.length)})`, `${cost} ${jobs.map((j) => j.label.replace(/^Generate /, "")).join(", ")}.`, jobs.length);
    if (!t) continue;
    for (const j of jobs) {
      if (isRunning(j.label)) continue;
      try {
        await track(j.label, () => j.run(key, t));
        made++;
        done();
      } catch (e) {
        failed++;
        toast(`${j.label}: ${(e as Error).message}`, "error");
      }
    }
  }
  if (made) toast(`Generated ${pieces(made)}${failed ? `, ${failed} failed` : ""}. Look them over, then Approve or Redo.`);
}
