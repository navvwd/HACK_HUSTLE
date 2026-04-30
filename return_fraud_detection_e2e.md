# Return Fraud Ring Detection — End-to-End Architecture

## Problem Statement

Organised return rings are the most damaging pattern in e-commerce fraud. Coordinated groups operate across dozens of synthetic or stolen accounts, rotating through addresses and devices, submitting high-value fraud claims that individually look legitimate but collectively form a network signature. No single request raises a red flag — the signal is in the pattern across requests.

This document describes a five-layer detection pipeline that identifies these rings without creating friction for legitimate customers.

---

## Architecture Overview

The pipeline has five layers. Every signal flows top to bottom. The critical false-positive rule lives in layer four: **no single signal ever triggers a block alone.**

```
Customer opens return form
        │
        ▼
┌─────────────────────────────────┐
│  Layer 1 — Signal Collection    │  Client-side JS (silent)
└─────────────────────────────────┘
        │
        ▼
┌─────────────────────────────────┐
│  Layer 2 — Feature Extraction   │  Backend, per request
└─────────────────────────────────┘
        │
        ▼
┌─────────────────────────────────┐
│  Layer 3 — Three Parallel       │  Device · Behavior · Graph
│           Scorers               │  Each outputs 0–100
└─────────────────────────────────┘
        │
        ▼
┌─────────────────────────────────┐
│  Layer 4 — Fusion Engine        │  False-positive firewall
└─────────────────────────────────┘
        │
        ▼
┌─────────────────────────────────┐
│  Layer 5 — Decision Tiers       │  Green · Amber · Orange · Red
└─────────────────────────────────┘
```

---

## Layer 1 — Signal Collection

**Runs:** Client-side JavaScript, the moment the return form loads  
**Visible to user:** Nothing

### Device Fingerprinting

The browser silently builds a stable device hash before the customer fills in a single field. The hash survives VPN switches and incognito mode — the only way to defeat it is to use a completely different physical device.

| Signal | Method |
|--------|--------|
| Canvas fingerprint | Render a hidden 200×50 canvas with specific text and shapes. Hash the pixel output — GPU differences produce measurably different values |
| WebGL renderer string | Query GPU vendor and model string directly — extremely stable, changes only on hardware swap |
| Screen resolution + pixel ratio | Captured from `window.screen` and `devicePixelRatio` |
| Font detection | Measure character rendering widths for a set of test fonts — installed fonts produce measurably different values |
| Audio context hash | Render an oscillator node and hash the floating-point output — audio hardware differences produce unique values |
| Battery state | Charge level and charging status via Battery API |
| Touch capability | `navigator.maxTouchPoints` — differentiates phones from desktops with a mouse |
| Timezone offset | `Intl.DateTimeFormat().resolvedOptions().timeZone` |

All signals are combined into a single stable hash — this is the **device ID**.

### Behavioral Biometrics

Passive event listeners attach to the form and record interaction patterns without the customer knowing:

- **Dwell time** per key — how long each key is held down
- **Flight time** between keystrokes
- **Mouse movement velocity vectors**
- **Scroll rhythm** — speed and pattern
- **Time from page load to first interaction**

This data creates a behavioral signature unique to each individual. A genuine returning user is remarkably consistent across sessions. A fraudster using stolen credentials will type and move differently than the account owner.

---

## Layer 2 — Feature Extraction

**Runs:** Backend, on every return request  
**Stack:** PostgreSQL (persistence), Redis (speed)

### Fingerprint Database Lookup

The device hash is looked up in PostgreSQL against a table with three critical columns:

```sql
fingerprint_hash  |  account_ids[]  |  first_seen_at
```

- New hash → insert new record
- Known hash → append the current account to the array
- The account array is the core input to the device scorer

### Behavioral Profile Delta

On the **first session** for an account, the behavioral event stream becomes the stored baseline profile.

On **subsequent sessions**, the system computes a delta score — how much does this session's typing rhythm, mouse pattern, and scroll behavior deviate from the historical average for this account? This is calculated as a Z-score (standard deviation from the stored mean).

### Feature Store Write

Session metadata — IP, user agent, return shipping address, target SKU, order timestamp — is written to the feature store. This feeds the graph scorer and creates the edges needed for ring detection.

---

## Layer 3 — Three Parallel Scorers

