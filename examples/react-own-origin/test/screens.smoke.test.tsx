import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { ReactNode } from "react";

// The screens destructure these exact shapes. Mocking the SDK keeps the smoke test
// about RENDERING — no passkey, no network, no chain. If a conversion drops a
// provider or renames a prop, mount throws and this fails.
const idle = { pending: false, error: null };
const account = {
  evm: { address: "0x1111111111111111111111111111111111111111" },
  solana: { address: "AvokSoLDemoAddress11111111111111111111111111" },
};
const client = {
  // The Export ceremony calls these and must RENDER what they resolve. #3 split the single
  // `export()` into a ROOT key (exportEvmKey) and a LEAF key (exportSolanaKey). Each behavioural
  // test sets its own resolved values via `.mockResolvedValue(...)`.
  exportEvmKey: vi.fn(),
  exportSolanaKey: vi.fn(),
  // #3: enrolment + the pairing ceremony live under enrollAccessSlot (bare call = secondary).
  enrollAccessSlot: Object.assign(vi.fn().mockResolvedValue({ slotId: "0xaaa", txId: "0xtx", passkeyCount: 2 }), {
    viaPairing: null,
  }),
  // The access-path surface. accessSlotCount() is keyless (chain-verified) so screens may call it on
  // mount; listAccessSlots() costs a passkey ceremony, so it only runs when the user asks.
  accessSlotCount: vi.fn().mockResolvedValue(2),
  listAccessSlots: vi.fn().mockResolvedValue([
    { slotId: "0xaaa", addedAt: 1_700_000_000, encryptedMeta: new Uint8Array(), isThisDevice: true, rpId: "acme.test" },
    { slotId: "0xbbb", addedAt: 0, encryptedMeta: new Uint8Array(), isThisDevice: false, rpId: null },
  ]),
  removeAccessSlot: vi.fn().mockResolvedValue({ txId: "0xtx" }),
  // Own-origin drives the SDK namespaces directly (the per-verb hooks were removed in #3). Screens
  // read feeTokens on render and call simulate/send/wait/signMessage on user action.
  evm: {
    feeTokens: () => [],
    simulate: vi.fn(),
    send: vi.fn(),
    wait: vi.fn(),
    signMessage: vi.fn(),
  },
  solana: {
    feeTokens: () => [],
    simulate: vi.fn(),
    send: vi.fn(),
    wait: vi.fn(),
    signMessage: vi.fn(),
    buildSplTransfer: vi.fn(),
  },
};

vi.mock("@avokjs/react", () => ({
  AvokProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
  useAvok: () => client,
  useSelfCustody: () => client,
  useAccount: () => ({ account }),
  useLogout: () => ({ logout: vi.fn() }),
  useCreate: () => ({ create: vi.fn(), ...idle }),
  // #3 renamed useContinue → useLogin; message/tx verbs are now direct client namespace calls (mocked
  // on `client` above), so their per-verb hooks are gone.
  useLogin: () => ({ login: vi.fn(), ...idle }),
  fullName: (label: string, parent: string) => `${label}.${parent}`,
}));

// Whether Onboard opens on the returning ("Sign in") view or the cold two-option view. Set per test.
let returning = false;
vi.mock("../src/returning.js", () => ({
  isReturning: () => returning,
  markReturning: vi.fn(),
}));

import { ThemeProvider } from "../src/theme/ThemeProvider.js";
import { Onboard } from "../src/screens/Onboard.js";
import { Home } from "../src/screens/Home.js";
import { Send } from "../src/screens/Send.js";
import { Account } from "../src/screens/Account.js";
import { Subname } from "../src/screens/Subname.js";
import { Device } from "../src/screens/Device.js";
import { Access } from "../src/screens/Access.js";

const mount = (node: ReactNode) => render(<ThemeProvider>{node}</ThemeProvider>);
const noop = () => {};

