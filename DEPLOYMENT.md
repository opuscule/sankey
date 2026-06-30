# Sankey Build and Deploy Runbook

## Current Setup (Detected)
- Repo type: static site (HTML/CSS/JS assets), no build tooling detected.
- Git: enabled.
- Branch: `main` tracking `origin/main`.
- Remote: `https://github.com/opuscule/sankey.git`.
- Netlify config file: not present (`netlify.toml` not found).

## What "Build" Means Here
- There is no compile step right now.
- Deployable output is the repository root as-is.
- Primary files served: `index.html`, `styles.css`, `main.js`, data/assets (CSV, images, fonts).

## Local Preview
1. Open a terminal in the project root.
2. Run:

```bash
python3 -m http.server 8000
```

3. Open `http://localhost:8000`.
4. Stop with `Ctrl+C`.

## Git Workflow (Recommended)
1. Check changes:

```bash
git status
```

2. Stage files:

```bash
git add .
```

3. Commit:

```bash
git commit -m "Describe change"
```

4. Push:

```bash
git push origin main
```

## Netlify Deployment Paths

### Option A: Netlify Connected to GitHub (recommended)
1. In Netlify, create/import site from GitHub repo `opuscule/sankey`.
2. Use these settings:
- Build command: leave empty.
- Publish directory: `.` (repo root).
3. Every `git push origin main` triggers a new deploy.

### Option B: Manual Deploy
1. In Netlify dashboard, use drag-and-drop deploy.
2. Upload project root files/folders (including assets).

## Confirming Your Existing Netlify Setup
Use this quick checklist in Netlify UI:
- Site exists and is linked to GitHub repo `opuscule/sankey`.
- Production branch is `main`.
- Build command is empty.
- Publish directory is `.`.

If all four are true, then yes: your site is hosted on Netlify with git-based auto deploys.

## Project Deployment Record
- Netlify site name: 
- Netlify site URL:
- Custom domain:
- Team/account:
- Deploy type: Git-connected / Manual
- Production branch:
- Last verified date:
- Notes:
