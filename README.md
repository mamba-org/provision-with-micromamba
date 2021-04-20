# provision-with-micromamba
[![test](https://github.com/mamba-org/provision-with-micromamba/workflows/test/badge.svg)](https://github.com/mamba-org/provision-with-micromamba/actions?query=workflow%3Atest)

GitHub Action to provision a CI instance using micromamba

## Inputs

### `environment-file`

**Optional** The the `environment.yml` file for the conda environment. Default is `environment.yml`

### `environment-name`

**Optional** Specify a custom environment name, 
to overwrite the name specified in the `environment.yml`, 
or in in case it was not specified in the `environment.yml`.

### `micromamba-version`

**Optional** Specifiy a custom micromamba version. Use `"latest"` for bleeding edge.

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

      # linux and osx
      - name: run python
        shell: bash -l {0}
        run: |
          python -c "import numpy"
      
      # windows
      - name: run python
        shell: powershell
        run: |
          python -c "import numpy"
```

## Example with customization

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
        with:
          - environment-file: myenv.yaml
          - environment-name: myenv
```

## Development

When developing, you need to

1. install `nodejs`
2. clone the repo
3. run `npm install -y`
4. run `npm run build` after making changes