// Each affordance is queried as the control a user actually operates, not as loose
// page text: "Fronted" and "ENS" both also appear in nearby explanatory prose, so a
// getByText would match the copy even if the button were gone.
const button = (name: RegExp) => screen.getByRole("button", { name });

beforeEach(() => {
  // Onboard picks its entry view from this flag. Default every test to COLD; the returning test
  // opts in. (Mocked rather than driven through localStorage: this environment's `localStorage` is
  // a bare object with no Storage methods, and the storage mechanism isn't what's under test — the
  // view choice is.)
  returning = false;
  // Clear call history (implementations set via mockResolvedValue survive mockClear). Without this,
  // "listAccessSlots was NOT called" would silently depend on test ORDER.
  vi.clearAllMocks();
  // ThemeProvider reads prefers-color-scheme; jsdom has no matchMedia.
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: false,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    onchange: null,
    dispatchEvent: vi.fn(),
  }));
});

describe("every screen mounts and shows its key affordance", () => {
  it("Onboard COLD asks one question — have you got a wallet — and never makes the user act on a 'passkey'", () => {
    mount(<Onboard />);
    // Exactly two access slots. The synced-vs-not-synced distinction is a detail the user cannot
    // self-diagnose, so it must not be on the front screen; it lives behind "use an existing wallet".
    expect(button(/create a wallet/i)).toBeTruthy();
    expect(button(/use an existing wallet/i)).toBeTruthy();
    // There is no seed to type in, so there is nothing to import.
    expect(screen.queryByRole("button", { name: /import/i })).toBeNull();
    // The B2 rule, encoded: a passkey is the mechanism, never the noun the user acts on. If anyone
    // reintroduces "Continue with passkey", this fails.
    expect(screen.queryByRole("button", { name: /passkey/i })).toBeNull();
  });

  it("Onboard RETURNING offers a single 'Sign in', with an escape back to the cold options", () => {
    returning = true;
    mount(<Onboard />);
    expect(button(/^sign in$/i)).toBeTruthy();
    expect(button(/use a different wallet/i)).toBeTruthy();
    // A returning user is not re-asked a choice they already made.
    expect(screen.queryByRole("button", { name: /create a wallet/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /passkey/i })).toBeNull();
  });

  it("'Use an existing wallet' branches on availability, and set-up warns about the funded tx first", () => {
    mount(<Onboard />);
    fireEvent.click(button(/use an existing wallet/i));
    // The branch: open it here, or bring it over from the device that has it.
    expect(button(/open it/i)).toBeTruthy();
    expect(button(/set it up from another device/i)).toBeTruthy();

    // The enroller half MUST be reachable at sign-in: a device with no wallet has no settings screen
    // to host it. Clicking it mounts the B-side ceremony (PairDevice's SetupFlow).
    fireEvent.click(button(/set it up from another device/i));
    // The ceremony begins async, so its first paint is the loading pane; the request QR renders once
    // pairing.begin() resolves.
    expect(screen.getByText(/preparing/i)).toBeTruthy();
    // …and the funded-transaction warning is on screen BEFORE the credential-creating final step.
    expect(screen.getByText(/one on-chain transaction/i)).toBeTruthy();
    expect(screen.getByText(/no funds can't add a device/i)).toBeTruthy();
  });

  it("Access shows the CHAIN-VERIFIED access-slot count on mount, without a passkey ceremony", async () => {
    mount(<Access onBack={noop} />);
    // accessSlotCount() is keyless, so the honest number is on screen with no prompt…
    expect(await screen.findByText("2")).toBeTruthy();
    // …and the domains are NOT revealed until the user asks, because that costs a ceremony.
    expect(client.listAccessSlots).not.toHaveBeenCalled();
    expect(button(/show which domains/i)).toBeTruthy();
  });

  it("Access states the grant plainly: every access slot can reach the wallet key", () => {
    mount(<Access onBack={noop} />);
    // The load-bearing sentence. An access slot is a DEFERRED GRANT — no copy may imply it 'learns nothing'.
    expect(screen.getByText(/can reach your wallet key/i)).toBeTruthy();
  });

  it("Access reveals the roster on request, naming the domain and tolerating unreadable metadata", async () => {
    mount(<Access onBack={noop} />);
    fireEvent.click(button(/show which domains/i));
    expect(await screen.findByText(/acme\.test/)).toBeTruthy();
    // rpId: null is NORMAL (absent/unreadable metadata) — render it, never an error.
    expect(screen.getByText(/unknown domain/i)).toBeTruthy();
    // addedAt: 0 means the timestamp could not be read — not 1970.
    expect(screen.getByText(/date unknown/i)).toBeTruthy();
  });

  it("Access refuses to call removing an access slot a security control", async () => {
    mount(<Access onBack={noop} />);
    fireEvent.click(button(/show which domains/i));
    await screen.findByText(/acme\.test/);
    fireEvent.click(screen.getAllByRole("button", { name: /close this access slot/i })[0]!);
    // Closing is HOUSEKEEPING. It cannot un-learn the key, the blob stays in chain history, and the
    // only real remedy is moving the funds. If anyone softens this copy, this test fails.
    expect(screen.getByText(/not a security control/i)).toBeTruthy();
    expect(screen.getByText(/cannot un-learn/i)).toBeTruthy();
    expect(screen.getByText(/move your funds to a new wallet/i)).toBeTruthy();
  });

  it("Home renders without throwing", () => {
    const { container } = mount(<Home onSend={noop} />);
    expect(container.firstChild).toBeTruthy();
  });

  it("Send exposes BOTH fee modes — the self-pay/fronted toggle is the demo's point", () => {
    mount(<Send />);
    expect(button(/self-pay/i)).toBeTruthy();
    expect(button(/^fronted$/i)).toBeTruthy();
  });

  it("Account mounts and shows the Export entry point", () => {
    mount(<Account onOpenSubname={noop} onOpenDevice={noop} />);
    expect(button(/export wallet/i)).toBeTruthy();
  });

  it("Subname renders its ENS/SNS toggle", () => {
    mount(<Subname onBack={noop} />);
    expect(button(/ens/i)).toBeTruthy();
    expect(button(/sns/i)).toBeTruthy();
  });

  it("Device renders without throwing", () => {
    const { container } = mount(<Device onBack={noop} />);
    expect(container.firstChild).toBeTruthy();
  });
});

// F1 regression guard. The bug that cost a founder a wallet was NOT a missing Export button —
// it was Export CALLING the export verb and discarding the result, so nothing rendered. A test
// that asserts the button exists cannot catch that (the button was always there). This drives
// the whole ceremony and asserts the two returned keys actually reach the DOM.
describe("Export reveals what exportEvmKey()/exportSolanaKey() return", () => {
  it("drives idle → confirm → done and renders BOTH raw private keys", async () => {
    const keys = {
      evm: "0xEXPORTEDevmKEYdeadbeef00000000000000000000000000000000000000cafe",
      solana: "EXPORTEDsolanaKEYbase58AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAzzz9",
    };
    client.exportEvmKey.mockResolvedValue(keys.evm);
    client.exportSolanaKey.mockResolvedValue(keys.solana);

    mount(<Account onOpenSubname={noop} onOpenDevice={noop} />);

    // idle → confirm (arms the danger gate), confirm → done (invokes handleExport).
    fireEvent.click(button(/export wallet/i));
    fireEvent.click(button(/confirm export/i));

    // The keys themselves must be in the output — not a "done" flag, not an AddressText element,
    // not a call-count on the mock (the verb was called in the buggy version too). Query the
    // literal strings the user needs to copy; if they were discarded, these throw.
    expect(await screen.findByText(keys.evm)).toBeTruthy();
    expect(await screen.findByText(keys.solana)).toBeTruthy();
  });
});
