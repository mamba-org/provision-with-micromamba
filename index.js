const fs = require('fs')
const os = require('os')
const path = require('path')
const process = require('process')
const crypto = require('crypto')

const yaml = require('js-yaml')

const cache = require('@actions/cache')
const core = require('@actions/core')
const exec = require('@actions/exec')
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

// --- OS utils ---

function getInputAsArray (name) {
  // From https://github.com/actions/cache/blob/main/src/utils/actionUtils.ts
  return core
    .getInput(name)
    .split('\n')
    .map(s => s.trim())
    .filter(x => x !== '')
}

async function executeSubproc (...args) {
  core.debug(`Running shell command ${JSON.stringify(args)}`)
  try {
    return await exec.getExecOutput(...args)
  } catch (error) {
    throw Error(`Failed to execute ${JSON.stringify(args)}: ${error}`)
  }
}

async function executeBashFlags (flags, command) {
  return await executeSubproc('bash', ['-eo', 'pipefail', ...flags, '-c', command])
}

async function executeBash (...args) {
  return await executeBashFlags([], ...args)
}

async function executeBashLogin (...args) {
  return await executeBashFlags(['-l'], ...args)
}

async function executePwsh (command) {
  // PowerShell seems to not always fail when the command fails.
  const sentinel = `provision-with-micromamba-${Math.random().toString().slice(2)}`
  command = `${command}; echo ${sentinel}`
  const result = await executeSubproc('powershell', ['-command', command])
  if (!result.stdout.includes(sentinel)) {
    throw Error(`Failed to execute ${JSON.stringify(command)} in powershell`)
  }
  result.stdout = result.stdout.replaceAll(sentinel, '')
  return result
}

const executeLoginShell = process.platform === 'win32' ? executePwsh : executeBashLogin

function sha256 (s) {
  const h = crypto.createHash('sha256')
  h.update(s)
  return h.digest().hexSlice()
}

function sha256Short (s) {
  return sha256(s).substr(0, 8)
}

function rmRf (dir) {
  try {
    fs.rmSync(dir, { recursive: true })
  } catch (e) {
    core.warning(`Error removing directory ${dir}: ${e}`)
  }
}

async function withMkdtemp (callback) {
  const tmpdir = fs.mkdtempSync(path.join(os.tmpdir(), 'micromamba-'))
  let res
  try {
    res = await callback(tmpdir)
  } catch (e) {
    rmRf(tmpdir)
    throw e
  }
  rmRf(tmpdir)
  return res
}

function today () {
  return new Date().toDateString()
}

async function cygpath (s) {
  return (await executeSubproc('cygpath', [s])).stdout.trim()
}

async function sleep (ms) {
  await new Promise(resolve => setTimeout(resolve, ms))
}

async function retry (callback, backoffTimes = [2000, 5000, 10000]) {
  for (const backoff of backoffTimes.concat(null)) {
    if (backoff) {
      try {
        return await callback()
      } catch (error) {
        core.warning(`${callback} failed, retrying in ${backoff} seconds: ${error}`)
        await sleep(backoff)
      }
    } else {
      return await callback()
    }
  }
}

async function haveBash () {
  return !!(await io.which('bash'))
}

function dumpFileContents (path) {
  core.info(`--- Contents of ${path} ---\n${fs.readFileSync(path)}\n--- End contents of ${path} ---`)
}

async function tryRestoreCache (path, key, ...args) {
  try {
    const hitKey = await cache.restoreCache([path], key, ...args)
    core.info(`Cache ${hitKey ? 'hit' : 'miss'} for key '${key}'`)
    return hitKey
  } catch (error) {
    core.warning(error.message)
  }
}

function saveCacheOnPost (paths, key, options) {
  core.info(`Will save to cache with key ${key}`)
  const old = JSON.parse(core.getState('postCacheArgs') || '[]')
  core.saveState('postCacheArgs', JSON.stringify([...old, [paths, key, options]]))
}

// --- Mamba utils ---

function getCondaArch () {
  const arch = {
    [['darwin', 'arm64']]: 'osx-arm64',
    [['darwin', 'x64']]: 'osx-64',
    [['linux', 'x64']]: 'linux-64',
    [['linux', 'arm64']]: 'linux-aarch64',
    [['win32', 'x64']]: 'win-64'
  }[[process.platform, process.arch]]
  if (!arch) {
    throw Error(`Platform ${process.platform}/${process.arch} not supported.`)
  }
  return arch
}

