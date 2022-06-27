const fs = require('fs')
const os = require('os')
const path = require('path')
const process = require('process')
const crypto = require('crypto')

const yaml = require('js-yaml')

const cache = require('@actions/cache')
const core = require('@actions/core')
const exec = require('@actions/exec')

const PATHS = {
  condarc: path.join(os.homedir(), '.condarc'),
  bashprofile: path.join(os.homedir(), '.bash_profile'),
  bashrc: path.join(os.homedir(), '.bashrc'),
  bashrcBak: path.join(os.homedir(), '.bashrc.actionbak'),
  micromambaBinFolder: path.join(os.homedir(), 'micromamba-bin'),
  micromambaExe: path.join(os.homedir(), 'micromamba-bin', process.platform === 'win32' ? 'micromamba.exe' : 'micromamba'),
  micromambaRoot: path.join(os.homedir(), 'micromamba'),
  micromambaPkgs: path.join(os.homedir(), 'micromamba', 'pkgs'),
  micromambaEnvs: path.join(os.homedir(), 'micromamba', 'envs')
}

// --- Utils ---

function getCondaArch () {
  const arch = {
    [['osx', 'arm64']]: 'osx-arm64',
    [['osx', 'x64']]: 'osx-64',
    [['linux', 'x64']]: 'linux-64',
    [['linux', 'arm64']]: 'linux-aarch64',
    [['win32', 'x64']]: 'win-64'
  }[[process.platform, process.arch]]
  if (!arch) {
    throw Error(`Platform ${process.platform}/${process.arch} not supported.`)
  }
  return arch
}

function getInputAsArray (name) {
  // From https://github.com/actions/cache/blob/main/src/utils/actionUtils.ts
  return core
    .getInput(name)
    .split('\n')
    .map(s => s.trim())
    .filter(x => x !== '')
}

async function executeShell (...command) {
  try {
    return await exec.getExecOutput(command[0], command.slice(1))
  } catch (error) {
    throw Error(`Failed to execute ${JSON.stringify(command)}`)
  }
}

function executeBash (command) {
  return executeShell('bash', '-c', command)
}

function executeBashLogin (command) {
  return executeShell('bash', '-lc', command)
}

function executePwsh (command) {
  return executeShell('powershell', '-command', `${command}; exit $LASTEXITCODE`)
}

const executeLoginShell = process.platform === 'win32' ? executePwsh : executeBashLogin

function micromambaCmd (command, logLevel, micromambaExe = 'micromamba') {
  return `${micromambaExe} ${command}` + (logLevel ? ` --log-level ${logLevel}` : '')
}

function sha256 (s) {
  const h = crypto.createHash('sha256')
  h.update(s)
  return h.digest().hexSlice()
}

function sha256Short (s) {
  return sha256(s).substr(0, 8)
}

function touch (filename) {
  // https://remarkablemark.org/blog/2017/12/17/touch-file-nodejs/
  const time = new Date()

  try {
    fs.utimesSync(filename, time, time)
  } catch (err) {
    fs.closeSync(fs.openSync(filename, 'w'))
  }
}

