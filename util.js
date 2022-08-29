const fs = require('fs')
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

async function withMkdtemp (callback) {
  const tmpdir = fs.mkdtempSync(path.join(os.tmpdir(), 'micromamba-'))
  let res
  try {
    res = await callback(tmpdir)
  } catch (e) {
    io.rmRF(tmpdir)
    throw e
  }
  io.rmRF(tmpdir)
  return res
}

async function executeSubproc (...args) {
  core.debug(`Running shell command ${JSON.stringify(args)}`)
  try {
    return await exec.getExecOutput(...args)
  } catch (error) {
    throw Error(`Failed to execute ${JSON.stringify(args)}: ${error}`)
  }
}

async function executeMicromambaShell (command, shell, logLevel) {
  const cmd = micromambaCmd(`shell ${command} -s ${shell} -p ${PATHS.micromambaRoot} -y`, logLevel, PATHS.micromambaExe)
  const cmd2 = cmd.split(' ')
  return await executeSubproc(cmd2[0], cmd2.slice(1))
}

function micromambaCmd (command, logLevel, micromambaExe = 'micromamba') {
  return `${micromambaExe} ${command}` + (logLevel ? ` --log-level ${logLevel}` : '')
}

async function setupProfile (command, os, logLevel) {
  switch (os) {
    case 'darwin': 
      await executeMicromambaShell(command, 'bash', logLevel)
      // TODO need to fix a check in micromamba so that this works
      // https://github.com/mamba-org/mamba/issues/925
      // await executeMicromambaShell(command, 'zsh', logLevel)
      break;
    case 'linux':
      await executeMicromambaShell(command, 'zsh', logLevel)
      // On Linux, Micromamba modifies .bashrc but we want the modifications to be in .bash_profile.
      if (command === 'init') {
        await withMkdtemp(async tmpdir => {
          const oldHome = process.env.HOME
          process.env.HOME = tmpdir
          await executeMicromambaShell(command, 'bash', logLevel)
          process.env.HOME = oldHome
          fs.appendFileSync(PATHS.bashprofile, '\n' + fs.readFileSync(path.join(tmpdir, '.bashrc')))
        })
      } else {
        // we still need to deinit for the regular .bashrc since `micromamba shell init` also changes other files, not only .bashrc
        await executeMicromambaShell(command, 'bash', logLevel)
        // remove mamba initialize block from .bash_profile
        const regexBlock = "\n# >>> mamba initialize >>>(?:\n|\r\n)?([\\s\\S]*?)# <<< mamba initialize <<<(?:\n|\r\n)?"
        const bashProfile = fs.readFileSync(PATHS.bashprofile, 'utf8')
        const newBashProfile = bashProfile.replace(new RegExp(regexBlock, 'g'), '')
        fs.writeFileSync(PATHS.bashprofile, newBashProfile)
      }
      break;
    case 'win32':
      if (await haveBash()) {
        await executeMicromambaShell(command, 'bash', logLevel)
      }
      // https://github.com/mamba-org/mamba/issues/1756
      await executeMicromambaShell(command, 'cmd.exe', logLevel)
      await executeMicromambaShell(command, 'powershell', logLevel)
      break;
  }
}

async function haveBash () {
  return !!(await io.which('bash'))
}

module.exports = {
  PATHS, withMkdtemp, executeSubproc, executeMicromambaShell, micromambaCmd, setupProfile, haveBash
}
