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

async function executeBash (command, opts = { setFailed: true }) {
  try {
    await exec('bash', ['-c', command])
  } catch (error) {
    if (opts.setFailed) {
      core.setFailed(error.message)
    } else {
      throw error
    }
  }
}

async function executePwsh (command) {
  try {
    await exec('powershell', ['-command', command])
  } catch (error) {
    core.setFailed(error.message)
  }
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
    try {
      await executeBash(downloadCmd, { setFailed: false })
    } catch (error) {
      await executeBash(downloadCmd)
    }
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
    await executePwsh(powershellDownloader)
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

async function createOrUpdateEnv (envName, envFilePath, extraSpecs) {
  const envFolder = path.join(PATHS.micromambaEnvs, envName)
  const action = fs.existsSync(envFolder) ? 'update' : 'create'
  core.info(`${action} env ${envName}`)
  const quotedExtraSpecsStr = extraSpecs.map(e => `"${e}"`).join(' ')
  const cmd = `micromamba ${action} -n ${envName} ${quotedExtraSpecsStr} --strict-channel-priority -y -f ${envFilePath}`
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
    cacheDownloads: core.getBooleanInput('cache-downloads'),
    cacheDownloadsKey: core.getInput('cache-downloads-key'),
    cacheEnv: core.getBooleanInput('cache-env'),
    cacheEnvKey: core.getInput('cache-env-key'),
    cacheEnvAlwaysUpdate: core.getBooleanInput('cache-env-always-update')
  }
  const micromambaUrl = MICROMAMBA_PLATFORM_URL + inputs.micromambaVersion

  let envFilePath, envName

  // .condarc setup
  touch(PATHS.condarc)
  if (inputs.envFile !== 'false') {
    envFilePath = path.join(process.env.GITHUB_WORKSPACE || '', inputs.envFile)
    let condarcOpts = `
always_yes: true
show_channel_urls: true
channel_priority: strict
`
    if (envFilePath.endsWith('.lock')) {
      envName = inputs.envName
    } else {
      const envYaml = yaml.safeLoad(fs.readFileSync(envFilePath, 'utf8'))
      envName = inputs.envName || envYaml.name
      if (envYaml.channels !== undefined) {
        condarcOpts += `channels: [${envYaml.channels.join(', ')}]`
      }
    }
    fs.appendFileSync(PATHS.condarc, condarcOpts)
  }
  core.debug(`Contents of ${PATHS.condarc}:\n${fs.readFileSync(PATHS.condarc)}`)

  // Install micromamba
  if (!fs.existsSync(PATHS.micromambaBinFolder)) {
    core.startGroup('Install micromamba ...')
    const installer = {
      win: installMicromambaWindows,
      linux: installMicromambaPosix,
      osx: installMicromambaPosix
    }[MAMBA_PLATFORM]
    await installer(micromambaUrl)
    core.exportVariable('MAMBA_ROOT_PREFIX', PATHS.micromambaRoot)
    core.exportVariable('MAMBA_EXE', PATHS.micromambaExe)
    core.addPath(PATHS.micromambaBinFolder)
    core.endGroup()
  }

  touch(PATHS.bashprofile)

  // Install env
  if (envName) {
    core.startGroup(`Install environment ${envName} from ${envFilePath} ...`)
    let downloadCacheHit, downloadCacheArgs, envCacheHit, envCacheArgs

    // Try to load the entire env from cache.
    if (inputs.cacheEnv) {
      const envHash = sha256(fs.readFileSync(envFilePath)) + '-' + sha256(JSON.stringify(inputs.extraSpecs))
      const key = inputs.cacheEnvKey || `${MAMBA_PLATFORM}-${process.arch} ${today()} ${envHash}`
      envCacheArgs = [path.join(PATHS.micromambaEnvs, envName), `micromamba-env ${key}`]
      envCacheHit = await tryRestoreCache(...envCacheArgs)
    }

    if (!envCacheHit || inputs.cacheEnvAlwaysUpdate) {
      // Try to restore the download cache.
      if (inputs.cacheDownloads) {
        const key = inputs.cacheDownloadsKey || `${MAMBA_PLATFORM}-${process.arch} ${today()}`
        downloadCacheArgs = [PATHS.micromambaPkgs, `micromamba-pkgs ${key}`]
        downloadCacheHit = await tryRestoreCache(...downloadCacheArgs)
      }
      await createOrUpdateEnv(envName, envFilePath, inputs.extraSpecs)
    }

    // Add micromamba activate to profile
    const autoactivateCmd = `micromamba activate ${envName}`
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
    if (inputs.cacheDownloads && !downloadCacheHit) {
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
}

async function run () {
  try {
    await main()
  } catch (error) {
    core.setFailed(error.message)
  }
}

run()

export default run