**Runs:** Concurrently via `asyncio.gather` — total latency is the slowest scorer (~80ms, typically the graph scorer)  
**Output:** Each scorer independently produces a score from 0 to 100

### Scorer 1 — Device Scorer

**Question answered:** How many distinct accounts share this fingerprint hash?

| Accounts on device | Score |
|--------------------|-------|
| 1 account | 0 |
| 2 accounts | 20 |
| 5 accounts | 60 |
| 10+ accounts | 90 |

The relationship is exponential beyond three. Two accounts on one device has an innocent explanation (family members, work and personal). Five accounts on one device has no innocent explanation.

### Scorer 2 — Behavior Scorer

**Question answered:** How much does this session deviate from the account owner's stored behavioral profile?

| Deviation | Score |
|-----------|-------|
| Below 1σ | 0 |
| 1–2σ | 30 |
| Above 2σ | 70 |
| Above 3σ | 90 |

This is the **account takeover detector**. A fraudster who bought stolen credentials will interact with the return form differently than the legitimate account owner who built the stored profile.

### Scorer 3 — Graph Scorer

**Question answered:** Does this account belong to a coordinated cluster?

The scorer builds a graph where nodes are accounts, device fingerprints, shipping addresses, and IP subnets. Edges connect them when they appear together in the same return request. A community detection algorithm (Louvain or label propagation) identifies clusters.

| Cluster size | Score |
|-------------|-------|
| Isolated account | 0 |
| Cluster of 3 | 25 |
| Cluster of 8+ | 80 |
| 15+ accounts, created same week, all targeting high-value SKUs | 95 |

The graph scorer is specifically designed to find the ring pattern — claims that individually look innocent but collectively form a network signature.

---

## Layer 4 — Fusion Engine

**The false-positive firewall.** This is where legitimate customer protection is enforced.

### Weighted Combination

```
Combined score = (device × 0.35) + (behavior × 0.30) + (graph × 0.35)
```

### The Corroboration Rule — Hard Constraint

> A score cannot escalate above amber unless **at least two of the three individual scores exceed 40.**

This means a single strong signal — one scorer firing at 90 while the other two sit at 5 — produces an amber outcome at most, never a block. You need corroboration from independent signal sources.

**Example A — fraud ring member:**
- Device scorer: 72 (4 accounts on one device)
- Behavior scorer: 85 (3.2σ deviation — account takeover)
- Graph scorer: 68 (cluster of 9)
- Combined: 74.5 → all three exceed 40 → escalation to orange permitted

**Example B — VPN user, innocent:**
- Device scorer: 0 (only one account on device)
- Behavior scorer: 15 (normal typing rhythm for this account)
- Graph scorer: 90 (coincidentally connected to a suspicious cluster via shared IP subnet)
- Combined: 35.5 → only one scorer exceeds 40 → **capped at amber**

### Decay Function

Signal age erodes certainty. A device fingerprint match from 18 months ago carries 40% of its original weight. A behavioral mismatch on a session where the customer demonstrably switched from desktop to mobile is discounted — the profile was built on a different input modality.

---

## Layer 5 — Decision Tiers

~70% of returns never see any friction.

### Green — Auto-approve
**Trigger:** Combined score 0–30  
**Customer experience:** Instant refund confirmation. System completely invisible.  
**Volume:** ~70% of all return requests

### Amber — Photo required
**Trigger:** Combined score 31–60, or only one scorer above 40  
**Customer experience:** "Please upload a photo of the item you're returning." Feels like standard process.  
**Why it works:** A legitimate customer with a genuine return takes one photo. A wardrobing customer who doesn't have the item in returnable condition, or a fraudster submitting a fake damage claim, faces a real barrier.  
**Volume:** ~20% of all return requests

### Orange — Human review
**Trigger:** Combined score 61–80, with at least two scorers above 40  
**Customer experience:** "Your return is under review — you'll hear back within 24 hours."  
**Why it works:** No accusation is made. A human reviewer sees the full evidence package and makes a nuanced call that no algorithm should make unilaterally.  
**Volume:** ~8% of all return requests

### Red — Hard block
**Trigger:** Combined score 81–100 **AND** all three individual scorers exceed 60  
**Customer experience:** "This return requires additional review." An appeal link with direct human escalation is always present.  
**Critical constraint:** One scorer at 95 with two at 15 does not produce red — it produces orange. Red requires the strongest evidence from the most independent signal sources.  
**Volume:** ~2% of all return requests

