# Agent Guidelines — Slackr Collaborative Development

This file provides context, rules, and guidelines for AI agents (e.g., Antigravity, Cursor, Windsurf) collaborating on the **Slackr** codebase.

---

## 🎯 Codebase Context & Technical Stack

- **Frontend SPA**: Pure Vanilla JS (ES6+), HTML5, and CSS3.
  - **NO Frameworks**: Never introduce React, Vue, Angular, Svelte, or Next.js.
  - **NO Component Libraries**: Do not install UI frameworks. Use native CSS variables (HSL color scheme) inside [provided.css](file:///Users/keyvanzhuo/Documents/CodeProjects/slackr/frontend/styles/provided.css) for custom designs and animations.
  - **State**: Managed locally via window history, `LocalStorage`, and native custom elements.
- **Backend Service**: Node.js, Express, and JSON storage.
  - **Database**: Single-threaded read/write mappings stored in [database.json](file:///Users/keyvanzhuo/Documents/CodeProjects/slackr/backend/database.json). Always use local synchronization locks.
  - **Authentication**: JWT validation using a `Bearer` token inside the `Authorization` header.

---

## 🛠 Project Execution Commands

For development, testing, and formatting, always run commands inside their respective directory contexts:

| Action | Command | Directory |
| :--- | :--- | :--- |
| **Start Backend Server** | `npm start` | `backend/` |
| **Serve Frontend SPA** | `npx serve frontend -l 8000` | Project Root |
| **Run Integration Tests** | `npm test` | `backend/` |
| **Code Linting** | `npm run lint` | `backend/` |

---

## ⚠️ Core Behavior Constraints for AI Agents

### 1. Maintain Localization Purity
- **Chinese-First UI**: All user-facing alerts, placeholders, error notifications, and text content must be written in Chinese.
- **Date Formatting**: Ensure Sydney-timezone dates are formatted using `date.toLocaleString('zh-CN', options)`.

### 2. No School Assignment Terminology
- **Code & Comments Cleanliness**: Never include terms like `Milestone`, `Assignment`, `UNSW`, `COMP6080`, `Bonus Marks`, or decimal numbers representing homework steps (e.g., `2.1.1`).
- **Dev-first Documentation**: Structure code documentation around logical features (e.g., `User Profiles`, `Offline Cache Sync`, `Message Reactions`) rather than assignment milestones.

### 3. Database Modification & Seeding
- **Restart Server after Seeding**: The Express server caches the JSON database state in memory. If you modify `backend/database.json` directly (e.g., to seed mock data/messages), you **MUST** stop the server task, modify the file, and then run `npm start` to reboot.
- **Prevent Multi-Git Contamination**: Never let `backend/` contain a nested `.git` sub-repository. If discovered, run `rm -rf backend/.git` immediately to prevent Git from treating the directory as a broken submodule.

### 4. Integrity and Clean Edits
- **Maintain JSDoc comment blocks**: Preserve structural documentation unless explicit modifications are requested.
- **CORS handling**: Ensure frontend requests target the correct `API_BASE_URL` defined inside [config.js](file:///Users/keyvanzhuo/Documents/CodeProjects/slackr/frontend/src/config.js).
