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

async function run () {
  try {
    const envFileName = core.getInput('environment-file')
    console.log(envFileName)
    const envFilePath = path.join(process.env.GITHUB_WORKSPACE || '', envFileName)
    console.log(envFilePath)
    const envYaml = yaml.safeLoad(fs.readFileSync(envFilePath, 'utf-8'))
    const envName = envYaml.name

    console.log('Installing environment ' + envName + '...')

    await io.rmRF(path.join(os.homedir(), '.bashrc'))
    await io.rmRF(path.join(os.homedir(), '.bash_profile'))
    await io.rmRF(path.join(os.homedir(), '.profile'))
    await execute('touch ~/.bashrc')
    await execute('wget -qO- https://micromamba.snakepit.net/api/micromamba/linux-64/latest | tar -xvj bin/micromamba --strip-components=1')
    await execute('./micromamba shell init -s bash -p ~/micromamba')
    await io.mkdirP(path.join(os.homedir(), 'micromamba/pkgs/'))
    fs.appendFileSync(path.join(os.homedir(), '.bashrc'), 'set -eo pipefail')
    fs.appendFileSync(path.join(os.homedir(), '.bashrc'), 'micromamba activate ' + envName)
    await io.mv(path.join(os.homedir(), '.bashrc'), path.join(os.homedir(), '.profile'))
    await execute('source ~/.profile && micromamba create -f ' + envFilePath + ' -y')
  } catch (error) {
    core.setFailed(error.message)
  }
}

run()
