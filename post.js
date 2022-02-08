const cache = require('@actions/cache')
const core = require('@actions/core')

async function main () {
  for (const [paths, key, options] of JSON.parse(core.getState('postCacheArgs') || '[]')) {
    try {
      await cache.saveCache(paths, key, options)
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