function micromambaCmd (command, logLevel, micromambaExe = 'micromamba') {
  return `${micromambaExe} ${command}` + (logLevel ? ` --log-level ${logLevel}` : '')
}

async function executeMicromambaShellInit (shell, logLevel) {
  const cmd = micromambaCmd(`shell init -s ${shell} -p ${PATHS.micromambaRoot} -y`, logLevel, PATHS.micromambaExe)
  const cmd2 = cmd.split(' ')
  return await executeSubproc(cmd2[0], cmd2.slice(1))
}

// --- Micromamba download + installation ---

const setupProfile = {
  darwin: async logLevel => {
    await executeMicromambaShellInit('bash', logLevel)
    // TODO need to fix a check in micromamba so that this works
    // https://github.com/mamba-org/mamba/issues/925
    // await executeMicromambaShellInit('zsh', logLevel)
  },
  linux: async logLevel => {
    await executeMicromambaShellInit('zsh', logLevel)
    // On Linux, Micromamba modifies .bashrc but we want the modifications to be in .bash_profile.
    await withMkdtemp(async tmpdir => {
      const oldHome = process.env.HOME
      process.env.HOME = tmpdir
      await executeMicromambaShellInit('bash', logLevel)
      process.env.HOME = oldHome
      fs.appendFileSync(PATHS.bashprofile, '\n' + fs.readFileSync(path.join(tmpdir, '.bashrc')))
    })
  },
  win32: async logLevel => {
    if (await haveBash()) {
      await executeMicromambaShellInit('bash', logLevel)
    }
    // https://github.com/mamba-org/mamba/issues/1756
    await executeMicromambaShellInit('cmd.exe', logLevel)
    await executeMicromambaShellInit('powershell', logLevel)
  }
}

async function downloadMicromamba (micromambaUrl) {
  fs.mkdirSync(PATHS.micromambaBinFolder)
  const curlOpts = `${micromambaUrl} -Ls --retry 5 --retry-delay 1`
  if (process.platform === 'win32') {
    // PowerShell does not support piping binary data. Use a temporary file instead.
    await withMkdtemp(async tmpdir => {
      const tarBz2Path = path.join(tmpdir, 'micromamba.tar.bz2')
      const tarPath = tarBz2Path.slice(0, -4)
      await retry(() => executeSubproc('curl', [...curlOpts.split(' '), '-o', tarBz2Path]))
      const useWindowsTar = (await io.which('tar', true)).includes('\\system32\\')
      if (useWindowsTar) {
        // Bzip2 support in Windows' tar is broken
        await executeSubproc('bunzip2', [tarBz2Path])
      }
      await executeSubproc('tar', [
        '-xjf', useWindowsTar ? tarPath : await cygpath(tarBz2Path),
        '-C', useWindowsTar ? PATHS.micromambaBinFolder : await cygpath(PATHS.micromambaBinFolder),
        '--strip-components=2', 'Library/bin/micromamba.exe'
      ])
    })
  } else {
    const tarOpts = '-xj -O bin/micromamba'
    await retry(() => executeBash(`curl ${curlOpts} | tar ${tarOpts} > ${PATHS.micromambaExe}`))
    fs.chmodSync(PATHS.micromambaExe, 0o755)
  }
}

function makeCondarcOpts (inputs, extraChannels) {
  let condarcOpts = {
    always_yes: true,
    show_channel_urls: true,
    channel_priority: inputs.channelPriority
  }
  if (inputs.channelAlias) {
    condarcOpts.channel_alias = inputs.channelAlias
  }
  let channels = []
  if (inputs.channels)
    channels = inputs.channels.split(',').map(s => s.trim());
  if (extraChannels)
    channels.push.apply(channels, extraChannels);
  if (channels)
    condarcOpts.channels = channels

  const moreOpts = yaml.safeLoad(inputs.condaRcOptions)
  if (moreOpts) {
    condarcOpts = { ...condarcOpts, ...moreOpts }
  }
  return condarcOpts
}

