import { DEFAULT_MODEL } from "../ai/providers";
import { getKeys, setKeys, type AiProvider, type Keys } from "../ai/keys";
import { toast } from "./dialogs";
import { balance } from "../gen/pixellab";

export function openSettings(onSaved?: () => void): void {
  const k = getKeys();
  const d = document.createElement("dialog");
  d.className = "dialog";
  d.innerHTML = `<form method="dialog"><h2>Keys</h2>
    <p>Stored only in this browser. Each key is sent only to its own provider. Use a key with a spending limit, and remove it here when you are done.</p>
    <label>AI provider <select name="provider"><option value="anthropic">Anthropic</option><option value="openai">OpenAI</option><option value="google">Google</option></select></label>
    <label>Model <input name="model" /></label>
    <label>AI key <input name="ai" type="password" autocomplete="off" /></label>
    <label>PixelLab key <input name="pixellab" type="password" autocomplete="off" /></label>
    <p class="small balance" data-testid="pixellab-balance" hidden></p>
    <label>ElevenLabs key <input name="elevenlabs" type="password" autocomplete="off" /></label>
    <div class="row end"><button type="button" class="btn" data-act="forget">Forget all keys</button>
    <button type="button" class="btn" data-act="cancel">Cancel</button><button value="ok" class="btn primary">Save</button></div></form>`;
  const f = (n: string) => d.querySelector<HTMLInputElement>(`[name=${n}]`)!;
  const provider = f("provider") as unknown as HTMLSelectElement;
  const pv = () => provider.value as AiProvider;
  provider.value = k.ai?.provider ?? "anthropic";
  f("model").value = k.ai?.model ?? DEFAULT_MODEL[pv()];
  f("ai").value = k.ai?.key ?? "";
  f("pixellab").value = k.pixellab ?? "";
  f("elevenlabs").value = k.elevenlabs ?? "";
  if (k.pixellab) {
    // one free read per opening
    const bal = d.querySelector<HTMLElement>(".balance")!;
    bal.hidden = false;
    bal.textContent = "PixelLab balance: checking…";
    balance(k.pixellab).then(
      (b) => (bal.textContent = `PixelLab balance: ${b.text}`),
      () => (bal.textContent = "PixelLab balance could not be read."),
    );
  }
  provider.onchange = () => (f("model").value = DEFAULT_MODEL[pv()]);
  d.querySelector<HTMLButtonElement>("[data-act=forget]")!.onclick = () => {
    setKeys({});
    d.close("cancel");
    toast("All keys forgotten");
  };
  // Cancel is type=button so Enter in a field submits Save, not Cancel.
  d.querySelector<HTMLButtonElement>("[data-act=cancel]")!.onclick = () => d.close("cancel");
  d.addEventListener("close", () => {
    if (d.returnValue === "ok") {
      const n: Keys = {};
      const [ai, pl, el] = [f("ai").value.trim(), f("pixellab").value.trim(), f("elevenlabs").value.trim()];
      if (ai) n.ai = { provider: pv(), model: f("model").value.trim() || DEFAULT_MODEL[pv()], key: ai };
      if (pl) n.pixellab = pl;
      if (el) n.elevenlabs = el;
      setKeys(n);
      toast("Keys saved");
      onSaved?.();
    }
    d.remove();
  });
  document.body.append(d);
  d.showModal();
}
