const fs = require('fs')
const os = require('os')
const path = require('path')

const cache = require('@actions/cache')
const core = require('@actions/core')
const io = require('@actions/io')

const { setupProfile } = require('./util')

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

function useDeinit (inputs) {
  // debug output values
  core.debug(`inputs.postDeinit: ${inputs.postDeinit}`)
  core.debug(`inputs.micromambaVersion: ${inputs.micromambaVersion}`)
  // since 'latest' >= '0.25.0', this works for all expected values
  return (inputs.postDeinit === 'auto' && inputs.micromambaVersion >= '0.25.0') || inputs.postDeinit === 'true'
}

async function main () {
  const inputs = JSON.parse(core.getState('inputs'))

  if (useDeinit(inputs)) {
    core.startGroup('Deinitializing micromamba ...')
    await setupProfile('deinit', process.platform, null, inputs.logLevel)
    core.endGroup()
  }
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
