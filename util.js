const os = require('os')
const path = require('path')

const exec = require('@actions/exec')
const core = require('@actions/core')
const io = require('@actions/io')

const PATHS = {
  condarc: path.join(os.homedir(), '.condarc'),
  bashprofile: path.join(os.homedir(), '.bash_profile'),
  micromambaBinFolder: path.join(os.homedir(), 'micromamba-bin'),
  micromambaExe: path.join(os.homedir(), 'micromamba-bin', 'micromamba'),
  // Without the "-root" suffix it causes problems, why?
  // xref https://github.com/mamba-org/mamba/issues/1751
  micromambaRoot: path.join(os.homedir(), 'micromamba-root'),
  micromambaPkgs: path.join(os.homedir(), 'micromamba-root', 'pkgs'),
  micromambaEnvs: path.join(os.homedir(), 'micromamba-root', 'envs')
}

async function executeSubproc (...args) {
  core.debug(`Running shell command ${JSON.stringify(args)}`)
  try {
    return await exec.getExecOutput(...args)
  } catch (error) {
    throw Error(`Failed to execute ${JSON.stringify(args)}: ${error}`)
  }
}

function micromambaCmd (command, logLevel, micromambaExe = 'micromamba') {
  return `${micromambaExe} ${command}` + (logLevel ? ` --log-level ${logLevel}` : '')
}

async function haveBash () {
  return !!(await io.which('bash'))
}

module.exports = {
  PATHS, executeSubproc, micromambaCmd, haveBash
}
