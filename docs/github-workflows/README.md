# GitHub Actions workflows (to install)

These two workflows are ready but live here because the bot's GitHub token
can't create files under `.github/workflows/` (it lacks the `workflow` scope).
The repo owner can install them with one move each:

```sh
mkdir -p .github/workflows
git mv docs/github-workflows/ci.yml docs/github-workflows/pages.yml .github/workflows/
git commit -m "Enable CI and Pages workflows" && git push
```

Then turn on Pages: Settings → Pages → Source: **GitHub Actions**.

* `ci.yml`: runs `npm test` and `npm run build` on every PR and push to main.
* `pages.yml`: deploys `dist/` to https://kshot3000.github.io/cardano-cert-stamp/ on every push to main.
