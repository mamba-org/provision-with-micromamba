const fs = require('fs')
const os = require('os')
const path = require('path')
const process = require('process')
const crypto = require('crypto')

const yaml = require('js-yaml')

const cache = require('@actions/cache')
const core = require('@actions/core')
const exec = require('@actions/exec').exec

const MICROMAMBA_BASE_URL = 'https://micro.mamba.pm/api/micromamba'
const MAMBA_PLATFORM = { darwin: 'osx', linux: 'linux', win32: 'win' }[process.platform]
if (!MAMBA_PLATFORM) {
  throw Error(`Platform ${process.platform} not supported.`)
}
const MICROMAMBA_PLATFORM_URL = `${MICROMAMBA_BASE_URL}/${MAMBA_PLATFORM}-64/`
const PATHS = {
  condarc: path.join(os.homedir(), '.condarc'),
  bashprofile: path.join(os.homedir(), '.bash_profile'),
  bashrc: path.join(os.homedir(), '.bashrc'),
  bashrcBak: path.join(os.homedir(), '.bashrc.actionbak'),
  micromambaBinFolder: path.join(os.homedir(), 'micromamba-bin'),
  micromambaExe: path.join(os.homedir(), 'micromamba-bin', MAMBA_PLATFORM === 'win' ? 'micromamba.exe' : 'micromamba'),
  micromambaRoot: path.join(os.homedir(), 'micromamba'),
  micromambaPkgs: path.join(os.homedir(), 'micromamba', 'pkgs'),
  micromambaEnvs: path.join(os.homedir(), 'micromamba', 'envs')
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
    await exec(command[0], command.slice(1))
  } catch (error) {
    throw Error(`Failed to execute ${JSON.stringify(command)}`)
  }
}

function executeBash (command) {
  return executeShell('bash', '-c', command)
}

