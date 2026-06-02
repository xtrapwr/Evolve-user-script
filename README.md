# Evolve Idle Auto-Buy Automation Userscript

An advanced, feature-rich automation utility for the incremental game [Evolve Idle](https://pmotschmann.github.io/Evolve/). This script integrates seamlessly into the native UI, providing smart purchasing, dynamic crafting simulation, automatic trade route management (both planetary and galactic), and proactive storage expansion to maximize resource generation and queue efficiency.

---

## 🚀 Key Features

* **Smart Market Purchasing:** Automatically purchases market items using Evolve's internal price formulas, taking into account character traits (e.g., Arrogant, Conniving) and achievement modifiers (e.g., Imp Fathom factor).
* **Pure State Cooldowns:** Employs state comparison logic rather than arbitrary timers to identify price "coiling" and price spikes (>3.0x base), ensuring purchases are only made after prices stabilize.
* **Smart Queue Scanning & Virtual Crafting:** Simulates progressive queue needs up to your horizon limit. If a needed resource is craftable (e.g., Alloy, Brick, Wrought Iron), it virtually crafts them, deducts precursors, and calculates outstanding needs.
* **Planetary Trade Route Management:** Dynamically adjusts import routes to resolve queue bottlenecks. Features priority-scoring strategies and automatically handles complex game constraints like the **Dealmaker** governor cap, **Banana** trait restrictions, and **Terrifying** or **No Trade** challenge scenarios.
* **Galactic Trade Route Automation:** Adjusts cargo freighters across space trade routes while enforcing a configurable minimum safety limit for piracy.
* **Proactive Storage Expansion:** Automatically enqueues storage buildings when your build queue is empty, prioritizing the resource that is closest to capping.
* **Inline UI Dashboard:** Injects a collapsible settings panel and detailed telemetry directly into the Evolve **Market** tab, showing price state tags (`[Cheap]`, `[Allowable]`, `[Spiked]`, `[Decaying]`) for all market resources.

---

## 📦 Installation

1. Install a userscript manager browser extension:
   * [Tampermonkey](https://www.tampermonkey.net/) (Recommended)
   * [Violentmonkey](https://violentmonkey.github.io/)
2. Open the userscript manager dashboard and create a new script.
3. Copy the contents of `evolve_autobuy.user.js` and paste it into the editor.
4. Save the script and navigate to (or refresh) [Evolve Idle](https://pmotschmann.github.io/Evolve/).

---

## 🛠️ Configuration & Dashboard Controls

The configuration panel is located at the top of the **Market** tab in-game.

### Master Switch
* **Enabled Checkbox:** Toggles all core automation loops (buying, crafting, route management, storage expansion) on or off.

### Settings Panel (Collapsible ▶)
* **Trade Routes Checkbox:** Enables automatic allocation of available planetary import routes to resolve queue bottlenecks.
* **Galactic Routes Checkbox:** Enables automatic assignment of cargo freighters to space routes.
* **Min Route Efficiency Dropdown:** Sets the threshold for piracy risk on galactic trade routes. If overall piracy loss exceeds this limit, routes are scaled back to prevent resource waste.
* **Strategy Dropdown:** Selects the mathematical weight used to prioritize resource trade allocations:
  * **Time-Saving Utility (Recommended):** Heavily weights the time required to generate the missing resource. Recommended for breaking long-term bottlenecks.
  * **Balanced Bottleneck:** A hybrid approach balancing price ratios and generation time.
  * **Price Ratio (Legacy):** Focuses purely on buying resources that offer the best price deal relative to their base price.
* **Toggle All Checkboxes Button:** Quick toggle to enable/disable all resources for targeted fallback auto-buying.

### Telemetry Panel (Collapsible ▶)
* **Price & Piracy Details:** Displays live telemetry including Gorddon piracy losses (Overall, Local, and Stargate).
* **Queue Focus:** Lists the resources currently being targeted to fulfill your active build/research queues, including calculated outstanding amounts.

---

## ⚙️ How It Works (Under the Hood)

### Save Interception
To access the game's internal data model safely, the script hooks `localStorage.getItem` at `document-start`. It decodes your compressed save string, sets `expose = true` in the game settings, re-compresses it, and passes it back. This causes the game engine to execute its native `enableDebug()` function, safely exposing the `window.evolve` object without corrupting gameplay.

### Price Safeguards & Modes
The script operates in two primary modes to protect your funds:
* **Normal Mode (Cash < 99%):** Respects a safety ceiling of **2.0x base price**. It will not buy resources above this price unless cash reaches 95% (to prevent cash overflow waste). It also prevents purchases on decaying prices or spiked cooldown periods.
* **Cap-Safe Mode (Cash ≥ 99%):** If money is about to cap, the script bypasses safety ceilings and price-decay checks to buy the highest priority resources (Targeted $\rightarrow$ Queue $\rightarrow$ Fallback), preventing money overflow.

### Priority Score Formula
Import trade routes are sorted and allocated using the following prioritization index:

$$\text{Priority Score} = \frac{\text{Price Ratio}}{\text{TimeToGenerate}^w}$$

* **Price Ratio:** $\text{Current Price} / \text{Base Price}$ (lower is cheaper).
* **TimeToGenerate:** $\text{Outstanding Resource Need} / \text{Resource Generation Rate}$ (longer bottlenecks receive priority).
* **Strategy Weight ($w$):** Set via the Strategy dropdown (`time_saved` = 1.0, `balanced` = 0.5, `ratio` = 0.0).

---

## 📜 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
