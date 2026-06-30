# Sankey Build and Deploy Runbook

## Current Setup (Detected)
- Repo type: static site (HTML/CSS/JS assets), no build tooling detected.
- Git: enabled.
- Branch: `main` tracking `origin/main`.
- Remote: `https://github.com/opuscule/sankey.git`.

## Local Preview

```bash
python3 -m http.server 5050
```

Open `http://localhost:5050`.

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