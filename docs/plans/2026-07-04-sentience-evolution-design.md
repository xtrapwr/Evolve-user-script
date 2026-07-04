# Sentience Evolution and T2 Ordering Design

This design document outlines the changes to improve target recommendations in the Evolve MAD Farm Companion script, specifically handling species locking and optimizing T2 bioseed ordering.

## Problem Description
1. **Species Locking**: Without the **Mass Extinction** achievement (25 unique global MAD resets), players cannot directly evolve into new species on non-seeded runs. However, they *can* evolve into them randomly using the **Sentience** button. The script currently filters out locked species entirely, causing it to recommend premature bioseed resets.
2. **Premature Bioseeding**: If a target genus isn't bioseeded, the script marks all species in that genus as `Needs T2`. If a player bioseeds on the first one they run, they leave the planet early, missing the opportunity to do MAD resets on the remaining species of that genus.

## Proposed Changes

### 1. Species Availability & T2 Sort Logic
- Update `getAvailableSpecies` to remove the strict `isSpeciesResetGlobally` filter when `!hasMassExtinction && !isSeededRun`. Any biome-compatible species is considered available.
- Update `getUncompletedSpeciesOnPlanet` to precalculate a `needsT2Map`. For any uncompleted target genus:
  - Find all its species on this planet.
  - Mark only the **last** remaining species of that genus in the list as `Needs T2`.
  - Mark the others as `Pending` (regular MAD).
- Sort the uncompleted species list so that `needsT2 = false` species are recommended first.

### 2. Prehistoric UI & Dashboard Guides
- Add a check `canEvolveDirectly = isSeededRun || hasMassExtinction || isSpeciesResetGlobally(targetSpecies)`.
- If `!canEvolveDirectly`:
  - Show `(via Sentience)` in the prebiotic dashboard.
  - Highlight the Sentience button (`#evolution-sentience`) instead of the locked species button in the prehistoric guides.

## Verification Plan
- Verify that on a swamp planet with `sharkin` reset and `octigoran` locked:
  - `octigoran` is recommended as `Evolve: target OCTIGORAN (via Sentience)`.
  - The Sentience button is highlighted.
  - Prehistoric branches (`evolution-aquatic`) are correctly highlighted.
