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

async function run () {
  try {
    const baseUrl = 'https://micro.mamba.pm/api/micromamba'
    const envFileName = core.getInput('environment-file')
    const micromambaVersion = core.getInput('micromamba-version')
    const envFilePath = path.join(process.env.GITHUB_WORKSPACE || '', envFileName)
    const envYaml = yaml.safeLoad(fs.readFileSync(envFilePath, 'utf8'))
    const extraSpecs = core.getInput('extra-specs').split("\n").filter(x => x !== "");
    const envName = core.getInput('environment-name') || envYaml.name
    const condarc = path.join(os.homedir(), '.condarc')
    const profile = path.join(os.homedir(), '.bash_profile')
    const bashrc = path.join(os.homedir(), '.bashrc')
    const bashrcBak = path.join(os.homedir(), '.bashrc.actionbak')
    const micromambaBinFolder = path.join(os.homedir(), 'micromamba-bin');
    const micromambaLoc = path.join(micromambaBinFolder, 'micromamba');
    console.log(`The bin folder is ${micromambaBinFolder}`);

    core.startGroup('Configuring micromamba...')
    touch(condarc)
    fs.appendFileSync(condarc, 'always_yes: true\n')
    fs.appendFileSync(condarc, 'show_channel_urls: true\n')
    fs.appendFileSync(condarc, 'channel_priority: strict\n')
    if (envYaml.channels !== undefined) {
      fs.appendFileSync(condarc, 'channels: [' + envYaml.channels.join(', ') + ']\n')
    }
    if (process.platform !== 'win32')
    {
      await execute('cat ' + condarc)
    }
    else
    {
      await execute('cat $(cygpath "' + condarc + '")')

      // await execute('type ' + condarc)
    }
    core.endGroup()

    const quotedExtraSpecsStr = extraSpecs.map(function(e) { 
      return '"' + e + '"';
    }).join(" ");

    if (process.platform !== 'win32') {

      core.startGroup('Installing environment ' + envName + ' from ' + envFilePath + ' ...')

      touch(profile)

      await execute('mkdir -p ' + micromambaBinFolder)

      if (process.platform === 'darwin') {
        // macos
        try {
          await executeNoCatch(`curl -Ls --retry 5 --retry-delay 1 ${baseUrl}/osx-64/${micromambaVersion} | tar -xvjO bin/micromamba > ${micromambaLoc}`)
        } catch (error) {
          await execute(`curl -Ls --retry 5 --retry-delay 1 ${baseUrl}/osx-64/${micromambaVersion} | tar -xvzO bin/micromamba > ${micromambaLoc}`)
        }
        await execute(`chmod u+x ${micromambaLoc}`)
        await execute(`${micromambaLoc} shell init -s bash -p ~/micromamba -y`)
        // TODO need to fix a check in micromamba so that this works
        // https://github.com/mamba-org/mamba/issues/925
        // await execute(`${micromambaLoc} shell init -s zsh -p ~/micromamba -y`)
      } else if (process.platform === 'linux') {
        // linux
        try {
          await executeNoCatch(`wget -qO- --retry-connrefused --waitretry=1 -t 5 ${baseUrl}/linux-64/${micromambaVersion} | tar -xvjO bin/micromamba > ${micromambaLoc}`)
        } catch (error) {
          await execute(`wget -qO- --retry-connrefused --waitretry=1 -t 5 ${baseUrl}/linux-64/${micromambaVersion} | tar -xvzO bin/micromamba > ${micromambaLoc}`)
        }
        await execute(`chmod u+x ${micromambaLoc}`)

        // on linux we move the bashrc to a backup and then restore
        await execute('mv ' + bashrc + ' ' + bashrcBak)
        touch(bashrc)
        try {
          await execute(`${micromambaLoc} shell init -s bash -p ~/micromamba -y`)
          await execute(`${micromambaLoc} shell init -s zsh -p ~/micromamba -y`)
          fs.appendFileSync(profile, '\n' + fs.readFileSync(bashrc, 'utf8'), 'utf8')
          await execute('mv ' + bashrcBak + ' ' + bashrc)
        } catch (error) {
          await execute('mv ' + bashrcBak + ' ' + bashrc)
          core.setFailed(error.message)
        }
      } else {
        core.setFailed('Platform ' + process.platform + ' not supported.')
      }

      // final bits of the install
      await execute('mkdir -p ' + path.join(os.homedir(), 'micromamba/pkgs/'))
      await execute('source ' + profile + ' && micromamba create -n ' + envName + ' ' + quotedExtraSpecsStr + ' --strict-channel-priority -y -f ' + envFilePath)
      fs.appendFileSync(profile, 'set -eo pipefail\n')
      fs.appendFileSync(profile, 'micromamba activate ' + envName + '\n')
      core.addPath(micromambaBinFolder);
      core.endGroup()

      await execute('source ' + profile + ' && micromamba info && micromamba list')
    } else {
      // handle win32!
      const powershellAutoActivateEnv = `if (!(Test-Path $profile))
{
   New-Item -path $profile -type "file" -value "CONTENTPLACEHOLDER"
   Write-Host "Created new profile and content added"
}
else
{
  Add-Content -path $profile -value "CONTENTPLACEHOLDER"
  Write-Host "Profile already exists and new content added"
}`
      const powershellDownloader = `$count = 0
do{
    try
    {
        Invoke-Webrequest -URI ${baseUrl}/win-64/${micromambaVersion} -OutFile ${micromambaBinFolder}\\micromamba.tar.bz2
        $success = $true
    }
    catch
    {
        Start-sleep -Seconds 1
    }
    $count++
}until($count -eq 5 -or $success)
if(-not($success)){exit}`
      const autoactivate = powershellAutoActivateEnv.replace(/CONTENTPLACEHOLDER/g, `micromamba activate ${envName}`)
      core.startGroup(`Installing environment ${envName} from ${envFilePath} ...`)
      touch(profile)

      await execPwsh('mkdir -path ' + micromambaBinFolder);

      await execPwsh(powershellDownloader)
      await execPwsh(
        '$env:Path = (get-item (get-command git).Path).Directory.parent.FullName + "\\usr\\bin;" + $env:Path;' +
        'tar.exe -xvjf ~/micromamba-bin/micromamba.tar.bz2 --strip-components 2 -C ~/micromamba-bin Library/bin/micromamba.exe;' +
        'mv micromamba.exe ~/micromamba-bin/micromamba.exe'
      )

      const micromambaExe = `${micromambaLoc}.exe`;

      await execPwsh(`${micromambaExe} --help`)
      await execPwsh(`${micromambaExe} shell init -s powershell -p $HOME\\micromamba`)
      await execPwsh(`${micromambaExe} shell init -s bash -p ~\\micromamba -y`)
      await execPwsh(`${micromambaExe} shell init -s cmd.exe -p ~\\micromamba -y`)

      await execPwsh(`${micromambaExe} create -n ${envName} ${quotedExtraSpecsStr} --strict-channel-priority -y -f ${envFilePath}`);
      await execPwsh(autoactivate);

      fs.appendFileSync(profile, `micromamba activate ${envName}\n`)

      core.addPath(micromambaBinFolder);

      core.endGroup()
      await execPwsh('micromamba info')
      await execPwsh('micromamba list')
    }
  } catch (error) {
    core.setFailed(error.message)
  }
}

run()
