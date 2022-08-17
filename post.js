const cache = require('@actions/cache')
const core = require('@actions/core')
const io = require('@actions/io')

const fs = require('fs')
const os = require('os')
const path = require('path')

const { PATHS, executeSubproc, micromambaCmd, haveBash } = require('./util')

// From https://github.com/conda-incubator/setup-miniconda (MIT license)
async function trimPkgsCacheFolder (cacheFolder) {
  const isDir = f => fs.existsSync(f) && fs.lstatSync(f).isDirectory()
  if (!isDir(cacheFolder)) {
    return
  }
  core.startGroup('Removing uncompressed packages to trim down cache folder...')
  for (const folderOrFile of fs.readdirSync(cacheFolder)) {
    if (folderOrFile === 'cache') {
      // Skip index cache
      continue
    }
    const fullPath = path.join(cacheFolder, folderOrFile)
    if (!isDir(fullPath)) {
      continue
    }
    core.info(`Removing "${fullPath}"`)
    try {
      await io.rmRF(fullPath)
    } catch (err) {
      // If file could not be deleted, move to a temp folder
      core.info(`Remove failed, moving "${fullPath}" to temp folder`)
      await io.mv(fullPath, path.join(os.tmpdir(), folderOrFile))
    }
  }
  core.endGroup()
}

async function executeMicromambaShellDeinit (shell, logLevel) {
  const cmd = micromambaCmd(`shell deinit -s ${shell} -p ${PATHS.micromambaRoot} -y`, logLevel, PATHS.micromambaExe)
  const cmd2 = cmd.split(' ')
  return await executeSubproc(cmd2[0], cmd2.slice(1))
}

const deinitProfile = {
  darwin: async logLevel => {
    await executeMicromambaShellDeinit('bash', logLevel)
    // TODO need to fix a check in micromamba so that this works
    // https://github.com/mamba-org/mamba/issues/925
    // await executeMicromambaShellDeinit('zsh', logLevel)
  },
  linux: async logLevel => {
    // On Linux, Micromamba modifies .bashrc but we want the modifications to be in .bash_profile.
    // The stuff in the .bash_profile is still there...
    await executeMicromambaShellDeinit('bash', logLevel)
    await executeMicromambaShellDeinit('zsh', logLevel)
  },
  win32: async logLevel => {
    if (await haveBash()) {
      await executeMicromambaShellDeinit('bash', logLevel)
    }
    // https://github.com/mamba-org/mamba/issues/1756
    await executeMicromambaShellDeinit('cmd.exe', logLevel)
    await executeMicromambaShellDeinit('powershell', logLevel)
  }
}

async function main () {
  core.startGroup(`Deinitializing micromamba ...`)
  await deinitProfile[process.platform](core.getInput('log-level'))
  core.endGroup()
  if (!core.getState('mainRanSuccessfully')) {
    core.notice('Conda environment setup failed. Cache will not be saved.')
    return
  }
  for (const [path, key, options] of JSON.parse(core.getState('postCacheArgs') || '[]')) {
    if (key.startsWith('micromamba-pkgs ')) {
      await trimPkgsCacheFolder(path)
    }
    try {
      await cache.saveCache([path], key, options)
      core.info(`Cache saved with key: ${key}`)
    } catch (error) {
      core.notice(error.message)
    }
  }
}

async function run () {
  try {
    main()
  } catch (error) {
    core.setFailed(error.message)
    throw error
  }
}

run()

export default run
