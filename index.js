const core = require('@actions/core')
const yaml = require('js-yaml')
const fs = require('fs')
const os = require('os')
const io = require('@actions/io')
const exec = require('@actions/exec').exec
const path = require('path')

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
    const bashrc = path.join(os.homedir(), '.bashrc')
    const profile = path.join(os.homedir(), '.profile')
    const condarc = path.join(os.homedir(), '.condarc')

    console.log('Installing environment ' + envName + ' from ' + envFilePath + ' ...')

    await io.rmRF(bashrc)
    await io.rmRF(path.join(os.homedir(), '.bash_profile'))
    await io.rmRF(profile)
    touch(bashrc)
    await execute('wget -qO- https://micromamba.snakepit.net/api/micromamba/linux-64/latest | tar -xvj bin/micromamba --strip-components=1')
    await execute('./micromamba shell init -s bash -p ~/micromamba')
    await io.mkdirP(path.join(os.homedir(), 'micromamba/pkgs/'))
    await execute('source ~/.bashrc && micromamba create -f ' + envFilePath + ' -y')
    fs.appendFileSync(bashrc, 'set -eo pipefail\n')
    fs.appendFileSync(bashrc, 'micromamba activate ' + envName + '\n')
    await io.mv(bashrc, profile)

    console.log('Configuring conda...')
    touch(condarc)
    fs.appendFileSync(condarc, 'always_yes: true\n')
    fs.appendFileSync(condarc, 'show_channel_urls: true\n')
    fs.appendFileSync(condarc, 'channel_priority: strict\n')
    if (envYaml.channels !== undefined) {
      fs.appendFileSync(condarc, 'channels: [' + envYaml.channels.join(',') + ']\n')
    }
    await execute('cat ' + condarc)
  } catch (error) {
    core.setFailed(error.message)
  }
}

run()