async function installMicromamba (inputs) {
  // Install micromamba
  if (!fs.existsSync(PATHS.micromambaBinFolder)) {
    core.startGroup('Install micromamba ...')
    const micromambaUrl = `${inputs.installerUrl}/${getCondaArch()}/${inputs.micromambaVersion}`
    const cacheKey = `micromamba-bin ${micromambaUrl} ${today()} YYY`
    const cacheArgs = [PATHS.micromambaBinFolder, cacheKey]
    if (!await tryRestoreCache(...cacheArgs)) {
      await downloadMicromamba(micromambaUrl)
      saveCacheOnPost(...cacheArgs)
    }
    await setupProfile[process.platform](inputs.logLevel)
    core.exportVariable('MAMBA_ROOT_PREFIX', PATHS.micromambaRoot)
    core.exportVariable('MAMBA_EXE', PATHS.micromambaExe)
    core.addPath(PATHS.micromambaBinFolder)
    core.endGroup()
  }
}

// --- Environment installation ---

function isSelected (item) {
  if (/sel\(.*\):.*/gi.test(item)) {
    const condaPlatform = getCondaArch().split('-')[0]
    return new RegExp(`sel\\(${condaPlatform}\\):.*`, 'gi').test(item)
  }
  return true
}

function stripSelector (item, index, arr) {
  arr[index] = item.replace(/sel\(.*\): ?/gi, '')
}

function selectSelectors (extraSpecs) {
  const ret = extraSpecs.filter(isSelected)
  ret.forEach(stripSelector)
  return ret
}

async function createOrUpdateEnv (envName, envFilePath, extraSpecs, logLevel) {
  const envFolder = path.join(PATHS.micromambaEnvs, envName)
  const action = fs.existsSync(envFolder) ? 'update' : 'create'
  const selectedExtraSpecs = selectSelectors(extraSpecs)
  core.info(`${action} env ${envName}`)
  let cmd = micromambaCmd(`${action} -n ${envName} --strict-channel-priority -y`, logLevel, PATHS.micromambaExe)
  if (selectedExtraSpecs.length) {
    cmd += ' ' + selectedExtraSpecs.map(e => `"${e}"`).join(' ')
  }
  if (envFilePath) {
    cmd += ' -f ' + envFilePath
  }
  await executeSubproc(cmd)
}

function determineEnvironmentName (inputs, envFilePath, envYaml) {
  if (envFilePath) {
    // Have environment.yml or .lock file
    if (envYaml) {
      if (inputs.envName) {
        return inputs.envName
      } else {
        if (envYaml?.name) {
          return envYaml?.name
        } else {
          throw Error("Must provide 'environment-name' if environment.yml doesn't provide a 'name' attribute")
        }
      }
    } else {
      // .lock file
      if (inputs.envName) {
        return inputs.envName
      } else {
        throw Error("Must provide 'environment-name' for .lock files")
      }
    }
  } else {
    // Have extra-specs only
    if (inputs.envName) {
      return inputs.envName
    } else {
      throw Error("Must provide 'environment-name' for 'environment-file: false'")
    }
  }
}

