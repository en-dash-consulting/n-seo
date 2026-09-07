**What this changes and why**

**Checklist**
- [ ] `npm run check` passes (typecheck + TypeScript tests + Python tests)
- [ ] Python stays stdlib-only; TypeScript stays bundler-free
- [ ] New data files or config keys are documented in `docs/ARCHITECTURE.md`
- [ ] New module: example config + `MODULE_INFO` in `src/config.ts` + gating in `ops/daily.py` + Settings page
- [ ] No private hostnames, account names, or IDs (CI greps for them)
- [ ] `CHANGELOG.md` updated under *Unreleased*
