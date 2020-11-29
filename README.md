# provision-with-micromamba Action

GitHub Action to provision a CI instance using micromamba


# Hello world javascript action

This action prints "Hello World" or "Hello" + the name of a person to greet to the log.

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
        uses: beckermr/provision-with-micromamba@main

      - name: run python
        shell: bash -l {0}
        run: |
          python -c "import numpy"
```