function today () {
  return new Date().toDateString()
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

// --- Micromamba download + installation ---

function sleep (ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
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

async function installMicromambaPosix (micromambaUrl, logLevel) {
  const posixDownloader = `curl ${micromambaUrl} -Ls --retry 5 --retry-delay 1 \
    | tar --strip-components=1 -vxjC ${PATHS.micromambaBinFolder} bin/micromamba`
  const cacheKey = `micromamba-bin ${micromambaUrl} ${today()}`
  const cacheArgs = [PATHS.micromambaBinFolder, cacheKey]
  if (!await tryRestoreCache(...cacheArgs)) {
    await executeBash(`mkdir -p ${PATHS.micromambaBinFolder}`)
    await retry(() => executeBash(posixDownloader))
    saveCacheOnPost(...cacheArgs)
  }

  await executeBash(`chmod u+x ${PATHS.micromambaExe}`)
  if (process.platform === 'darwin') {
    // macos
    await executeBash(micromambaCmd('shell init -s bash -p ~/micromamba -y', logLevel, PATHS.micromambaExe))
    // TODO need to fix a check in micromamba so that this works
    // https://github.com/mamba-org/mamba/issues/925
    // await executeBash(micromambaCmd('shell init -s zsh -p ~/micromamba -y', logLevel, PATHS.micromambaExe))
  } else {
    // linux
    // on linux we move the bashrc to a backup and then restore
    let haveBashrcBackup
    if (fs.existsSync(PATHS.bashrc)) {
      fs.renameSync(PATHS.bashrc, PATHS.bashrcBak)
      haveBashrcBackup = true
    }
    touch(PATHS.bashrc)
    try {
      await executeBash(micromambaCmd('shell init -s bash -p ~/micromamba -y', logLevel, PATHS.micromambaExe))
      await executeBash(micromambaCmd('shell init -s zsh -p ~/micromamba -y', logLevel, PATHS.micromambaExe))
      fs.appendFileSync(PATHS.bashprofile, '\n' + fs.readFileSync(PATHS.bashrc, 'utf8'), 'utf8')
      if (haveBashrcBackup) {
        fs.renameSync(PATHS.bashrcBak, PATHS.bashrc)
      }
    } catch (error) {
      if (haveBashrcBackup) {
        fs.renameSync(PATHS.bashrcBak, PATHS.bashrc)
      }
      throw error
    }
  }
}

async function installMicromambaWindows (micromambaUrl, logLevel) {
  const powershellDownloader = `$count = 0
do{
    try
    {
        Invoke-Webrequest -URI ${micromambaUrl} -OutFile ${PATHS.micromambaBinFolder}\\micromamba.tar.bz2
        $success = $true
    }
    catch
    {
        Start-sleep -Seconds (10 * ($count + 1))
    }
    $count++
}until($count -eq 5 -or $success)
if(-not($success)){exit}`

  const cacheKey = `micromamba-bin ${micromambaUrl} ${new Date().toDateString()}`
  const cacheArgs = [PATHS.micromambaBinFolder, cacheKey]
  if (!await tryRestoreCache(...cacheArgs)) {
    await executePwsh(`mkdir -path ${PATHS.micromambaBinFolder}`)
    await retry(() => executePwsh(powershellDownloader))
    await executePwsh(
      '$env:Path = (get-item (get-command git).Path).Directory.parent.FullName + "\\usr\\bin;" + $env:Path;' +
      'tar.exe -xvjf ~/micromamba-bin/micromamba.tar.bz2 --strip-components 2 -C ~/micromamba-bin Library/bin/micromamba.exe;'
    )
    saveCacheOnPost(...cacheArgs)
  }

  await executePwsh(micromambaCmd('shell init -s powershell -p $HOME\\micromamba', logLevel, PATHS.micromambaExe))
  await executePwsh(
    '$env:Path = (get-item (get-command git).Path).Directory.parent.FullName + "\\usr\\bin;" + $env:Path;' +
    micromambaCmd('shell init -s bash -p ~\\micromamba -y', logLevel, PATHS.micromambaExe)
  )
  await executePwsh(micromambaCmd('shell init -s cmd.exe -p ~\\micromamba -y', logLevel, PATHS.micromambaExe))
}

async function installMicromamba (inputs, extraChannels) {
  // Setup .condarc
  if (inputs.condaRcFile) {
    fs.copyFileSync(inputs.condaRcFile, PATHS.condarc)
  } else {
    touch(PATHS.condarc)
  }
  let condarcOpts = {
    always_yes: true,
    show_channel_urls: true,
    channel_priority: inputs.channelPriority
  }
  if (inputs.channelAlias) {
    condarcOpts.channel_alias = inputs.channelAlias
  }
  const channels =
    inputs.channels && extraChannels
      ? inputs.channels + ',' + extraChannels.join(', ')
      : inputs.channels || extraChannels?.join(', ')
  if (channels) {
    condarcOpts.channels = channels.split(',').map(s => s.trim())
  }
  const moreOpts = yaml.safeLoad(inputs.condaRcOptions)
  if (moreOpts) {
    condarcOpts = { ...condarcOpts, ...moreOpts }
  }
  fs.appendFileSync(PATHS.condarc, yaml.safeDump(condarcOpts))
  core.debug(`Contents of ${PATHS.condarc}:\n${fs.readFileSync(PATHS.condarc)}`)

  // Install micromamba
  if (!fs.existsSync(PATHS.micromambaBinFolder)) {
    core.startGroup('Install micromamba ...')
    const installer = {
      win32: installMicromambaWindows,
      linux: installMicromambaPosix,
      darwin: installMicromambaPosix
    }[process.platform]
    const micromambaUrl = `${inputs.installerUrl}/${getCondaArch()}/${inputs.micromambaVersion}`
    await installer(micromambaUrl, inputs.logLevel)
    core.exportVariable('MAMBA_ROOT_PREFIX', PATHS.micromambaRoot)
    core.exportVariable('MAMBA_EXE', PATHS.micromambaExe)
    core.addPath(PATHS.micromambaBinFolder)
    core.endGroup()
  }

  touch(PATHS.bashprofile)
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
  let cmd = micromambaCmd(`${action} -n ${envName} --strict-channel-priority -y`, logLevel)
  if (selectedExtraSpecs.length) {
    cmd += ' ' + selectedExtraSpecs.map(e => `"${e}"`).join(' ')
  }
  if (envFilePath) {
    cmd += ' -f ' + envFilePath
  }
  if (process.platform === 'win32') {
    await executePwsh(cmd)
  } else {
    await executeBash(cmd)
  }
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
    const powershellAutoActivateEnv = `if (!(Test-Path $profile))
{
New-Item -path $profile -type "file" -value "${autoactivateCmd}"
Write-Host "Created new profile and content added"
}
else
{
Add-Content -path $profile -value "${autoactivateCmd}"
Write-Host "Profile already exists and new content added"
}`
    await executePwsh(powershellAutoActivateEnv)
  } else {
    fs.appendFileSync(PATHS.bashprofile, '\nset -eo pipefail')
  }
  fs.appendFileSync(PATHS.bashprofile, '\n' + autoactivateCmd)
  core.info(`Contents of ${PATHS.bashprofile}:\n${fs.readFileSync(PATHS.bashprofile)}`)

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

  await installMicromamba(inputs, envYaml?.channels)
  if (envFilePath || inputs.extraSpecs.length) {
    await installEnvironment(inputs, envFilePath, envYaml)
  } else {
    core.info("Skipping environment install because no 'environment-file' or 'extra-specs' are set")
  }

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
    await main()
  } catch (error) {
    core.setFailed(error.message)
    throw error
  }
}

run()

export default run
