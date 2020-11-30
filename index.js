const core = require('@actions/core')
const yaml = require('js-yaml')
const fs = require('fs')
const os = require('os')
const exec = require('@actions/exec').exec
const path = require('path')
const process = require('process')

async function execute (command) {
  try {
    await exec('bash', ['-c', command])
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
    const envFileName = core.getInput('environment-file')
    const envFilePath = path.join(process.env.GITHUB_WORKSPACE || '', envFileName)
    const envYaml = yaml.safeLoad(fs.readFileSync(envFilePath, 'utf8'))
    const envName = envYaml.name
    const condarc = path.join(os.homedir(), '.condarc')
    const profile = path.join(os.homedir(), '.bash_profile')
    const bashrc = path.join(os.homedir(), '.bashrc')
    const bashrcBak = path.join(os.homedir(), '.bashrc.actionbak')

    core.startGroup('Configuring conda...')
    touch(condarc)
    fs.appendFileSync(condarc, 'always_yes: true\n')
    fs.appendFileSync(condarc, 'show_channel_urls: true\n')
    fs.appendFileSync(condarc, 'channel_priority: strict\n')
    if (envYaml.channels !== undefined) {
      fs.appendFileSync(condarc, 'channels: [' + envYaml.channels.join(', ') + ']\n')
    }
    await execute('cat ' + condarc)
    core.endGroup()

    core.startGroup('Installing environment ' + envName + ' from ' + envFilePath + ' ...')

    touch(profile)

    if (process.platform === 'darwin') {
      // macos
      await execute('curl -Ls https://micromamba.snakepit.net/api/micromamba/osx-64/latest | tar -xvj bin/micromamba')
      await execute('mv ./bin/micromamba ./micromamba')
      await execute('rm -rf ./bin')
      await execute('./micromamba shell init -s bash -p ~/micromamba')
    } else {
      // linux
      await execute('wget -qO- https://micromamba.snakepit.net/api/micromamba/linux-64/latest | tar -xvj bin/micromamba --strip-components=1')

      // on linux we move the bashrc to a backup and then restore
      await execute('mv ' + bashrc + ' ' + bashrcBak)
      touch(bashrc)
      try {
        await execute('./micromamba shell init -s bash -p ~/micromamba')
        fs.appendFileSync(profile, '\n' + fs.readFileSync(bashrc, 'utf8'), 'utf8')
        await execute('mv ' + bashrcBak + ' ' + bashrc)
      } catch (error) {
        await execute('mv ' + bashrcBak + ' ' + bashrc)
        core.setFailed(error.message)
      }
    }

    // final bits of the install
    await execute('mkdir -p ' + path.join(os.homedir(), 'micromamba/pkgs/'))
    await execute('source ' + profile + ' && micromamba create --strict-channel-priority -y -f ' + envFilePath)
    fs.appendFileSync(profile, 'set -eo pipefail\n')
    fs.appendFileSync(profile, 'micromamba activate ' + envName + '\n')
    core.endGroup()

    await execute('source ' + profile + ' && micromamba list')
  } catch (error) {
    core.setFailed(error.message)
  }
}

run()
