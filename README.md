# provision-with-micromamba

[![test](https://github.com/mamba-org/provision-with-micromamba/workflows/test/badge.svg)](https://github.com/mamba-org/provision-with-micromamba/actions?query=workflow%3Atest)

GitHub Action to provision a CI instance using micromamba.

## Example usage

```yaml
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2

      - name: Install Conda environment from environment.yml
        uses: mamba-org/provision-with-micromamba@main

      # Linux and macOS
      - name: Run Python
        shell: bash -l {0}
        run: |
          python -c "import numpy"

      # Windows
      # With Powershell:
      - name: Run Python
        shell: powershell
        run: |
          python -c "import numpy"
      # Or with cmd:
      - name: Run cmd.exe
        shell: cmd /C CALL {0}
        run: >-
          micromamba info && micromamba list
```

> **Please** see the **[IMPORTANT](#IMPORTANT)** notes on additional information
> on environment activation.

## Example with customization

```yaml
jobs:
  test:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        pytest: ["6.1", "6.2"]
    steps:
      - uses: actions/checkout@v2

      - name: Install Conda environment with Micromamba
        uses: mamba-org/provision-with-micromamba@main
        with:
          environment-file: myenv.yaml
          environment-name: myenvname
          extra-specs: |
            python=3.7
            pytest=${{ matrix.pytest }}
```

## Example with download caching

Use `cache-downloads` to enable download caching across action runs (`.tar.bz2` files).

By default the cache is invalidated once per day. See the `cache-downloads-key` option for custom cache invalidation.

```yaml
- name: Install Conda environment with Micromamba
  uses: mamba-org/provision-with-micromamba@main
  with:
    cache-downloads: true
```

## Example with environment caching

Use `cache-env` to cache the entire Conda environment (`envs/myenv` directory) across action runs.

By default the cache is invalidated whenever the contents of the `environment-file`
or `extra-specs` change, plus once per day. See the `cache-env-key` option for custom cache invalidation.

```yaml
- name: Install Conda environment with Micromamba
  uses: mamba-org/provision-with-micromamba@main
  with:
    cache-env: true
```

## More examples

More examples may be found in this repository's [tests](.github/workflows).

## Reference

See [action.yml](./action.yml).

## IMPORTANT

Some shells require special syntax (e.g. `bash -l {0}`). You can set this up with the `default` option:

```yaml
jobs:
  myjob:
    defaults:
      run:
        shell: bash -l {0}

# Or top-level:
defaults:
  run:
    shell: bash -l {0}
jobs:
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
- Cmd shells do not run `Autorun` commands so these shells need to be
  explicitely declared as `shell: cmd /C call {0}` on steps that need to be
  properly activated (or use a default shell). This is because cmd shells are
  executed with `%ComSpec% /D /E:ON /V:OFF /S /C "CALL "{0}""` and the `/D` flag
  disabled execution of `Command Processor/Autorun` Windows registry keys, which
  is what `conda init cmd.exe` sets. See
  [Github Actions Documentation](https://help.github.com/en/actions/automating-your-workflow-with-github-actions/workflow-syntax-for-github-actions#using-a-specific-shell).
- `sh` is not supported. Please use `bash`.

## Development

When developing, you need to

1. install `nodejs`
2. clone the repo
3. run `npm install -y`
4. run `npm run build` after making changes