async function installEnvironment (inputs, envFilePath, envYaml) {
  if (!(envFilePath || inputs.extraSpecs.length)) {
    core.info("Skipping environment install because no 'environment-file' or 'extra-specs' are set")
    return
  }

  const envName = determineEnvironmentName(inputs, envFilePath, envYaml)
  const defaultCacheKey = `${getCondaArch()} ${today()}`

  core.startGroup(`Install environment ${envName} from ${envFilePath || ''} ${inputs.extraSpecs || ''}...`)
  let downloadCacheHit, downloadCacheArgs, envCacheHit, envCacheArgs

  // Try to load the entire env from cache.
  if (inputs.cacheEnv) {
    let key = inputs.cacheEnvKey || defaultCacheKey
    if (envFilePath) {
      key += ' file: ' + sha256Short(fs.readFileSync(envFilePath))
    }
    if (inputs.extraSpecs.length) {
      key += ' extra: ' + sha256Short(JSON.stringify(inputs.extraSpecs))
    }
    envCacheArgs = [path.join(PATHS.micromambaEnvs, envName), `micromamba-env ${key}`]
    envCacheHit = await tryRestoreCache(...envCacheArgs)
  }

  const shouldTryDownloadCache = !envCacheHit || inputs.cacheEnvAlwaysUpdate
  if (shouldTryDownloadCache) {
    // Try to restore the download cache.
    if (inputs.cacheDownloads) {
      const key = inputs.cacheDownloadsKey || defaultCacheKey
      downloadCacheArgs = [PATHS.micromambaPkgs, `micromamba-pkgs ${key}`]
      downloadCacheHit = await tryRestoreCache(...downloadCacheArgs)
    }
    await createOrUpdateEnv(envName, envFilePath, inputs.extraSpecs, inputs.logLevel)
  }

  // Add micromamba activate to profile
  const autoactivateCmd = `micromamba activate ${envName};`
  if (process.platform === 'win32') {
    const ps1File = (await executePwsh('echo $profile')).stdout.trim()
    core.warning(path.dirname(ps1File))
    fs.appendFileSync(ps1File, '\n' + autoactivateCmd)
    dumpFileContents(ps1File)
  }
  if (await haveBash()) {
    fs.appendFileSync(PATHS.bashprofile, '\nset -eo pipefail; ' + autoactivateCmd)
    dumpFileContents(PATHS.bashprofile)
  }

  // Sanity check
  const { stdout: micromambaInfoJson } = await executeLoginShell(micromambaCmd('info --json'))
  const autoactivatedEnvLocation = yaml.safeLoad(micromambaInfoJson)['env location']
  if (autoactivatedEnvLocation === '-') {
    throw Error('Error setting up environment')
  }

  // Save cache on workflow success
  if (shouldTryDownloadCache && inputs.cacheDownloads && !downloadCacheHit) {
    saveCacheOnPost(...downloadCacheArgs)
  }
  if (inputs.cacheEnv && !envCacheHit) {
    saveCacheOnPost(...envCacheArgs)
  }
  core.endGroup()
}

// --- Main ---

async function main () {
  const inputs = {
    // Basic options
    envFile: core.getInput('environment-file'),
    envName: core.getInput('environment-name'),
    micromambaVersion: core.getInput('micromamba-version'),
    extraSpecs: getInputAsArray('extra-specs'),
    channels: core.getInput('channels'),
    condaRcFile: core.getInput('condarc-file'),
    channelPriority: core.getInput('channel-priority'),

    // Caching options
    cacheDownloads: core.getBooleanInput('cache-downloads'),
    cacheDownloadsKey: core.getInput('cache-downloads-key'),
    cacheEnv: core.getBooleanInput('cache-env'),
    cacheEnvKey: core.getInput('cache-env-key'),
    // Not implemented
    // cacheEnvAlwaysUpdate: core.getBooleanInput('cache-env-always-update')
    cacheEnvAlwaysUpdate: false,

    // Advanced options
    logLevel: core.getInput('log-level'),
    condaRcOptions: core.getInput('condarc-options'),
    installerUrl: core.getInput('installer-url')
  }

  // Read environment file
  let envFilePath, envYaml
  if (inputs.envFile !== 'false') {
    envFilePath = path.join(process.env.GITHUB_WORKSPACE || '', inputs.envFile)
    if (!envFilePath.endsWith('.lock')) {
      envYaml = yaml.safeLoad(fs.readFileSync(envFilePath, 'utf8'))
    }
  }

  // Setup .condarc
  const condarcOpts = makeCondarcOpts(inputs, envYaml?.channels)
  if (inputs.condaRcFile) {
    fs.copyFileSync(inputs.condaRcFile, PATHS.condarc)
  }
  fs.appendFileSync(PATHS.condarc, yaml.safeDump(condarcOpts))
  core.debug(`Contents of ${PATHS.condarc}\n${fs.readFileSync(PATHS.condarc)}`)

  await installMicromamba(inputs)
  await installEnvironment(inputs, envFilePath, envYaml)

  // Show environment info
  core.startGroup('Environment info')
  await executeLoginShell(micromambaCmd('info', inputs.logLevel))
  await executeLoginShell(micromambaCmd('list', inputs.logLevel))
  core.endGroup()

  // This must always be last in main().
  core.saveState('mainRanSuccessfully', true)
}

async function run () {
  try {
    if (process.platform === 'win32') {
      // Work around bug in Mamba: https://github.com/mamba-org/mamba/issues/1779
      // This prevents using provision-with-micromamba without bash
      core.addPath(path.dirname(await io.which('cygpath', true)))
    }
    await main()
  } catch (error) {
    core.setFailed(error.message)
    throw error
  }
}

run()

export default run
