import { confirmDialog } from "../ui/dialogs";
import { PROVIDER_NAME, type Provider } from "./http";

// A ticket proves the user clicked "Run it". Only confirmPaid can mint one; callApi spends it.
declare const brand: unique symbol;
export type PaidTicket = { readonly [brand]: true };
const live = new WeakMap<PaidTicket, { provider: Provider; left: number }>();

// UI code calls this first; a ticket covers up to `calls` calls to that provider.
// `ask` is injectable so tests can mint tickets without a DOM.
export async function confirmPaid(
  provider: Provider,
  action: string,
  costNote: string,
  calls = 1,
  ask: typeof confirmDialog = confirmDialog,
): Promise<PaidTicket | null> {
  const name = PROVIDER_NAME[provider];
  if (!(await ask(`${name}: ${action}`, `This calls ${name} with your own key. ${costNote}`, "Run it"))) return null;
  const t = Object.freeze({}) as PaidTicket;
  live.set(t, { provider, left: calls });
  return t;
}

// Used by callApi only: throws unless the ticket is genuine, for this provider and not used up.
export function spendTicket(provider: Provider, t: PaidTicket): void {
  const s = live.get(t);
  if (!s || s.provider !== provider || s.left < 1) throw new Error(`Blocked: no confirmed ${PROVIDER_NAME[provider]} call to spend`);
  s.left--;
}