> **Important:** The customer is never told "you are a fraudster." Even at red, the message is "additional review required." Every red decision includes an appeal path. This matters legally and operationally.

---

## The VPN Problem — Solved

A fraud ring member switches VPNs between every submission. Their IP address changes every time.

**What the pipeline sees:**
- IP address → different every time → graph scorer edge via IP subnet weakened
- Device fingerprint → identical every time → GPU, fonts, audio hardware do not change when VPN switches
- Behavioral pattern → consistent typing rhythm across all submissions

If they use ten accounts across ten VPN IPs but one physical laptop, the device scorer fires at score 90 and the graph scorer builds a cluster around that fingerprint. Two independent scorers corroborate → orange or red outcome.

**The only real defense against this architecture** is using ten separate physical devices, ten separate networks, and deliberately training different behavioral patterns on each. That is expensive, operationally difficult, and introduces coordination overhead that makes the ring's timing cluster more visible, not less.

---

## Stage-by-Stage Request Lifecycle

### Stage 1 — Page Load (t=0ms)
- FingerprintJS bundle loads silently
- Canvas, WebGL, audio, font signals collected
- Behavioral listeners attach to form fields
- No network requests yet

### Stage 2 — Form Submission (t=user action)
- Form payload + fingerprint hash + behavioral blob bundled into single POST
- Fingerprint sent as `X-Device-ID` header
- Behavioral stream compressed and sent in request body

### Stage 3 — API Ingestion (t+5ms)
- FastAPI receives request
- PostgreSQL fingerprint lookup runs
- Behavioral delta computed against stored profile
- Feature store written (Redis for speed, Postgres for persistence)
- Three scorer tasks spawned concurrently

### Stage 4 — Scoring (t+5ms to t+85ms)
- Device scorer: PostgreSQL query → 10ms
- Behavior scorer: Z-score computation → 20ms
- Graph scorer: Community detection on in-memory graph → 80ms
- All three results ready at ~85ms (slowest wins)

### Stage 5 — Fusion (t+85ms)
- Weighted sum computed
- Corroboration rule checked
- Decay applied to stale signals
- Final score and tier determined

### Stage 6 — Response Assembly (t+90ms)
- Decision written to audit log with all scorer outputs and explanations
- Response payload assembled for the appropriate tier
- HTTP response returned

### Stage 7 — Customer UX (~t+120ms total)
- Green: HTTP 200, refund webhook fires
- Amber: HTTP 200, photo upload step rendered
- Orange: HTTP 202, review email queued
- Red: HTTP 200 (never 403), escalation link rendered

### Stage 8 — Learning Loop (async)
- Human review decisions in orange queue become labelled training examples
- Confirmed fraud: all accounts linked to that device hash receive +30 risk flag
- False positive: behavioral profile baseline recomputed with the session included
- Weekly Celery task reruns scorer weight optimisation on last 30 days of labelled decisions

---

## Tech Stack Summary

| Component | Technology |
|-----------|-----------|
| Client fingerprinting | FingerprintJS v3 + custom canvas/audio scripts |
| Behavioral collection | Vanilla JS passive event listeners |
| API layer | FastAPI (Python) |
| Concurrent scoring | `asyncio.gather` |
| Fingerprint store | PostgreSQL |
| Feature/session store | Redis + PostgreSQL |
| Graph scoring | NetworkX + Louvain community detection |
| Async workers | Celery |
| Audit log | PostgreSQL |

---

## Key Design Principles

**1. Invisible to legitimate customers.** 70% of users never encounter any friction. The system exists to be invisible.

**2. Corroboration over individual signals.** No single signal, regardless of its score, can produce a hard block. The false-positive rate is structurally bounded by requiring multiple independent sources to agree.

**3. Proportional friction.** Amber friction (a photo) is natural and explainable. It does not accuse the customer — it asks for something a legitimate customer already has.

**4. Human judgment for hard cases.** Orange routes to a human reviewer. Algorithms make probabilistic statements; humans make decisions with consequences.

**5. Always an appeal path.** Even at red, the customer has a direct escalation route. No decision is permanent without human review.

**6. Decay over time.** Old signals carry less weight. The system does not penalise customers indefinitely for a past association with a risky device or network.
