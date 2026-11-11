// Native <dialog> confirm and a polite toast stack.
export function confirmDialog(title: string, body: string, okLabel: string, cancelLabel = "Cancel", focusCancel = false): Promise<boolean> {
  const d = document.createElement("dialog");
  d.className = "dialog";
  const hid = `dlg-${Math.random().toString(36).slice(2)}`;
  d.setAttribute("aria-labelledby", hid);
  d.innerHTML = `<form method="dialog"><h2 id="${hid}"></h2><p></p><div class="row end">
    <button value="cancel" class="btn"></button><button value="ok" class="btn primary"></button></div></form>`;
  d.querySelector("h2")!.textContent = title;
  d.querySelector("p")!.textContent = body;
  const [no, ok] = d.querySelectorAll("button");
  no.textContent = cancelLabel;
  ok.textContent = okLabel;
  document.body.append(d);
  d.showModal();
  (focusCancel ? no : ok).focus();
  return new Promise((res) =>
    d.addEventListener("close", () => {
      res(d.returnValue === "ok");
      d.remove();
    }),
  );
}

let stack: HTMLElement | null = null;
export function toast(msg: string, kind: "info" | "error" = "info"): void {
  if (!stack) {
    stack = document.createElement("div");
    stack.className = "toasts";
    stack.setAttribute("role", "status");
    stack.setAttribute("aria-live", "polite");
    stack.popover = "manual"; // top layer, so a toast is not hidden under an open modal's backdrop
    document.body.append(stack);
  }
  const t = document.createElement("div");
  t.className = `toast ${kind}`;
  t.textContent = msg;
  stack.append(t);
  // top layer: shown again only under an open modal, so it re-enters above that modal's backdrop
  if (stack.showPopover && (!stack.matches(":popover-open") || document.querySelector("dialog:modal"))) {
    if (stack.matches(":popover-open")) stack.hidePopover();
    stack.showPopover();
  }
  setTimeout(() => t.remove(), kind === "error" ? 7000 : 4000);
}
