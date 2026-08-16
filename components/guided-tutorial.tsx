"use client";
import { useCallback, useEffect, useState } from "react";

type Preferences = {
  completed: boolean;
  dismissed: boolean;
  auto_launch: boolean;
};

const steps = [
  {
    title: "WELCOME TO TRADING COMMAND CENTER",
    section: "Dashboard",
    target: "dashboard-nav",
    body: "This tutorial will show you what each part of the platform does and where to look when the system is trading.",
  },
  {
    title: "DASHBOARD",
    section: "Dashboard",
    target: "dashboard-nav",
    body: "This is your main control center. It tells you what the trading system is doing right now.",
  },
  {
    title: "ACTIVE TRADES",
    section: "Dashboard",
    target: "active-trades",
    body: "This tells you whether any trades are currently open, how many are active, and how much capital is currently in the market. Open Exposure is the amount currently tied to open positions.",
  },
  {
    title: "WIN / LOSS",
    section: "Dashboard",
    target: "open-performance",
    body: "Green means your current open trades are profitable. Red means your current open trades are losing. Unrealized P/L is profit or loss on open positions; Realized P/L is from trades that already closed.",
  },
  {
    title: "AUTO TRADER",
    section: "Auto Trader",
    target: "workspace-main",
    body: "Auto Trader can automatically find and place eligible PAPER trades. When paused, it does not open new automatic trades.",
  },
  {
    title: "BIG MONEY",
    section: "Big Money",
    target: "workspace-main",
    body: "Big Money performs deeper research and creates larger trade recommendations for your approval. Risk/Reward compares potential reward with planned loss.",
  },
  {
    title: "PORTFOLIO",
    section: "Portfolio",
    target: "workspace-main",
    body: "Portfolio shows the positions that are currently open and how much money is exposed. Buying Power is the amount your PAPER broker currently allows the account to use.",
  },
  {
    title: "STRATEGIES",
    section: "Strategies",
    target: "workspace-main",
    body: "Strategies show how the system decides when to trade and how those strategies have performed.",
  },
  {
    title: "PAPER TRADING",
    section: "Paper Trading",
    target: "workspace-main",
    body: "Paper Trading is where you can manually create PAPER orders to test the system. A Stop Loss limits loss; Take Profit exits to secure profit.",
  },
  {
    title: "TRADE JOURNAL",
    section: "Trade Journal",
    target: "workspace-main",
    body: "Trade Journal records completed trades and lets you review what happened.",
  },
  {
    title: "RISK MANAGER",
    section: "Risk Manager",
    target: "workspace-main",
    body: "Risk Manager controls how much the system is allowed to risk and when trading must stop.",
  },
  {
    title: "NOTIFICATIONS",
    section: "Notifications",
    target: "workspace-main",
    body: "Notifications lets you choose which browser or phone alerts you want to receive.",
  },
  {
    title: "DIAGNOSTICS",
    section: "Diagnostics",
    target: "workspace-main",
    body: "Diagnostics tells you whether the hosted trading system is healthy.",
  },
  {
    title: "LIVE",
    section: "Dashboard",
    target: "live-lock",
    body: "LIVE remains locked. PAPER uses simulated money.",
  },
  {
    title: "PAPER MODE GUIDE COMPLETE",
    section: "Dashboard",
    target: "dashboard-nav",
    body: "You can replay or reset this guide at any time from Settings.",
  },
] as const;

async function update(action: string, values: Record<string, unknown> = {}) {
  const response = await fetch("/api/tutorial", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action, ...values }),
  });
  return response.ok;
}

export function GuidedTutorial({
  navigate,
}: {
  navigate: (section: string) => void;
}) {
  const [open, setOpen] = useState(false),
    [step, setStep] = useState(0);
  useEffect(() => {
    void fetch("/api/tutorial", { cache: "no-store" })
      .then((response) => response.json())
      .then(({ preferences }: { preferences?: Preferences }) => {
        if (
          preferences?.auto_launch &&
          !preferences.completed &&
          !preferences.dismissed
        )
          setOpen(true);
      })
      .catch(() => undefined);
    const replay = () => {
      setStep(0);
      setOpen(true);
    };
    window.addEventListener("trade-tutorial-replay", replay);
    return () => window.removeEventListener("trade-tutorial-replay", replay);
  }, []);
  useEffect(() => {
    if (!open) return;
    const current = steps[step];
    navigate(current.section);
    const target = document.querySelector(
      `[data-tutorial="${current.target}"]`,
    );
    target?.classList.add("tutorial-highlight");
    return () => target?.classList.remove("tutorial-highlight");
  }, [navigate, open, step]);
  const close = useCallback(async () => {
    setOpen(false);
    await update("DISMISS");
  }, []);
  if (!open) return null;
  const current = steps[step];
  return (
    <div className="tutorial-layer" role="dialog" aria-modal="true">
      <button
        className="tutorial-close"
        onClick={close}
        aria-label="Close tutorial"
      >
        ×
      </button>
      <div className="tutorial-card">
        <span className="section-label">
          GUIDED TUTORIAL · {step + 1}/{steps.length}
        </span>
        <h2>{current.title}</h2>
        <p>{current.body}</p>
        <footer>
          {step === 0 ? (
            <>
              <button onClick={close}>SKIP</button>
              <button className="button primary" onClick={() => setStep(1)}>
                START TUTORIAL
              </button>
            </>
          ) : (
            <>
              <button onClick={close}>EXIT</button>
              {step > 1 && (
                <button onClick={() => setStep((value) => value - 1)}>
                  BACK
                </button>
              )}
              <button
                className="button primary"
                onClick={async () => {
                  if (step === steps.length - 1) {
                    setOpen(false);
                    await update("COMPLETE");
                  } else setStep((value) => value + 1);
                }}
              >
                {step === steps.length - 1 ? "FINISH" : "NEXT"}
              </button>
            </>
          )}
        </footer>
      </div>
    </div>
  );
}

export function TutorialSettings() {
  const [preferences, setPreferences] = useState<Preferences | null>(null),
    [message, setMessage] = useState("");
  useEffect(() => {
    void fetch("/api/tutorial")
      .then((response) => response.json())
      .then((data) => setPreferences(data.preferences ?? null));
  }, []);
  const act = async (action: "RESET" | "REPLAY") => {
    const ok = await update(action);
    setMessage(
      ok ? "Tutorial preference saved." : "Tutorial preference was not saved.",
    );
    if (ok && action === "REPLAY")
      window.dispatchEvent(new Event("trade-tutorial-replay"));
    if (ok && action === "RESET")
      setPreferences({ completed: false, dismissed: false, auto_launch: true });
  };
  return (
    <section className="module tutorial-settings">
      <header className="module-head">
        <div>
          <span className="section-label">GUIDED TUTORIAL</span>
          <h2>Owner walkthrough</h2>
        </div>
      </header>
      <label className="toggle-row">
        <span>AUTO SHOW TUTORIAL</span>
        <input
          type="checkbox"
          checked={preferences?.auto_launch ?? false}
          onChange={async (event) => {
            const auto_launch = event.target.checked;
            if (await update("", { auto_launch }))
              setPreferences((value) =>
                value ? { ...value, auto_launch } : value,
              );
          }}
        />
      </label>
      <div className="modal-actions">
        <button onClick={() => void act("REPLAY")}>REPLAY TUTORIAL</button>
        <button onClick={() => void act("RESET")}>RESET TUTORIAL</button>
      </div>
      {message && <p className="paper-warning">{message}</p>}
    </section>
  );
}
