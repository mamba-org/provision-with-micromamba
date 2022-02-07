const core = require('@actions/core')
const yaml = require('js-yaml')
const fs = require('fs')
const os = require('os')
const exec = require('@actions/exec').exec
const path = require('path')
const process = require('process')

async function executeNoCatch (command) {
  await exec('bash', ['-c', command])
}

async function execute (command) {
  try {
    await exec('bash', ['-c', command])
  } catch (error) {
    core.setFailed(error.message)
  }
}

async function execPwsh (command) {
  try {
    await exec('powershell', ['-command', command])
  } catch (error) {
    core.setFailed(error.message)
  }
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

async function installMicromambaPosix (paths, micromambaUrl) {
  await execute(`mkdir -p ${paths.micromambaBinFolder}`)
  if (process.platform === 'darwin') {
    // macos
    const curlCmd = `curl -Ls --retry 5 --retry-delay 1 ${micromambaUrl} | tar -xvjO bin/micromamba > ${paths.micromambaLoc}`
    try {
      await executeNoCatch(curlCmd)
    } catch (error) {
      await execute(curlCmd)
    }
    await execute(`chmod u+x ${paths.micromambaLoc}`)
    await execute(`${paths.micromambaLoc} shell init -s bash -p ~/micromamba -y`)
    // TODO need to fix a check in micromamba so that this works
    // https://github.com/mamba-org/mamba/issues/925
    // await execute(`${micromambaLoc} shell init -s zsh -p ~/micromamba -y`)
  } else if (process.platform === 'linux') {
    // linux
    const wgetCmd = `wget -qO- --retry-connrefused --waitretry=10 -t 5 ${micromambaUrl} | tar -xvjO bin/micromamba > ${paths.micromambaLoc}`
    try {
      await executeNoCatch(wgetCmd)
    } catch (error) {
      await execute(wgetCmd)
    }
    await execute(`chmod u+x ${paths.micromambaLoc}`)

    // on linux we move the bashrc to a backup and then restore
    await execute(`mv ${paths.bashrc} ${paths.bashrcBak}`)
    touch(paths.bashrc)
    try {
      await execute(`${paths.micromambaLoc} shell init -s bash -p ~/micromamba -y`)
      await execute(`${paths.micromambaLoc} shell init -s zsh -p ~/micromamba -y`)
      fs.appendFileSync(paths.profile, '\n' + fs.readFileSync(paths.bashrc, 'utf8'), 'utf8')
      await execute(`mv ${paths.bashrcBak} ${paths.bashrc}`)
    } catch (error) {
      await execute(`mv ${paths.bashrcBak} ${paths.bashrc}`)
      core.setFailed(error.message)
    }
  } else {
    core.setFailed(`Platform ${process.platform} not supported.`)
  }
  await execute('mkdir -p ' + path.join(os.homedir(), 'micromamba/pkgs/'))
  core.addPath(paths.micromambaBinFolder)
  core.exportVariable('MAMBA_ROOT_PREFIX', path.join(os.homedir(), 'micromamba'))
  core.exportVariable('MAMBA_EXE', paths.micromambaLoc)
}

async function installMicromambaWindows (paths, micromambaUrl) {
  const powershellDownloader = `$count = 0
do{
    try
    {
        Invoke-Webrequest -URI ${micromambaUrl} -OutFile ${paths.micromambaBinFolder}\\micromamba.tar.bz2
        $success = $true
    }
    catch
    {
        Start-sleep -Seconds (10 * ($count + 1))
    }
    $count++
}until($count -eq 5 -or $success)
if(-not($success)){exit}`

  await execPwsh(`mkdir -path ${paths.micromambaBinFolder}`)
  await execPwsh(powershellDownloader)
  await execPwsh(
    '$env:Path = (get-item (get-command git).Path).Directory.parent.FullName + "\\usr\\bin;" + $env:Path;' +
    'tar.exe -xvjf ~/micromamba-bin/micromamba.tar.bz2 --strip-components 2 -C ~/micromamba-bin Library/bin/micromamba.exe;'
  )

  await execPwsh(`${paths.micromambaExe} --help`)
  await execPwsh(`${paths.micromambaExe} shell init -s powershell -p $HOME\\micromamba`)
  await execPwsh('$env:Path = (get-item (get-command git).Path).Directory.parent.FullName + "\\usr\\bin;" + $env:Path;' +
                 `${paths.micromambaExe} shell init -s bash -p ~\\micromamba -y`)
  await execPwsh(`${paths.micromambaExe} shell init -s cmd.exe -p ~\\micromamba -y`)

  core.exportVariable('MAMBA_ROOT_PREFIX', path.join(os.homedir(), 'micromamba'))
  core.exportVariable('MAMBA_EXE', paths.micromambaExe)
  core.addPath(paths.micromambaBinFolder)
}

async function run () {
  try {
    const inputs = {
      envName: core.getInput('environment-name'),
      envFile: core.getInput('environment-file'),
      micromambaVersion: core.getInput('micromamba-version'),
      extraSpecs: core.getInput('extra-specs')
    }
    const baseUrl = 'https://micro.mamba.pm/api/micromamba'
    const platformUrl = {
      darwin: 'osx',
      linux: 'linux',
      win32: 'win'
    }[process.platform]
    const micromambaUrl = `${baseUrl}/${platformUrl}-64/${inputs.micromambaVersion}`

    const paths = {
      condarc: path.join(os.homedir(), '.condarc'),
      profile: path.join(os.homedir(), '.bash_profile'),
      bashrc: path.join(os.homedir(), '.bashrc'),
      bashrcBak: path.join(os.homedir(), '.bashrc.actionbak'),
      micromambaBinFolder: path.join(os.homedir(), 'micromamba-bin'),
      micromambaLoc: path.join(os.homedir(), 'micromamba-bin', 'micromamba'),
      micromambaExe: path.join(os.homedir(), 'micromamba-bin', 'micromamba.exe')
    }
    console.log(`The bin folder is ${paths.micromambaBinFolder}`)

    let envFilePath, envName

    core.startGroup('Configuring micromamba...')
    touch(paths.condarc)
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
      fs.appendFileSync(paths.condarc, condarcOpts)
    }

    console.log(`Contents of ${paths.condarc}:\n ${fs.readFileSync(paths.condarc)}`)

    core.endGroup()

    // Install micromamba
    if (!fs.existsSync(paths.micromambaBinFolder)) {
      core.startGroup('Installing micromamba')
      if (process.platform === 'win32') {
        await installMicromambaWindows(paths, micromambaUrl)
      } else {
        await installMicromambaPosix(paths, micromambaUrl)
      }
      core.endGroup()
    }

    touch(paths.profile)

    // Install env
    if (envName) {
      core.startGroup(`Installing environment ${envName} from ${envFilePath} ...`)
      const envExtraSpecs = inputs.extraSpecs.split('\n').filter(x => x !== '')
      const quotedExtraSpecsStr = envExtraSpecs.map(e => `"${e}"`).join(' ')

      const autoactivateCmd = `micromamba activate ${envName}`
      if (process.platform === 'win32') {
        await execPwsh(`${paths.micromambaExe} create -n ${envName} ${quotedExtraSpecsStr} --strict-channel-priority -y -f ${envFilePath}`)
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
        await execPwsh(powershellAutoActivateEnv)
      } else {
        await execute(`\nsource ${paths.profile} && micromamba create -n ${envName} ${quotedExtraSpecsStr} --strict-channel-priority -y -f ${envFilePath}`)
        fs.appendFileSync(paths.profile, '\nset -eo pipefail')
      }
      fs.appendFileSync(paths.profile, '\n' + autoactivateCmd)
      console.log(`Contents of ${paths.profile}:\n ${fs.readFileSync(paths.profile)}`)
      core.endGroup()
    }

    // Show environment info
    if (process.platform === 'win32') {
      await execPwsh('micromamba info')
      await execPwsh('micromamba list')
    } else {
      await execute(`source ${paths.profile} && micromamba info && micromamba list`)
    }
  } catch (error) {
    core.setFailed(error.message)
  }
}

run()
