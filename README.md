# Evolve Idle Auto-Buy Automation Userscript

An advanced automation utility for the incremental game Evolve Idle. This script integrates into the native UI, providing smart purchasing, dynamic crafting simulation, automatic trade route management (both planetary and galactic), and proactive storage expansion to maximize resource generation and queue efficiency.

---

## Key Features

* Smart Market Purchasing: Automatically purchases market items using Evolve's internal price formulas, taking into account character traits and achievement modifiers.
* State-Based Price Safeguards: Uses state comparison logic to identify price coiling and price spikes, ensuring purchases are only made after prices stabilize.
* Smart Queue Scanning and Virtual Crafting: Simulates progressive queue needs up to the current queue horizon limit. If a needed resource is craftable (such as Alloy, Brick, or Wrought Iron), it virtually crafts them, deducts precursors, and calculates outstanding needs.
* Planetary Trade Route Management: Automatically allocates available planetary import routes to resolve build queue bottlenecks.
* Galactic Trade Route Automation: Automatically assigns cargo freighters across space trade routes while enforcing a minimum safety limit to prevent losses from piracy.
* Proactive Storage Expansion: Automatically enqueues storage buildings when the build queue is empty, prioritizing resources closest to their capacity cap.
* Inline UI Dashboard: Injects a collapsible settings panel and detailed telemetry directly into the Evolve Market tab, showing price state tags (such as Cheap, Allowable, Spiked, or Decaying) for all market resources.

---

## Installation

1. Install a userscript manager browser extension:
   * Tampermonkey (Recommended)
   * Violentmonkey
2. Open the userscript manager dashboard and create a new script.
3. Copy the contents of evolve_autobuy.user.js and paste it into the editor.
4. Save the script and navigate to (or refresh) Evolve Idle.

---

## Configuration and Dashboard Controls

The configuration panel is located at the top of the Market tab in-game.

### Master Switch
* Enabled: Toggles all core automation loops (buying, crafting, route management, storage expansion) on or off.

### Settings Panel
* Trade Routes: Enables automatic allocation of available planetary import routes to resolve queue bottlenecks.
* Galactic Routes: Enables automatic assignment of cargo freighters to space routes.
* Min Route Efficiency: Sets the threshold for piracy risk on galactic trade routes. If overall piracy loss exceeds this limit, routes are scaled back to prevent resource waste.
* Strategy: Selects the strategy used to prioritize resource trade allocations:
  * Time-Saving Utility (Recommended): Prioritizes resources based on the time required to generate the missing amount. Highly effective for breaking long-term bottlenecks.
  * Balanced Bottleneck: A hybrid approach that balances resource price ratios and generation time.
  * Price Ratio: Focuses on buying resources that offer the best price deal relative to their base price.
* Toggle All Checkboxes: Quick toggle to enable or disable all resources for targeted fallback auto-buying.

### Telemetry Panel
* Price and Piracy Details: Displays live telemetry including Gorddon piracy losses (Overall, Local, and Stargate).
* Queue Focus: Lists the resources currently being targeted to fulfill your active build and research queues, including calculated outstanding amounts.

---

## Purchase Modes

To protect your funds and maximize resource utilization, the script operates in two primary modes:

* Normal Mode (Cash < 99%): Respects a safety ceiling of 2.0x base price. It does not buy resources above this price unless cash reaches 95% (to prevent cash overflow waste). It also prevents purchases on decaying prices or spiked cooldown periods.
* Cap-Safe Mode (Cash >= 99%): Bypasses safety ceilings and price-decay checks to buy the highest priority resources (Targeted, then Queue, then Fallback), preventing money overflow.

---

## Disclaimer

This userscript is AI-generated and authored by Antigravity.

---

## License

This project is licensed under the MIT License - see the LICENSE file for details.
