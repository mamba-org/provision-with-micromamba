# provision-with-micromamba
[![test](https://github.com/mamba-org/provision-with-micromamba/workflows/test/badge.svg)](https://github.com/mamba-org/provision-with-micromamba/actions?query=workflow%3Atest)

GitHub Action to provision a CI instance using micromamba

## Inputs

### `environment-file`

**Required** The the `environment.yml` file for the conda environment. Default is `environment.yml`

## Example usage

```
name: test
on:
  push: null

jobs:
  test:
    runs-on: ubuntu-latest
    name: test
    steps:
      - uses: actions/checkout@v2

      - name: install mamba
        uses: mamba-org/provision-with-micromamba@main

      - name: run python
        shell: bash -l {0}
        run: |
          python -c "import numpy"
```

## Development

When developing, you need to

1. install `nodejs`
2. clone the repo
3. run `npm install -y`
4. run `npm run build` after making changes
