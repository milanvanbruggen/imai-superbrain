# Organic Graph Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the radial layer force with a fully organic layout that groups nodes by their connections, not by type, while keeping the cluster centered on the canvas.

**Architecture:** Remove `createLayerForce` and `createIsolatedGravity`, add a universal `createCenterGravity` that gently pulls ALL nodes toward the origin (strength 0.03). Increase charge repulsion (-20 → -80) and link distance (45 → 60) so connected nodes spread more naturally. The result: topology drives layout, center gravity prevents drift.

**Tech Stack:** TypeScript, React, react-force-graph-2d, d3-force

---

## Files

- Modify: `web/components/BrainGraph.tsx`

---

### Task 1: Replace force functions and update physics

There are no unit tests for this visual component — verification is by running the dev server and checking the graph renders organically.

**Files:**
- Modify: `web/components/BrainGraph.tsx`

- [ ] **Step 1: Update `COLLIDE_DIST` constant**

Near the top of the file, change:

```typescript
const COLLIDE_DIST = 20
```

to:

```typescript
const COLLIDE_DIST = 24
```

- [ ] **Step 2: Remove `createIsolatedGravity` and `createLayerForce`**

Delete both functions, all blank lines between them, and the trailing blank line after the closing `}` of `createLayerForce` — from the line `/** Pure-JS gravity force for isolated nodes` through and including any blank lines immediately after `createLayerForce`'s closing brace. The next line after the deletion should be the JSDoc comment for `createCollideForce`.

- [ ] **Step 3: Add `createCenterGravity` in their place**

Insert this function directly before `createCollideForce`:

```typescript
/**
 * Pulls ALL nodes gently toward the origin so the cluster stays centered.
 * Much weaker than isolatedGravity — topology still dominates positioning.
 */
function createCenterGravity(strength = 0.03) {
  let simNodes: any[] = []
  function force() {
    for (const node of simNodes) {
      node.vx = (node.vx ?? 0) - (node.x ?? 0) * strength
      node.vy = (node.vy ?? 0) - (node.y ?? 0) * strength
    }
  }
  ;(force as any).initialize = (nodes: any[]) => { simNodes = nodes }
  return force
}
```

- [ ] **Step 4: Update the comment block and body of `applyForces()` inside the physics `useEffect`**

Find the comment block directly above the physics `useEffect` (starts with `// Obsidian-style physics:`). Replace the four bullet lines with:

```typescript
  // Organic physics:
  // - Strong charge (-80) gives nodes breathing room
  // - Link distance 60 keeps connected nodes close but not cramped
  // - Custom collision prevents overlap
  // - Universal center gravity (0.03) keeps the cluster from drifting
```

Then find `applyForces()` inside the same `useEffect`. Replace everything from `const connectedIds` through `fg.d3ReheatSimulation()` with:

```typescript
      fg.d3Force('charge')?.strength(-80)
      fg.d3Force('link')?.distance(60).strength(0.9)
      fg.d3Force('collide', createCollideForce(COLLIDE_DIST))
      fg.d3Force('centerGravity', createCenterGravity(0.03))
      fg.d3Force('isolatedGravity', null)
      fg.d3Force('layer', null)
      fg.d3ReheatSimulation()
```

Key changes:
- `charge`: `-20` → `-80` (more breathing room between nodes)
- `link distance`: `45` → `60` (connected nodes sit slightly further apart)
- `collide`: now uses updated `COLLIDE_DIST` (24)
- `centerGravity`: new force replaces both `isolatedGravity` and `layer`
- `isolatedGravity` and `layer` explicitly set to `null` to unregister them from the simulation

- [ ] **Step 5: Update the `useEffect` dependency array**

After Step 4, neither `degreeById` nor `nodes` are referenced inside `applyForces()` anymore. Change:

```typescript
  }, [size, degreeById, nodes])
```

to:

```typescript
  }, [size])
```

- [ ] **Step 6: Type-check**

```bash
cd web && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 7: Visual verification**

```bash
npm run dev
```

Open http://localhost:3000. Verify:
- Graph renders correctly on initial load without needing to click a node
- Nodes spread organically based on connections (no concentric rings)
- Cluster stays roughly centered (no drift to a corner)
- Dashed person-to-person edges still visible
- Hover/select/dim behaviour unchanged

- [ ] **Step 8: Commit**

```bash
git add web/components/BrainGraph.tsx
git commit -m "feat: organic graph layout with universal center gravity"
git push
```
