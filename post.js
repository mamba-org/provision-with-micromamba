const cache = require('@actions/cache')
const core = require('@actions/core')
const io = require('@actions/io')

const fs = require('fs')
const os = require('os')
const path = require('path')

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

async function main () {
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
  }
}

run()

export default run
