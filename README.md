# provision-with-micromamba

[![test](https://github.com/mamba-org/provision-with-micromamba/workflows/test/badge.svg)](https://github.com/mamba-org/provision-with-micromamba/actions?query=workflow%3Atest)

GitHub Action to provision a CI instance using micromamba

## Inputs

### `environment-file`

**Optional** The the `environment.yml` file for the conda environment. Default is `environment.yml`.
If it is `false`, no environment will be created (only Micromamba will be installed).

### `environment-name`

**Optional** Specify a custom environment name.  If set it overwrites the name specified in the `environment-file`.
Required if `environment-file` is a `.lock` file or `false`.

### `micromamba-version`

**Optional** Specifiy a custom micromamba version. Use `"latest"` for bleeding edge.

### `extra-specs`

**Optional** Specifiy additional specifications (packages) to install. Pretty useful when using matrix builds to pin versions of a test/run dependency.

Note: for multiple packages, use multiline syntax (see examples below)

## Example usage

Note: some shells need special syntax for invocation (e.g. `bash -l {0}`). You can set this up in [defaults](setup_default).

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
      - name: run cmd.exe
        shell: cmd /C CALL {0}
        run: >-
          micromamba info && micromamba list
```

## Example with customization

```
name: test
on:
  push: null

jobs:
  test:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        pytest: ["6.1", "6.2"]
    name: test
    steps:
      - uses: actions/checkout@v2

      - name: install mamba
        uses: mamba-org/provision-with-micromamba@main
        with:
          environment-file: myenv.yaml
          environment-name: myenv
          extra-specs: |
            python=3.7
            pytest=${{ matrix.pytest }}
```

## IMPORTANT

Some shells require special syntax (e.g. `bash -l {0}`). You can set this up with the `default` option:

```
jobs:
  myjob:
    defaults:
      run:
        shell: bash -l {0}
...
```

Find the reasons below (taken from [setup-miniconda](https://github.com/conda-incubator/setup-miniconda/blob/master/README.md#important)):

- Bash shells do not use `~/.profile` or `~/.bashrc` so these shells need to be
  explicitely declared as `shell: bash -l {0}` on steps that need to be properly
  activated (or use a default shell). This is because bash shells are executed
  with `bash --noprofile --norc -eo pipefail {0}` thus ignoring updated on bash
  profile files made by `conda init bash`. See
  [Github Actions Documentation](https://help.github.com/en/actions/automating-your-workflow-with-github-actions/workflow-syntax-for-github-actions#using-a-specific-shell)
  and
  [thread](https://github.community/t5/GitHub-Actions/How-to-share-shell-profile-between-steps-or-how-to-use-nvm-rvm/td-p/33185).
- Sh shells do not use `~/.profile` or `~/.bashrc` so these shells need to be
  explicitely declared as `shell: sh -l {0}` on steps that need to be properly
  activated (or use a default shell). This is because sh shells are executed
  with `sh -e {0}` thus ignoring updated on bash profile files made by
  `conda init bash`. See
  [Github Actions Documentation](https://help.github.com/en/actions/automating-your-workflow-with-github-actions/workflow-syntax-for-github-actions#using-a-specific-shell).
- Cmd shells do not run `Autorun` commands so these shells need to be
  explicitely declared as `shell: cmd /C call {0}` on steps that need to be
  properly activated (or use a default shell). This is because cmd shells are
  executed with `%ComSpec% /D /E:ON /V:OFF /S /C "CALL "{0}""` and the `/D` flag
  disabled execution of `Command Processor/Autorun` Windows registry keys, which
  is what `conda init cmd.exe` sets. See
  [Github Actions Documentation](https://help.github.com/en/actions/automating-your-workflow-with-github-actions/workflow-syntax-for-github-actions#using-a-specific-shell).
- For caching to work properly, you will need to set the `use-only-tar-bz2`
  option to `true`.
- Some options (e.g. `use-only-tar-bz2`) are not available on the default conda
  installed on Windows VMs, be sure to use `auto-update-conda` or provide a
  version of conda compatible with the option.
- If you plan to use a `environment.yaml` file to set up the environment, the
  action will read the `channels`listed in the key (if found). If you provide
  the `channels` input in the action they must not conflict with what was
  defined in `environment.yaml`, otherwise the conda solver might find conflicts
  and result in very long install times.
- Conda activation does not correctly work on `sh`. Please use `bash`.

## Development

When developing, you need to

1. install `nodejs`
2. clone the repo
3. run `npm install -y`
4. run `npm run build` after making changes
