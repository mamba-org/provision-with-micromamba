# provision-with-micromamba Action

GitHub Action to provision a CI instance using micromamba


# Hello world javascript action

This action prints "Hello World" or "Hello" + the name of a person to greet to the log.

## Inputs

### `environment-file`

**Required** The path to the `environment.yml` file for the conda env.

## Example usage

```
uses: beckermr/provision-with-micromamba@v1
with:
  environment-file: environment.yml
```
