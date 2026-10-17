# GitHub Actions workflow (not yet active)

`workflows/test.yml` (tests on push and pull request, with the CLI files built from
IndianOpinion/cli) is ready but sits here because the initial push was made with a credential that
may not create workflow files. A maintainer activates it with:

```sh
git mv ci/workflows .github/workflows && git rm ci/README.md
git commit -m "Activate the test workflow" && git push
```
