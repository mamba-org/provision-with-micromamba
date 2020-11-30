const core = require('@actions/core')
const yaml = require('js-yaml')
const fs = require('fs')
const os = require('os')
const io = require('@actions/io')
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
    const envYaml = yaml.safeLoad(fs.readFileSync(envFilePath, 'utf-8'))
    const envName = envYaml.name
    let bashrc = ''
    if (process.platform === 'darwin') {
      bashrc = path.join(os.homedir(), '.bash_profile')
    } else {
      bashrc = path.join(os.homedir(), '.bashrc')
    }
    const condarc = path.join(os.homedir(), '.condarc')

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

    if (process.platform === 'darwin') {
      await execute('curl -Ls https://micromamba.snakepit.net/api/micromamba/osx-64/latest | tar -xvj bin/micromamba')
      await io.mv('./bin/micromamba', './micromamba')
      await io.rmRF('./bin')
    } else {
      await execute('wget -qO- https://micromamba.snakepit.net/api/micromamba/linux-64/latest | tar -xvj bin/micromamba --strip-components=1')
    }
    await execute('./micromamba shell init -s bash -p ~/micromamba')
    await io.mkdirP(path.join(os.homedir(), 'micromamba/pkgs/'))
    await execute('source ' + bashrc + ' && micromamba create --strict-channel-priority -y -f ' + envFilePath)

    fs.appendFileSync(bashrc, 'set -eo pipefail\n')
    fs.appendFileSync(bashrc, 'micromamba activate ' + envName + '\n')

    core.endGroup()

    await execute('source ' + bashrc + ' && micromamba list')
  } catch (error) {
    core.setFailed(error.message)
  }
}

run()
