# sec_logistics – Adaptive Return Fraud Intelligence System

## 📌 Overview

Return fraud costs online retailers over $100B annually. Unlike payment fraud, it exploits trust-based systems like lenient return policies.

This project builds a **multi-signal fraud detection and decision system** that minimizes fraud losses **without degrading legitimate customer experience**.

---

## 🎯 Core Objective

> Minimize fraud loss while maintaining customer trust through adaptive friction and intelligent decisioning.

---

## ⚖️ Key Design Principle

- Do NOT block aggressively
- Do NOT rely on a single signal
- Apply **graduated responses**:
  - Approve
  - Add friction
  - Reject / Escalate

---

## 🏗️ System Architecture

### Backend
- FastAPI (Python)
- Async processing

### Frontend
- React + Vite + Tailwind

### Databases
- SQLite → core system
- Supabase → receipt verification & shared fraud intel

### Core Engines
- Signal Extractors
- Rule Engine
- Fusion Engine
- Decision Engine

---

## 🔄 End-to-End Flow

### 1. User Authentication
- OTP-based login
- Device fingerprint tracking

### 2. Purchase Flow
- Product selection
- Order placement

### 3. Delivery Confirmation
- GPS verification
- OTP confirmation

### 4. Return Request
User submits:
- Reason (damage / INR / other)
- Images (camera capture only)
- Receipt (optional)

---

## ⚙️ Signal Extraction Layer

### Behavioral Signals
- Return frequency
- Category patterns
- Timing of return

### Image Signals
- EXIF metadata (device, timestamp, GPS)
- ELA (image tampering detection)

### Logistics Signals
- Delivery confirmation
- OTP verification
- Geo risk (pincode fraud rate)

### Receipt Signals
- Hash comparison (Supabase)
- Duplicate receipt detection

### Network Signals
- Shared device
- Shared address
- Linked accounts

---

## 🧠 Fusion Engine

Combines all signals into:
- Fraud Score (0–1)
- Confidence Level
- Fraud Type Classification

---

## 🎯 Decision Engine

| Score Range | Action |
|------------|--------|
| 0.0 – 0.3  | ✅ Approve |
| 0.3 – 0.7  | ⚠️ Add Friction |
| 0.7 – 1.0  | ❌ Reject / Escalate |

---

## 👤 User Trust Score System

Each user has a dynamic trust score:

- Range: 0 – 100
- Updated based on:
  - Claim history
  - Fraud signals
  - Successful transactions

Used to:
- Adjust friction level
- Influence decisions

---

## 🏪 Seller Module

### Features
- Product management
- Return monitoring
- Fraud insights dashboard

### Seller Actions
- Approve return
- Reject claim
- Escalate for review

---

## 🗄️ Database Schema

### Users
- customers(id, name, trust_score)
- devices(id, customer_id, fingerprint)

### Sellers
- sellers(id, name)
- products(id, seller_id, category, risk_level)

### Orders
- orders(id, customer_id, product_id)
- deliveries(order_id, gps, otp_verified)

### Claims
- claims(id, order_id, reason)
- signals(claim_id, type, value)
- decisions(claim_id, score, action)

### Fraud Intelligence
- network_links(entity_a, entity_b)
- receipt_hashes(hash, user_ids) [Supabase]

---

# 🚨 Fraud Modules + Test Cases

---

## 👗 1. Wardrobing Detection

### Logic
- High-value fashion item
- Returned quickly after delivery
- Repeated behavior

### Expected Action
- Apply restocking fee
- Do NOT reject

### Test Cases

| Case | Input | Expected |
|------|------|----------|
| W1 | Dress returned after 2 days | Flag medium risk |
| W2 | 5 similar returns in 30 days | Increase risk |
| W3 | First-time return | Approve |

---

## 📦 2. INR (Item Not Received)

### Logic
- Delivery confirmed + claim
- Repeat INR behavior

### Expected Action
- Add friction → OTP / proof

### Test Cases

| Case | Input | Expected |
|------|------|----------|
| I1 | No delivery proof | Approve |
| I2 | GPS + OTP confirmed | Flag |
| I3 | 3 INR claims in 2 weeks | High risk |

---

## 📸 3. Fake Damage Claims

### Logic
- EXIF mismatch
- ELA anomaly
- reused images

### Expected Action
- Add friction or reject

### Test Cases

| Case | Input | Expected |
|------|------|----------|
| D1 | Missing EXIF | Medium risk |
| D2 | Edited image (ELA high) | High risk |
| D3 | Valid fresh image | Approve |

---

## 🧾 4. Receipt Fraud

### Logic
- Hash mismatch
- Duplicate receipt usage

### Expected Action
- Reject

### Test Cases

| Case | Input | Expected |
|------|------|----------|
| R1 | Valid receipt | Approve |
| R2 | Hash mismatch | Reject |
| R3 | Same receipt used by 2 users | Flag ring |

---

## 💳 5. Friendly Fraud

### Logic
- Chargeback history
- Payment risk

### Expected Action
- Restrict payment options

### Test Cases

| Case | Input | Expected |
|------|------|----------|
| F1 | First chargeback | Warning |
| F2 | Multiple chargebacks | High risk |
| F3 | Clean history | Approve |

---

## 🧑‍🤝‍🧑 6. Fraud Ring Detection

### Logic
- Shared:
  - devices
  - addresses
  - receipts

### Expected Action
- Escalate / block

### Test Cases

| Case | Input | Expected |
|------|------|----------|
| G1 | Same device across 5 users | Flag |
| G2 | Shared receipt hash | Link accounts |
| G3 | No connections | Safe |

---

# 📊 Admin Dashboard

### Features
- Fraud trends
- High-risk users
- Fraud type distribution
- Manual review tools

---

# 🔁 Feedback Loop

- Store all decisions
- Update trust scores
- Improve detection over time

---

# 🚀 Deployment

- Backend → Render / AWS
- Frontend → Vercel
- Supabase → hosted

---

# 🧠 Final Insight

This system does NOT aim to eliminate fraud.

It aims to:
> **Manage fraud economically while preserving customer trust.**

# sec_logistics – Adaptive Return Fraud Intelligence System

---

## 🔐 Authentication Architecture (Separated Roles)

We implement **role-based authentication** using Supabase Auth.

### Roles:
- USER → Customers placing orders
- SELLER → Product owners / merchants
- ADMIN → Internal monitoring

---

## 🧩 Auth Flow (Supabase)

### Setup

```bash
supabase init
supabase link --project-ref vfwckmpkroicgkcogxrg

---