function executePwsh (command) {
  return executeShell('powershell', '-command', command)
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

function sleep (ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
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

function saveCacheOnPost (paths, key, options) {
  core.info(`Will save to cache with key ${key}`)
  const old = JSON.parse(core.getState('postCacheArgs') || '[]')
  core.saveState('postCacheArgs', JSON.stringify([...old, [paths, key, options]]))
}

async function installMicromambaPosix (micromambaUrl) {
  const cacheKey = `micromamba-bin ${micromambaUrl} ${today()}`
  const cacheArgs = [PATHS.micromambaBinFolder, cacheKey]
  if (!await tryRestoreCache(...cacheArgs)) {
    await executeBash(`mkdir -p ${PATHS.micromambaBinFolder}`)
    const downloadProg = {
      osx: 'curl -Ls --retry 5 --retry-delay 1',
      linux: 'wget -qO- --retry-connrefused --waitretry=10 -t 5'
    }[MAMBA_PLATFORM]
    const downloadCmd = `${downloadProg} ${micromambaUrl} | tar -xvjO bin/micromamba > ${PATHS.micromambaExe}`
    await retry(() => executeBash(downloadCmd))
    saveCacheOnPost(...cacheArgs)
  }

  await executeBash(`chmod u+x ${PATHS.micromambaExe}`)
  if (MAMBA_PLATFORM === 'osx') {
    // macos
    await executeBash(`${PATHS.micromambaExe} shell init -s bash -p ~/micromamba -y`)
    // TODO need to fix a check in micromamba so that this works
    // https://github.com/mamba-org/mamba/issues/925
    // await executeBash(`${micromambaExe} shell init -s zsh -p ~/micromamba -y`)
  } else {
    // linux
    // on linux we move the bashrc to a backup and then restore
    await executeBash(`mv ${PATHS.bashrc} ${PATHS.bashrcBak}`)
    touch(PATHS.bashrc)
    try {
      await executeBash(`${PATHS.micromambaExe} shell init -s bash -p ~/micromamba -y`)
      await executeBash(`${PATHS.micromambaExe} shell init -s zsh -p ~/micromamba -y`)
      fs.appendFileSync(PATHS.bashprofile, '\n' + fs.readFileSync(PATHS.bashrc, 'utf8'), 'utf8')
      await executeBash(`mv ${PATHS.bashrcBak} ${PATHS.bashrc}`)
    } catch (error) {
      await executeBash(`mv ${PATHS.bashrcBak} ${PATHS.bashrc}`)
      throw error
    }
  }
}

async function installMicromambaWindows (micromambaUrl) {
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

  await executePwsh(`${PATHS.micromambaExe} shell init -s powershell -p $HOME\\micromamba`)
  await executePwsh(
    '$env:Path = (get-item (get-command git).Path).Directory.parent.FullName + "\\usr\\bin;" + $env:Path;' +
    `${PATHS.micromambaExe} shell init -s bash -p ~\\micromamba -y`
  )
  await executePwsh(`${PATHS.micromambaExe} shell init -s cmd.exe -p ~\\micromamba -y`)
}

function isSelected (item) {
  if (/sel\(.*\):.*/gi.test(item)) {
    return new RegExp('sel\\(' + MAMBA_PLATFORM + '\\):.*', 'gi').test(item)
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

async function createOrUpdateEnv (envName, envFilePath, extraSpecs) {
  const envFolder = path.join(PATHS.micromambaEnvs, envName)
  const action = fs.existsSync(envFolder) ? 'update' : 'create'
  const selectedExtraSpecs = selectSelectors(extraSpecs)
  core.info(`${action} env ${envName}`)
  let cmd = `micromamba ${action} -n ${envName} --strict-channel-priority -y`
  if (selectedExtraSpecs) {
    cmd += ' ' + selectedExtraSpecs.map(e => `"${e}"`).join(' ')
  }
  if (envFilePath) {
    cmd += ' -f ' + envFilePath
  }
  if (MAMBA_PLATFORM === 'win') {
    await executePwsh(cmd)
  } else {
    await executeBash(cmd)
  }
}

async function main () {
  const inputs = {
    micromambaVersion: core.getInput('micromamba-version'),
    envName: core.getInput('environment-name'),
    envFile: core.getInput('environment-file'),
    extraSpecs: getInputAsArray('extra-specs'),
    channels: core.getInput('channels'),
    cacheDownloads: core.getBooleanInput('cache-downloads'),
    cacheDownloadsKey: core.getInput('cache-downloads-key'),
    cacheEnv: core.getBooleanInput('cache-env'),
    cacheEnvKey: core.getInput('cache-env-key'),
    // Not implemented
    // cacheEnvAlwaysUpdate: core.getBooleanInput('cache-env-always-update')
    cacheEnvAlwaysUpdate: false
  }

  let envFilePath, envYaml

  // Read environment file
  if (inputs.envFile === 'false') {
    if (!inputs.envName) {
      throw Error("Must provide 'environment-name' for 'environment-file: false'")
    }
  } else {
    envFilePath = path.join(process.env.GITHUB_WORKSPACE || '', inputs.envFile)
    if (!envFilePath.endsWith('.lock')) {
      envYaml = yaml.safeLoad(fs.readFileSync(envFilePath, 'utf8'))
    }
  }

  // Setup .condarc
  touch(PATHS.condarc)
  let condarcOpts = `
always_yes: true
show_channel_urls: true
channel_priority: strict
`
  const channels = inputs.channels + (envYaml?.channels || []).join(', ')
  if (channels) {
    condarcOpts += `channels: [${channels}]`
  }
  fs.appendFileSync(PATHS.condarc, condarcOpts)
  core.debug(`Contents of ${PATHS.condarc}:\n${fs.readFileSync(PATHS.condarc)}`)

  // Install micromamba
  if (!fs.existsSync(PATHS.micromambaBinFolder)) {
    core.startGroup('Install micromamba ...')
    const installer = {
      win: installMicromambaWindows,
      linux: installMicromambaPosix,
      osx: installMicromambaPosix
    }[MAMBA_PLATFORM]
    const micromambaUrl = MICROMAMBA_PLATFORM_URL + inputs.micromambaVersion
    await installer(micromambaUrl)
    core.exportVariable('MAMBA_ROOT_PREFIX', PATHS.micromambaRoot)
    core.exportVariable('MAMBA_EXE', PATHS.micromambaExe)
    core.addPath(PATHS.micromambaBinFolder)
    core.endGroup()
  }

  touch(PATHS.bashprofile)

  // Install env
  const envName = inputs.envName || envYaml?.name
  if (envName) {
    core.startGroup(`Install environment ${envName} from ${envFilePath || ''} ${inputs.extraSpecs || ''}...`)
    let downloadCacheHit, downloadCacheArgs, envCacheHit, envCacheArgs

    // Try to load the entire env from cache.
    if (inputs.cacheEnv) {
      let key = inputs.cacheEnvKey || `${MAMBA_PLATFORM}-${process.arch} ${today()}`
      if (envFilePath) {
        key += ' file: ' + sha256Short(fs.readFileSync(envFilePath))
      }
      if (inputs.extraSpecs) {
        key += ' extra: ' + sha256Short(JSON.stringify(inputs.extraSpecs))
      }
      envCacheArgs = [path.join(PATHS.micromambaEnvs, envName), `micromamba-env ${key}`]
      envCacheHit = await tryRestoreCache(...envCacheArgs)
    }

    const shouldTryDownloadCache = !envCacheHit || inputs.cacheEnvAlwaysUpdate
    if (shouldTryDownloadCache) {
      // Try to restore the download cache.
      if (inputs.cacheDownloads) {
        const key = inputs.cacheDownloadsKey || `${MAMBA_PLATFORM}-${process.arch} ${today()}`
        downloadCacheArgs = [PATHS.micromambaPkgs, `micromamba-pkgs ${key}`]
        downloadCacheHit = await tryRestoreCache(...downloadCacheArgs)
      }
      await createOrUpdateEnv(envName, envFilePath, inputs.extraSpecs)
    }

    // Add micromamba activate to profile
    const autoactivateCmd = `micromamba activate ${envName};`
    if (MAMBA_PLATFORM === 'win') {
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

    // Save cache on workflow success
    if (shouldTryDownloadCache && inputs.cacheDownloads && !downloadCacheHit) {
      saveCacheOnPost(...downloadCacheArgs)
    }
    if (inputs.cacheEnv && !envCacheHit) {
      saveCacheOnPost(...envCacheArgs)
    }
    core.endGroup()
  }

  // Show environment info
  core.startGroup('Environment info')
  if (MAMBA_PLATFORM === 'win') {
    await executePwsh('micromamba info')
    await executePwsh('micromamba list')
  } else {
    await executeBash(`source ${PATHS.bashprofile} && micromamba info && micromamba list`)
  }
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
